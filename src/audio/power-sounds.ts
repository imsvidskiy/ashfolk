import type { PowerId } from "../content/powers.ts";
import type { SimulationCommand } from "../simulation/commands.ts";
import { AMBIENCE_LAYERS, SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import type { SoundEngine, SoundLoop, SoundPoint } from "./sound-engine.ts";

const BRUSH_FADE_SECONDS = 0.35;
const CALL_DELAY_SECONDS = 0.3;
const REPEAT_SECONDS = 0.9;

const CASTS: ReadonlyMap<PowerId, readonly SoundDefinition[]> = new Map([
  ["deer", [SOUNDS.spawn, SOUNDS.animalDeer]],
  ["hare", [SOUNDS.spawn, SOUNDS.animalHare]],
  ["ibex", [SOUNDS.spawn, SOUNDS.animalIbex]],
  ["mammoth", [SOUNDS.spawn, SOUNDS.animalMammoth]],
  ["tribe", [SOUNDS.tribeArrive]],
  ["volcano", [SOUNDS.volcanoRise]],
  ["wolf", [SOUNDS.spawn, SOUNDS.animalWolves]],
]);

const BRUSHES: ReadonlyMap<PowerId, Brush> = new Map([
  ["fire", { begin: SOUNDS.fireIgnite, held: null, repeated: null }],
  ["flatten", { begin: null, held: SOUNDS.landSmooth, repeated: null }],
  ["forest", { begin: null, held: null, repeated: SOUNDS.forestGrow }],
  ["lower", { begin: null, held: SOUNDS.landLower, repeated: null }],
  ["paint", { begin: null, held: SOUNDS.paintGround, repeated: null }],
  ["rain", { begin: SOUNDS.rainStart, held: AMBIENCE_LAYERS.rainLight, repeated: null }],
  ["raise", { begin: null, held: SOUNDS.landRaise, repeated: null }],
  ["smooth", { begin: null, held: SOUNDS.landSmooth, repeated: null }],
  ["snow", { begin: SOUNDS.snowStart, held: AMBIENCE_LAYERS.windSnowy, repeated: null }],
]);

interface Brush {
  readonly begin: SoundDefinition | null;
  readonly held: SoundDefinition | null;
  readonly repeated: SoundDefinition | null;
}

interface Stroke {
  readonly brush: Brush;
  readonly loop: SoundLoop | null;
  nextRepeatAt: number;
  point: SoundPoint;
}

interface Cast {
  readonly point: SoundPoint;
  readonly sounds: readonly SoundDefinition[];
}

export class PowerSounds {
  readonly #engine: SoundEngine;
  readonly #heightAt: (x: number, z: number) => number;
  #pending: Cast[] = [];
  #stroke: Stroke | null = null;

  constructor(engine: SoundEngine, heightAt: (x: number, z: number) => number) {
    this.#engine = engine;
    this.#heightAt = heightAt;
  }

  hear(command: SimulationCommand, now: number): void {
    switch (command.type) {
      case "usePower":
        this.#cast(command.powerId, this.#pointAt(command.x, command.z));

        return;
      case "beginStroke":
        this.#begin(command.powerId, this.#pointAt(command.x, command.z), now);

        return;
      case "moveStroke":
        this.#move(this.#pointAt(command.x, command.z));

        return;
      case "endStroke":
        this.#end();

        return;
      default:
    }
  }

  settle(wasRefused: boolean): void {
    const casts = this.#pending;

    this.#pending = [];

    if (wasRefused) {
      return;
    }

    for (const cast of casts) {
      for (const [index, sound] of cast.sounds.entries()) {
        this.#engine.play(sound, cast.point, { delaySeconds: index * CALL_DELAY_SECONDS });
      }
    }
  }

  update(now: number): void {
    const stroke = this.#stroke;

    if (stroke === null || stroke.brush.repeated === null || now < stroke.nextRepeatAt) {
      return;
    }

    stroke.nextRepeatAt = now + REPEAT_SECONDS;
    this.#engine.play(stroke.brush.repeated, stroke.point);
  }

  dispose(): void {
    this.#end();
    this.#pending = [];
  }

  #cast(powerId: PowerId, point: SoundPoint): void {
    const sounds = CASTS.get(powerId);

    if (sounds !== undefined) {
      this.#pending.push({ point, sounds });
    }
  }

  #begin(powerId: PowerId, point: SoundPoint, now: number): void {
    this.#end();

    const brush = BRUSHES.get(powerId);

    if (brush === undefined) {
      return;
    }

    if (brush.begin !== null) {
      this.#engine.play(brush.begin, point);
    }

    const loop =
      brush.held === null ? null : this.#engine.loop(brush.held, point, { seconds: BRUSH_FADE_SECONDS, volume: 1 });

    this.#stroke = { brush, loop, nextRepeatAt: now + (brush.begin === null ? 0 : REPEAT_SECONDS), point };
  }

  #move(point: SoundPoint): void {
    const stroke = this.#stroke;

    if (stroke === null) {
      return;
    }

    stroke.point = point;

    if (stroke.loop !== null) {
      stroke.loop.setPosition(point);
    }
  }

  #end(): void {
    const stroke = this.#stroke;

    this.#stroke = null;

    if (stroke !== null && stroke.loop !== null) {
      stroke.loop.stop(BRUSH_FADE_SECONDS);
    }
  }

  #pointAt(x: number, z: number): SoundPoint {
    return { x, y: this.#heightAt(x, z), z };
  }
}
