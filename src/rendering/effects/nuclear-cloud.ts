import { type Mesh, Vector3 } from "three/webgpu";
import { FULL_TURN, hashToUnit, smoothstep } from "../../shared/math.ts";
import type { NuclearCloudEffect } from "../../simulation/effects.ts";
import type { CameraAxes } from "./billboards.ts";
import type { ActiveEffect, EffectContext, SpriteSinks } from "./effect-context.ts";
import { type GroundRing, NO_FLOOR } from "./ground-ring.ts";
import { NuclearPlume } from "./nuclear-plume.ts";

const CLOUD_SECONDS = 9.7;
const SHOCK_SECONDS = 2.2;
const GROUND_PUFFS = 48;
const SHOCK_PUFFS = Array.from({ length: GROUND_PUFFS }, (_, index) => {
  const angle = ((index + hashToUnit(index, 3) * 0.45) * FULL_TURN) / GROUND_PUFFS;
  const reach = 0.86 + hashToUnit(index, 7) * 0.13;

  return { size: 0.21 + hashToUnit(index, 4) * 0.26, x: Math.cos(angle) * reach, z: Math.sin(angle) * reach };
});

export class NuclearCloud implements ActiveEffect {
  readonly meshes: readonly Mesh[];
  readonly #context: EffectContext;
  readonly #craterDepth: number;
  readonly #effect: NuclearCloudEffect;
  readonly #fireball: Mesh;
  readonly #ring: GroundRing;
  readonly #plume: NuclearPlume;
  #age = 0;

  constructor(context: EffectContext, effect: NuclearCloudEffect, axes: CameraAxes) {
    this.#context = context;
    this.#effect = effect;
    this.#ring = context.takeRing();
    this.#fireball = context.meshes.createFireball();
    this.#plume = new NuclearPlume(axes);
    const floor = effect.isInWater
      ? effect.surfaceY
      : Math.min(effect.surfaceY, context.surface.heightAt(effect.x, effect.z));

    this.#craterDepth = effect.surfaceY - floor;
    this.#plume.mesh.position.set(effect.x, floor, effect.z);
    this.#fireball.position.set(effect.x, effect.surfaceY, effect.z);
    this.#fireball.renderOrder = 5;
    this.#fireball.scale.setScalar(Math.max(1, effect.radius * 0.18));
    this.meshes = [this.#fireball, this.#plume.mesh, this.#ring.mesh];
    context.flash(0.62);
    context.shake(effect.radius * 0.13, effect.x, effect.z);
    context.light(new Vector3(effect.x, effect.surfaceY + effect.radius * 0.2, effect.z), 0xff_b5_66, 26);
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    if (this.#age >= CLOUD_SECONDS) {
      return false;
    }

    const { x, z, radius, surfaceY } = this.#effect;
    const fire = 1 - smoothstep(0.23, 1.15, this.#age);

    this.#plume.update(this.#age, radius, this.#craterDepth);
    this.#fireball.visible = fire > 0.02;
    this.#fireball.position.y = surfaceY + radius * (0.09 + smoothstep(0, 0.9, this.#age) * 0.42);
    this.#fireball.scale.setScalar(radius * (0.13 + smoothstep(0, 0.36, this.#age) * 0.36) * fire);
    this.#context.meshes.setFireballHeat(this.#fireball, fire * 0.82);

    if (fire > 0) {
      sinks.glow.add(
        [x, this.#fireball.position.y, z, radius * (1.15 + this.#age * 1.35)],
        [1, 0.55, 0.18, fire * 0.46]
      );
    }

    this.#drawShock(sinks);

    return true;
  }

  finish(): void {
    this.#context.releaseRing(this.#ring);
    this.#plume.dispose();
  }

  #drawShock(sinks: SpriteSinks): void {
    if (this.#age >= SHOCK_SECONDS) {
      this.#ring.hide();

      return;
    }

    const { x, z, radius, surfaceY, isInWater } = this.#effect;
    const time = this.#age / SHOCK_SECONDS;
    const distance = radius * (0.13 + 2.9 * (1 - (1 - time) ** 2));
    const fade = 1 - smoothstep(0.16, 1, time);
    const floor = isInWater ? surfaceY : NO_FLOOR;
    const shade = isInWater ? [0.78, 0.87, 0.91, fade * 0.83] : [0.65, 0.46, 0.28, fade * 0.83];

    this.#ring.show(x, z, distance, 0xff_e2_ac, fade, floor, radius * (0.055 + time * 0.09));

    for (const puff of SHOCK_PUFFS) {
      const groundX = x + distance * puff.x;
      const groundZ = z + distance * puff.z;
      const size = radius * puff.size * (0.27 + time * 1.8);
      const height = Math.max(floor, this.#context.surface.heightAt(groundX, groundZ));

      sinks.dust.add([groundX, height + size * 0.25, groundZ, size], shade);
    }
  }
}
