import { type Mesh, Vector3 } from "three/webgpu";
import { saturate } from "../../shared/math.ts";
import type { EmberEffect } from "../../simulation/effects.ts";
import type { ActiveEffect, EffectSurface, SpriteSinks } from "./effect-context.ts";

export class EmberFlight implements ActiveEffect {
  readonly isOnGameClock = true;
  readonly meshes: readonly Mesh[] = [];
  readonly #effect: EmberEffect;
  readonly #from: Vector3;
  readonly #position = new Vector3();
  readonly #to: Vector3;
  #age = 0;

  constructor(surface: Pick<EffectSurface, "heightAt">, effect: EmberEffect) {
    this.#effect = effect;
    this.#from = new Vector3(effect.fromX, surface.heightAt(effect.fromX, effect.fromZ) + 10, effect.fromZ);
    this.#to = new Vector3(effect.toX, surface.heightAt(effect.toX, effect.toZ) + 0.5, effect.toZ);
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
