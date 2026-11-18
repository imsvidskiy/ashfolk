import { type Mesh, Vector3 } from "three/webgpu";
import type { Color } from "../../content/grounds.ts";
import { FULL_TURN, hashToUnit, smoothstep } from "../../shared/math.ts";
import type { ExplosionEffect } from "../../simulation/effects.ts";
import type { ActiveEffect, EffectContext, SpriteSinks } from "./effect-context.ts";
import { type GroundRing, NO_FLOOR } from "./ground-ring.ts";

const EXPLOSION_SECONDS = 3;
const RING_COLOR = 0xff_f0_d8;
const WATER_DUST: Color = [0.85, 0.9, 0.95];
const LAND_DUST: Color = [0.3, 0.27, 0.24];
const DUST_PUFFS = 26;

type ExplosionContext = Omit<EffectContext, "surface">;

function addPuffs(sinks: SpriteSinks, center: Vector3, spread: number, age: number, color: Color): void {
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

export class Explosion implements ActiveEffect {
  readonly meshes: readonly Mesh[];
  readonly #center: Vector3;
  readonly #context: ExplosionContext;
  readonly #effect: ExplosionEffect;
  readonly #fireball: Mesh;
  readonly #ring: GroundRing;
  #age = 0;

  constructor(context: ExplosionContext, effect: ExplosionEffect) {
    this.#context = context;
    this.#effect = effect;
    this.#center = new Vector3(effect.x, effect.surfaceY, effect.z);
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

    const { radius } = this.#effect;

    const growth = smoothstep(0, 0.35, this.#age);
    const heat = 1 - smoothstep(0.15, 1.7, this.#age);

    this.#fireball.scale.setScalar(Math.max(0.01, radius * 0.5 * growth));
    this.#fireball.position.y = this.#center.y + radius * 0.25 * growth + this.#age * 6;
    this.#context.meshes.setFireballHeat(this.#fireball, heat);
    this.#ring.show(
      this.#center.x,
      this.#center.z,
      radius * 3.6 * smoothstep(0, 1, this.#age),
      RING_COLOR,
      1 - smoothstep(0.2, 1, this.#age),
      this.#effect.isInWater ? this.#center.y : NO_FLOOR
    );

    addPuffs(sinks, this.#center, radius, this.#age, this.#effect.isInWater ? WATER_DUST : LAND_DUST);

    return this.#age < EXPLOSION_SECONDS;
  }

  finish(): void {
    this.#context.releaseRing(this.#ring);
  }
}
