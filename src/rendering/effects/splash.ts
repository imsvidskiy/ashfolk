import type { Mesh } from "three/webgpu";
import type { Color } from "../../content/grounds.ts";
import { FULL_TURN, hashToUnit, smoothstep } from "../../shared/math.ts";
import type { SplashEffect } from "../../simulation/effects.ts";
import type { ActiveEffect, SpriteSinks } from "./effect-context.ts";

const SPLASH_SECONDS = 0.55;
const SPLASH_DROPS = 9;
const SPLASH_COLOR: Color = [0.86, 0.93, 0.97];

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
