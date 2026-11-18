import type { BlackHoleEffect, NuclearFallEffect } from "../simulation/effects.ts";
import type { SimulationFrame } from "../simulation/frame.ts";
import { TICK_SECONDS } from "../simulation/tick.ts";
import type { HearingView } from "./hearing-view.ts";
import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import type { SoundEngine, SoundLoop, SoundPoint } from "./sound-engine.ts";

const FALL_SECONDS = 2.8;
const TAIL_DELAY_SECONDS = 0.32;
const BOMB_SOUNDS = [SOUNDS.nuclearFall, SOUNDS.nuclearImpact, SOUNDS.nuclearTail];

const OPEN_SECONDS = 1.08;
const HUM_START = 0.4;
const HUM_FADE = 0.28;
const SILENCE_FADE = 0.12;
const WELL_SOUNDS = [SOUNDS.blackHoleOpen, SOUNDS.blackHoleHum, SOUNDS.blackHoleCollapse];

type SoundFrame = Pick<SimulationFrame, "effects" | "isPaused" | "speed" | "tick">;

interface Drop {
  readonly landsAt: number;
  readonly point: SoundPoint;
  voice: AbortController | null;
}

interface Well {
  readonly isRestored: boolean;
  readonly openedAt: number;
  readonly point: SoundPoint;
  voice: AbortController | null;
}

interface Hum {
  readonly loop: SoundLoop;
  readonly well: Well;
}

function surfacePoint(effect: { surfaceY: number; x: number; z: number }): SoundPoint {
  return { x: effect.x, y: effect.surfaceY, z: effect.z };
}

export class DisasterSounds {
  readonly #engine: SoundEngine;
  readonly #drops = new Map<number, Drop>();
  readonly #wells = new Map<number, Well>();
  readonly #lifetime = new AbortController();
  readonly #prepared = new Set<readonly SoundDefinition[]>();
  #hum: Hum | null = null;
  #speed = 0;
  #tail: AbortController | null = null;

  constructor(engine: SoundEngine) {
    this.#engine = engine;
  }

  hear(frame: SoundFrame, view: HearingView, isJoining = false): void {
    const time = frame.tick * TICK_SECONDS;
    const { effects, master } = this.#engine.levels;
    const canHear = this.#engine.isAudible && effects > 0 && master > 0;
    const speed = frame.isPaused || !canHear ? 0 : frame.speed;

    if (this.#speed !== speed) {
      this.#stopTimedVoices();
      this.#speed = speed;
    }

    for (const effect of frame.effects) {
      switch (effect.kind) {
        case "nuclear-fall":
          this.#trackDrop(effect, time);
          break;

        case "nuclear-cloud":
          if (!isJoining) {
            this.#impact(effect.dropId, surfacePoint(effect), canHear);
          }
          break;

        case "black-hole":
          this.#trackWell(effect, time, isJoining);
          break;

        case "black-hole-collapse":
          if (!isJoining) {
            this.#collapse(effect.wellId, canHear);
          }
          break;

        default:
      }
    }

    if (!canHear) {
      return;
    }

    this.#prepare(BOMB_SOUNDS, this.#drops.size);
    this.#prepare(WELL_SOUNDS, this.#wells.size);

    if (speed === 0) {
      return;
    }

    for (const drop of this.#drops.values()) {
      const remaining = (drop.landsAt - time) / speed;

      if (drop.voice === null && remaining > 0 && remaining <= FALL_SECONDS) {
        drop.voice = new AbortController();
        this.#engine.play(SOUNDS.nuclearFall, drop.point, {
          offsetSeconds: FALL_SECONDS - remaining,
          signal: drop.voice.signal,
        });
      }
    }

    this.#hearWells(time, view);
  }

  dispose(): void {
    this.#stopTimedVoices();
    this.#lifetime.abort();
    this.#tail?.abort();
    this.#drops.clear();
    this.#wells.clear();
  }

  #prepare(sounds: readonly SoundDefinition[], activeCount: number): void {
    if (activeCount > 0 && !this.#prepared.has(sounds)) {
      this.#engine.preload(sounds);
      this.#prepared.add(sounds);
    }
  }

  #trackDrop(effect: NuclearFallEffect, time: number): void {
    if (this.#drops.has(effect.dropId)) {
      return;
    }

    const { elapsedSeconds = 0 } = effect;

    this.#drops.set(effect.dropId, {
      landsAt: time + effect.durationSeconds - elapsedSeconds,
      point: surfacePoint(effect),
      voice: null,
    });
  }

  #trackWell(effect: BlackHoleEffect, time: number, isJoining: boolean): void {
    const { elapsedSeconds = 0, wellId } = effect;

    if (wellId === undefined || this.#wells.has(wellId)) {
      return;
    }

    this.#wells.set(wellId, {
      isRestored: isJoining || effect.elapsedSeconds !== undefined,
      openedAt: time - elapsedSeconds,
      point: surfacePoint(effect),
      voice: null,
    });
  }

  #impact(dropId: number, point: SoundPoint, canHear: boolean): void {
    this.#drops.get(dropId)?.voice?.abort();
    this.#drops.delete(dropId);
    this.#tail?.abort();

    if (!canHear) {
      return;
    }

    this.#tail = new AbortController();
    this.#engine.play(SOUNDS.nuclearImpact, point, { offsetSeconds: 0, signal: this.#lifetime.signal });
    this.#engine.play(SOUNDS.nuclearTail, point, {
      delaySeconds: TAIL_DELAY_SECONDS,
      offsetSeconds: 0,
      signal: this.#tail.signal,
    });
  }

  #collapse(wellId: number, canHear: boolean): void {
    const well = this.#wells.get(wellId);

    if (well === undefined) {
      return;
    }

    well.voice?.abort();
    this.#wells.delete(wellId);

    if (this.#hum?.well === well) {
      this.#hum.loop.stop(SILENCE_FADE);
      this.#hum = null;
    }

    if (canHear) {
      this.#engine.play(SOUNDS.blackHoleCollapse, well.point, { offsetSeconds: 0, signal: this.#lifetime.signal });
    }
  }

  #hearWells(time: number, view: HearingView): void {
    let nearest: Well | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const well of this.#wells.values()) {
      const age = time - well.openedAt;

      if (!well.isRestored && well.voice === null && age < OPEN_SECONDS) {
        well.voice = new AbortController();
        this.#engine.play(SOUNDS.blackHoleOpen, well.point, { offsetSeconds: age, signal: well.voice.signal });
      }

      const distance = Math.hypot(well.point.x - view.focusX, well.point.z - view.focusZ);

      if ((well.isRestored || age >= HUM_START) && distance < bestDistance) {
        nearest = well;
        bestDistance = distance;
      }
    }

    if (nearest === null || this.#hum?.well === nearest) {
      return;
    }

    this.#hum?.loop.stop(HUM_FADE);

    const loop = this.#engine.loop(SOUNDS.blackHoleHum, nearest.point, {
      offsetSeconds: time - nearest.openedAt,
      seconds: HUM_FADE,
      volume: 1,
    });

    this.#hum = loop === null ? null : { loop, well: nearest };
  }

  #stopTimedVoices(): void {
    for (const drop of this.#drops.values()) {
      drop.voice?.abort();
      drop.voice = null;
    }

    for (const well of this.#wells.values()) {
      well.voice?.abort();
      well.voice = null;
    }

    this.#hum?.loop.stop(SILENCE_FADE);
    this.#hum = null;
  }
}
