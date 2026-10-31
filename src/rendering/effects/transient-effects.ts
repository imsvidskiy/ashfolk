import { type Mesh, Vector3 } from "three/webgpu";
import { FULL_TURN, hashToUnit, lerp, saturate, smoothstep } from "../../shared/math.ts";
import type {
  BlessingEffect,
  EarthquakeEffect,
  EmberEffect,
  ExplosionEffect,
  LightningEffect,
  SplashEffect,
} from "../../simulation/effects.ts";
import type { InstanceBatch } from "../instancing.ts";
import type { EffectMeshes, RibbonPoint } from "./effect-meshes.ts";
import type { GroundRing } from "./ground-ring.ts";

const BOLT_HEIGHT = 1100;
const BOLT_SUBDIVISIONS = 6;
const BOLT_SECONDS = 0.55;
const EXPLOSION_SECONDS = 3;
const EARTHQUAKE_SECONDS = 3.2;
const BLESSING_SECONDS = 3;
const DUST_PUFFS = 26;
const SPARKLES = 70;
const RING_COLOR = 0xff_f0_d8;
const SPLASH_SECONDS = 0.55;
const SPLASH_DROPS = 9;

export type SpriteColor = readonly [number, number, number];

const SPLASH_COLOR: SpriteColor = [0.86, 0.93, 0.97];
const WATER_DUST: SpriteColor = [0.85, 0.9, 0.95];
const LAND_DUST: SpriteColor = [0.3, 0.27, 0.24];

const BLESSING_COLORS: Readonly<Record<BlessingEffect["style"], SpriteColor>> = {
  abundance: [1, 0.78, 0.3],
  healing: [0.45, 1, 0.55],
  inspiration: [0.55, 0.75, 1],
};

export interface SpriteSinks {
  readonly dust: InstanceBatch;
  readonly glow: InstanceBatch;
}

export interface EffectContext {
  readonly flash: (amount: number) => void;
  readonly heightAt: (x: number, z: number) => number;
  readonly light: (position: Vector3, color: number, intensity: number) => void;
  readonly meshes: EffectMeshes;
  readonly releaseRing: (ring: GroundRing) => void;
  readonly shake: (amount: number, x: number, z: number) => void;
  readonly takeRing: () => GroundRing;
}

export interface ActiveEffect {
  readonly finish?: () => void;
  readonly isOnGameClock?: true;
  readonly meshes: readonly Mesh[];
  readonly update: (seconds: number, sinks: SpriteSinks) => boolean;
}

function jaggedPath(start: Vector3, end: Vector3, roughness: number): Vector3[] {
  let points = [start, end];

  for (let level = 0; level < BOLT_SUBDIVISIONS; level += 1) {
    points = subdivide(points, roughness);
  }

  return points;
}

function subdivide(points: readonly Vector3[], roughness: number): Vector3[] {
  const refined: Vector3[] = [];

  for (const [index, point] of points.entries()) {
    refined.push(point);

    const next = points[index + 1];

    if (next === undefined) {
      continue;
    }

    const spread = point.distanceTo(next) * roughness;
    const middle = point.clone().lerp(next, 0.5);

    middle.x += (Math.random() - 0.5) * spread;
    middle.y += (Math.random() - 0.5) * spread * 0.3;
    middle.z += (Math.random() - 0.5) * spread;
    refined.push(middle);
  }

  return refined;
}

function toRibbon(points: readonly Vector3[], width: number): RibbonPoint[] {
  return points.map((position, index) => {
    return { position, width: width * (1 - (index / points.length) * 0.4) };
  });
}

function branchFrom(trunk: readonly Vector3[], share: number): RibbonPoint[] {
  const start = trunk[Math.floor(trunk.length * share)];
  const length = BOLT_HEIGHT * (0.12 + Math.random() * 0.15);
  const offset = new Vector3((Math.random() - 0.5) * length, -length, (Math.random() - 0.5) * length);

  return toRibbon(jaggedPath(start, start.clone().add(offset), 0.5).slice(0, 24), 0.7);
}

function addPuffs(sinks: SpriteSinks, center: Vector3, spread: number, age: number, color: SpriteColor): void {
  const fade = (1 - smoothstep(0.2, 1, age / EXPLOSION_SECONDS)) * 0.8;
  const look = [...color, fade];

  for (let puff = 0; puff < DUST_PUFFS; puff += 1) {
    const angle = hashToUnit(puff, 1) * FULL_TURN;
    const reach = (0.3 + hashToUnit(puff, 2) * 0.9) * spread * (0.4 + age * 0.9);
    const rise = (6 + hashToUnit(puff, 3) * 24) * Math.sqrt(age);

    sinks.dust.add(
      [
        center.x + Math.cos(angle) * reach,
        center.y + rise,
        center.z + Math.sin(angle) * reach,
        spread * 0.35 + age * 9,
      ],
      look
    );
  }
}

export class LightningStrike implements ActiveEffect {
  readonly meshes: readonly Mesh[];
  readonly #bolt: Mesh;
  readonly #effectMeshes: EffectMeshes;
  #age = 0;

  constructor(context: EffectContext, effect: LightningEffect) {
    const ground = new Vector3(effect.x, context.heightAt(effect.x, effect.z), effect.z);
    const skyOffset = new Vector3((Math.random() - 0.5) * 300, BOLT_HEIGHT, (Math.random() - 0.5) * 300);

    const trunk = jaggedPath(ground.clone().add(skyOffset), ground, 0.42);
    const strands = [
      toRibbon(trunk, 1.6),
      ...[0.3, 0.55, 0.7].map((share) => {
        return branchFrom(trunk, share);
      }),
    ];

    this.#effectMeshes = context.meshes;
    this.#bolt = context.meshes.createBolt(strands);
    this.meshes = [this.#bolt];
    context.flash(effect.isNatural ? 0.75 : 1);
    context.light(ground.clone().setY(ground.y + 40), 0xcf_e0_ff, 9);
  }

  update(seconds: number): boolean {
    this.#age += seconds;

    const flicker = Math.random() > 0.35 ? 1 : 0.35;

    this.#effectMeshes.setBoltBrightness(this.#bolt, (1 - smoothstep(0.08, BOLT_SECONDS, this.#age)) * flicker);

    return this.#age < BOLT_SECONDS;
  }

  finish(): void {
    this.#bolt.geometry.dispose();
  }
}

export class Explosion implements ActiveEffect {
  readonly meshes: readonly Mesh[];
  readonly #center: Vector3;
  readonly #context: EffectContext;
  readonly #effect: ExplosionEffect;
  readonly #fireball: Mesh;
  readonly #ring: GroundRing;
  #age = 0;

  constructor(context: EffectContext, effect: ExplosionEffect) {
    this.#context = context;
    this.#effect = effect;
    this.#center = new Vector3(effect.x, context.heightAt(effect.x, effect.z), effect.z);
    this.#fireball = context.meshes.createFireball();
    this.#fireball.position.copy(this.#center);
    this.#fireball.visible = !effect.isInWater;
    this.#ring = context.takeRing();
    this.meshes = [this.#fireball, this.#ring.mesh];
    context.flash(0.5);
    context.shake(effect.power * 3 + effect.radius * 0.05, effect.x, effect.z);
    context.light(this.#center.clone().setY(this.#center.y + 15), 0xff_9a_4a, 14);
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const growth = smoothstep(0, 0.35, this.#age);
    const heat = 1 - smoothstep(0.15, 1.7, this.#age);
    const { radius } = this.#effect;

    this.#fireball.scale.setScalar(Math.max(0.01, radius * 0.5 * growth));
    this.#fireball.position.y = this.#center.y + radius * 0.25 * growth + this.#age * 6;
    this.#context.meshes.setFireballHeat(this.#fireball, heat);
    this.#ring.show(
      this.#center.x,
      this.#center.z,
      radius * 3.6 * smoothstep(0, 1, this.#age),
      RING_COLOR,
      1 - smoothstep(0.2, 1, this.#age)
    );

    addPuffs(sinks, this.#center, radius, this.#age, this.#effect.isInWater ? WATER_DUST : LAND_DUST);

    return this.#age < EXPLOSION_SECONDS;
  }

  finish(): void {
    this.#context.releaseRing(this.#ring);
  }
}

export class EmberFlight implements ActiveEffect {
  readonly isOnGameClock = true;
  readonly meshes: readonly Mesh[] = [];
  readonly #effect: EmberEffect;
  readonly #from: Vector3;
  readonly #position = new Vector3();
  readonly #to: Vector3;
  #age = 0;

  constructor(context: EffectContext, effect: EmberEffect) {
    this.#effect = effect;
    this.#from = new Vector3(effect.fromX, context.heightAt(effect.fromX, effect.fromZ) + 10, effect.fromZ);
    this.#to = new Vector3(effect.toX, context.heightAt(effect.toX, effect.toZ) + 0.5, effect.toZ);
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const duration = this.#effect.durationSeconds;
    const flicker = 0.6 + Math.random() * 0.4;
    const progress = saturate(this.#age / duration);

    const position = this.#position.lerpVectors(this.#from, this.#to, progress);

    position.y += Math.sin(progress * Math.PI) * 22;
    sinks.glow.add([position.x, position.y, position.z, 1.6], [1, 0.5 * flicker, 0.12, flicker]);

    return this.#age < duration;
  }
}

export class Earthquake implements ActiveEffect {
  readonly meshes: readonly Mesh[] = [];
  readonly #context: EffectContext;
  readonly #effect: EarthquakeEffect;
  #age = 0;

  constructor(context: EffectContext, effect: EarthquakeEffect) {
    this.#context = context;
    this.#effect = effect;
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const strength = this.#effect.magnitude * (1 - smoothstep(0.5, EARTHQUAKE_SECONDS, this.#age));

    this.#context.shake(strength * 2.5, this.#effect.x, this.#effect.z);

    const fade = smoothstep(0, 0.4, this.#age) * (1 - smoothstep(1.5, EARTHQUAKE_SECONDS, this.#age)) * 0.45;
    const look = [0.55, 0.47, 0.38, fade];

    for (let puff = 0; puff < DUST_PUFFS; puff += 1) {
      const angle = hashToUnit(puff, 7) * FULL_TURN;
      const reach = Math.sqrt(hashToUnit(puff, 8)) * this.#effect.radius;

      const x = this.#effect.x + Math.cos(angle) * reach;
      const z = this.#effect.z + Math.sin(angle) * reach;

      sinks.dust.add([x, this.#context.heightAt(x, z) + 2 + this.#age * 3, z, 9 + this.#age * 5], look);
    }

    return this.#age < EARTHQUAKE_SECONDS;
  }
}

export class Blessing implements ActiveEffect {
  readonly meshes: readonly Mesh[] = [];
  readonly #context: EffectContext;
  readonly #effect: BlessingEffect;
  #age = 0;

  constructor(context: EffectContext, effect: BlessingEffect) {
    this.#context = context;
    this.#effect = effect;
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const [red, green, blue] = BLESSING_COLORS[this.#effect.style];

    const fade = smoothstep(0, 0.3, this.#age) * (1 - smoothstep(1.8, BLESSING_SECONDS, this.#age));

    for (let sparkle = 0; sparkle < SPARKLES; sparkle += 1) {
      const angle = hashToUnit(sparkle, 11) * FULL_TURN;
      const reach = Math.sqrt(hashToUnit(sparkle, 12)) * Math.min(this.#effect.radius, 120);
      const rise = lerp(0, 18, (this.#age * (0.6 + hashToUnit(sparkle, 13))) % 1);
      const twinkle = 0.5 + 0.5 * Math.sin(this.#age * 9 + sparkle);

      const x = this.#effect.x + Math.cos(angle) * reach;
      const z = this.#effect.z + Math.sin(angle) * reach;

      sinks.glow.add(
        [x, this.#context.heightAt(x, z) + 1 + rise, z, 1.2 + twinkle],
        [red, green, blue, fade * twinkle]
      );
    }

    return this.#age < BLESSING_SECONDS;
  }
}

export class Splash implements ActiveEffect {
  readonly meshes: readonly Mesh[] = [];
  readonly #effect: SplashEffect;
  #age = 0;

  constructor(effect: SplashEffect) {
    this.#effect = effect;
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const { level, x, z } = this.#effect;

    const age = this.#age / SPLASH_SECONDS;
    const fade = (1 - smoothstep(0.35, 1, age)) * 0.85;
    const look = [...SPLASH_COLOR, fade];

    for (let drop = 0; drop < SPLASH_DROPS; drop += 1) {
      const angle = hashToUnit(drop, 7, x + z) * FULL_TURN;
      const reach = (0.2 + hashToUnit(drop, 8, x - z) * 0.5) * age;
      const rise = (0.35 + hashToUnit(drop, 9, x) * 0.45) * 4 * age * (1 - age);

      sinks.dust.add([x + Math.cos(angle) * reach, level + rise, z + Math.sin(angle) * reach, 0.16 + age * 0.22], look);
    }

    return this.#age < SPLASH_SECONDS;
  }
}
