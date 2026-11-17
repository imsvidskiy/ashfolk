import { type Mesh, Vector3 } from "three/webgpu";
import { FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import type { NuclearCloudEffect } from "../../simulation/effects.ts";
import type { GroundRing } from "./ground-ring.ts";
import type { ActiveEffect, EffectContext, SpriteSinks } from "./transient-effects.ts";

const CLOUD_SECONDS = 8;
const CAP_PUFFS = 64;
const COLUMN_PUFFS = 24;

const CLOUD_CAP = Array.from({ length: CAP_PUFFS }, (_, puff) => {
  const angle = puff * 2.399_96;
  const share = Math.sqrt((puff + 0.5) / CAP_PUFFS);
  const reach = share * (0.9 + hashToUnit(puff, 4) * 0.2);

  return {
    ash: 0.5 + hashToUnit(puff, 5) * 0.9,
    ember: (0.1 + share * share * 0.9) * (0.45 + hashToUnit(puff, 7) * 0.55),
    size: 0.47 + 0.18 * share,
    x: Math.cos(angle) * reach,
    y: 0.48 * Math.sqrt(1 - share * share) + hashToUnit(puff, 2) * 0.13,
    z: Math.sin(angle) * reach,
  };
});

const CLOUD_COLUMN = Array.from({ length: COLUMN_PUFFS }, (_, puff) => {
  const share = puff / COLUMN_PUFFS;

  return {
    angle: hashToUnit(puff, 8) * FULL_TURN,
    reach: 0.1 * Math.sin(share * Math.PI),
    share,
    size: 0.26 + share * share * 0.3 + 0.3 * (1 - share) ** 5,
  };
});

export class NuclearCloud implements ActiveEffect {
  readonly meshes: readonly Mesh[];
  readonly #base: Vector3;
  readonly #context: EffectContext;
  readonly #radius: number;
  readonly #ring: GroundRing;
  #age = 0;

  constructor(context: EffectContext, effect: NuclearCloudEffect) {
    this.#context = context;
    this.#radius = effect.radius;
    this.#base = new Vector3(effect.x, effect.surfaceY, effect.z);
    this.#ring = context.takeRing();
    this.meshes = [this.#ring.mesh];
    context.flash(0.8);
    context.shake(effect.radius * 0.13, effect.x, effect.z);
    context.light(this.#base, 0xff_ab_54, 24);
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const { x, y, z } = this.#base;
    const lift = this.#radius * (smoothstep(0, 2, this.#age) * 1.3 + this.#age * 0.1);
    const width = this.#radius * (0.08 + smoothstep(0, 2.5, this.#age) * 0.92);
    const fade = 1 - smoothstep(3.5, CLOUD_SECONDS, this.#age);
    const heat = 1 - smoothstep(0.4, 3.5, this.#age);
    const shade = lerp(0.37, 0.17, fade);

    this.#ring.show(
      x,
      z,
      this.#radius * 3.5 * smoothstep(0, 1.8, this.#age),
      0xff_dc_99,
      1 - smoothstep(0.3, 1.8, this.#age)
    );

    for (const puff of CLOUD_CAP) {
      const ember = heat * puff.ember;
      const ash = shade * puff.ash;

      sinks.dust.add(
        [x + width * puff.x, y + lift + width * puff.y, z + width * puff.z, width * puff.size],
        [ash + ember * 1.5, ash * 0.8 + ember * 0.42, ash * 0.7 + ember * 0.06, fade * 0.94]
      );
    }

    for (const puff of CLOUD_COLUMN) {
      const angle = puff.angle + this.#age * 0.35;
      const reach = width * puff.reach;

      sinks.dust.add(
        [x + Math.cos(angle) * reach, y + lift * puff.share, z + Math.sin(angle) * reach, width * puff.size],
        [shade + heat * 0.7, shade * 0.8 + heat * 0.22, shade * 0.72, fade * 0.78]
      );
    }

    sinks.glow.add([x, y + lift, z, width * 1.2], [1, 0.46, 0.08, heat * 0.25]);

    return this.#age < CLOUD_SECONDS;
  }

  finish(): void {
    this.#context.releaseRing(this.#ring);
  }
}
