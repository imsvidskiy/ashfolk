import type { Mesh } from "three/webgpu";
import type { Color } from "../../content/grounds.ts";
import { FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import type { BlessingEffect } from "../../simulation/effects.ts";
import type { ActiveEffect, EffectSurface, SpriteSinks } from "./effect-context.ts";

const BLESSING_SECONDS = 3;
const SPARKLES = 70;
const BLESSING_COLORS: Readonly<Record<BlessingEffect["style"], Color>> = {
  abundance: [1, 0.78, 0.3],
  healing: [0.45, 1, 0.55],
  inspiration: [0.55, 0.75, 1],
};

export class Blessing implements ActiveEffect {
  readonly meshes: readonly Mesh[] = [];
  readonly #surface: Pick<EffectSurface, "heightAt">;
  readonly #effect: BlessingEffect;
  #age = 0;

  constructor(surface: Pick<EffectSurface, "heightAt">, effect: BlessingEffect) {
    this.#surface = surface;
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
        [x, this.#surface.heightAt(x, z) + 1 + rise, z, 1.2 + twinkle],
        [red, green, blue, fade * twinkle]
      );
    }

    return this.#age < BLESSING_SECONDS;
  }
}
