import type { SimulationEffect, TornadoEffect } from "../simulation/effects.ts";
import { tornadoDuration, tornadoPositionAt } from "../simulation/powers/tornadoes.ts";
import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import type { PlayOptions, SoundEngine, SoundLoop, SoundPoint } from "./sound-engine.ts";

const SPEED_OF_SOUND = 343;
const LONGEST_THUNDER_DELAY = 4;
const CLOSE_LIGHTNING = 250;
const TORNADO_FADE_SECONDS = 1.5;
const METEOR_WHISTLE_SECONDS = 2.4;

const BLESSINGS = {
  abundance: SOUNDS.blessingAbundance,
  healing: SOUNDS.blessingHealing,
  inspiration: SOUNDS.blessingInspiration,
} as const;

export interface EffectListener {
  readonly focusX: number;
  readonly focusZ: number;
}

interface GroundPlace {
  readonly x: number;
  readonly z: number;
}

interface Twister {
  readonly duration: number;
  readonly effect: TornadoEffect;
  readonly loop: SoundLoop;
  readonly startedAt: number;
}

export class EffectSounds {
  readonly #engine: SoundEngine;
  readonly #heightAt: (x: number, z: number) => number;
  readonly #twisters: Twister[] = [];

  constructor(engine: SoundEngine, heightAt: (x: number, z: number) => number) {
    this.#engine = engine;
    this.#heightAt = heightAt;
  }

  hear(effect: SimulationEffect, listener: EffectListener, now: number): void {
    switch (effect.kind) {
      case "arrow":
        this.#play(SOUNDS.arrow, effect.toX, effect.toZ);

        return;
      case "blessing":
        this.#play(BLESSINGS[effect.style], effect.x, effect.z);

        return;
      case "earthquake":
        this.#play(SOUNDS.earthquake, effect.x, effect.z, { volume: Math.min(1, 0.5 + effect.magnitude * 0.5) });

        return;
      case "ember":
        return;
      case "explosion":
        this.#play(effect.isInWater ? SOUNDS.explosionWater : SOUNDS.explosion, effect.x, effect.z);

        return;
      case "lightning":
        this.#hearLightning(effect.x, effect.z, effect.isNatural, listener);

        return;
      case "meteor":
        this.#play(SOUNDS.meteorFall, effect.toX, effect.toZ, {
          delaySeconds: Math.max(0, effect.durationSeconds - METEOR_WHISTLE_SECONDS),
        });
        this.#play(SOUNDS.meteorImpact, effect.toX, effect.toZ, { delaySeconds: effect.durationSeconds });

        return;
      case "splash":
        this.#play(SOUNDS.splash, effect.x, effect.z, { volume: Math.min(1, 0.4 + effect.level) });

        return;
      case "tornado":
        this.#startTwister(effect, now);

        return;
      default:
    }
  }

  update(now: number): void {
    for (let index = this.#twisters.length - 1; index >= 0; index -= 1) {
      const twister = this.#twisters[index];
      const age = now - twister.startedAt;

      if (age >= twister.duration) {
        twister.loop.stop(TORNADO_FADE_SECONDS);
        this.#twisters.splice(index, 1);

        continue;
      }

      twister.loop.setPosition(this.#pointAt(tornadoPositionAt(twister.effect.path, age)));
    }
  }

  dispose(): void {
    for (const twister of this.#twisters.splice(0)) {
      twister.loop.stop(TORNADO_FADE_SECONDS);
    }
  }

  #hearLightning(x: number, z: number, isNatural: boolean, listener: EffectListener): void {
    const distance = Math.hypot(x - listener.focusX, z - listener.focusZ);

    if (!isNatural || distance < CLOSE_LIGHTNING) {
      this.#play(SOUNDS.lightning, x, z);

      return;
    }

    this.#play(SOUNDS.thunderFar, x, z, { delaySeconds: Math.min(LONGEST_THUNDER_DELAY, distance / SPEED_OF_SOUND) });
  }

  #startTwister(effect: TornadoEffect, now: number): void {
    const start = tornadoPositionAt(effect.path, 0);
    const loop = this.#engine.loop(SOUNDS.tornado, this.#pointAt(start), { seconds: TORNADO_FADE_SECONDS, volume: 1 });

    if (loop === null) {
      return;
    }

    this.#twisters.push({ duration: tornadoDuration(effect.path), effect, loop, startedAt: now });
  }

  #play(sound: SoundDefinition, x: number, z: number, options: PlayOptions = {}): void {
    this.#engine.play(sound, this.#pointAt({ x, z }), options);
  }

  #pointAt(place: GroundPlace): SoundPoint {
    return { x: place.x, y: this.#heightAt(place.x, place.z), z: place.z };
  }
}
