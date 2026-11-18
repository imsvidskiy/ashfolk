import type { Mesh } from "three/webgpu";
import type { Color } from "../../content/grounds.ts";
import { FULL_TURN, hashToUnit, smoothstep } from "../../shared/math.ts";
import type { EarthquakeEffect } from "../../simulation/effects.ts";
import type { ActiveEffect, EffectContext, SpriteSinks } from "./effect-context.ts";

const EARTHQUAKE_SECONDS = 3.2;
const EARTHQUAKE_DUST: Color = [0.55, 0.47, 0.38];
const DUST_PUFFS = 26;

type EarthquakeContext = Pick<EffectContext, "shake" | "surface">;

export class Earthquake implements ActiveEffect {
  readonly meshes: readonly Mesh[] = [];
  readonly #context: EarthquakeContext;
  readonly #effect: EarthquakeEffect;
  #age = 0;

  constructor(context: EarthquakeContext, effect: EarthquakeEffect) {
    this.#context = context;
    this.#effect = effect;
  }

  update(seconds: number, sinks: SpriteSinks): boolean {
    this.#age += seconds;

    const strength = this.#effect.magnitude * (1 - smoothstep(0.5, EARTHQUAKE_SECONDS, this.#age));

    this.#context.shake(strength * 2.5, this.#effect.x, this.#effect.z);

    const fade = smoothstep(0, 0.4, this.#age) * (1 - smoothstep(1.5, EARTHQUAKE_SECONDS, this.#age)) * 0.45;
    const look = [...EARTHQUAKE_DUST, fade];

    for (let puff = 0; puff < DUST_PUFFS; puff += 1) {
      const angle = hashToUnit(puff, 7) * FULL_TURN;
      const reach = Math.sqrt(hashToUnit(puff, 8)) * this.#effect.radius;

      const x = this.#effect.x + Math.cos(angle) * reach;
      const z = this.#effect.z + Math.sin(angle) * reach;

      sinks.dust.add([x, this.#context.surface.heightAt(x, z) + 2 + this.#age * 3, z, 9 + this.#age * 5], look);
    }

    return this.#age < EARTHQUAKE_SECONDS;
  }
}
