import type { WorldGrid } from "../world/world-grid.ts";
import type { SoundDefinition } from "./sound-catalog.ts";
import type { SoundEngine, SoundLoop, SoundPoint } from "./sound-engine.ts";

const CELLS_FOR_FULL_VOLUME = 16;
const FADE_SECONDS = 1.2;
const LEVEL_SMOOTHING_SECONDS = 0.8;

export interface Emitter {
  readonly key: string;
  readonly volume: number;
  readonly x: number;
  readonly z: number;
}

interface Bucket {
  count: number;
  sumX: number;
  sumZ: number;
}

export interface CellGroups {
  readonly bucketSize: number;
  readonly focusX: number;
  readonly focusZ: number;
  readonly limit: number;
}

export function groupCells(grid: WorldGrid, cells: Iterable<number>, options: CellGroups): Emitter[] {
  const { bucketSize, focusX, focusZ, limit } = options;

  const buckets = new Map<string, Bucket>();

  for (const cell of cells) {
    const x = grid.cellCenterX(cell);
    const z = grid.cellCenterZ(cell);
    const key = `${Math.floor(x / bucketSize)},${Math.floor(z / bucketSize)}`;
    const bucket = buckets.get(key);

    if (bucket === undefined) {
      buckets.set(key, { count: 1, sumX: x, sumZ: z });

      continue;
    }

    bucket.count += 1;
    bucket.sumX += x;
    bucket.sumZ += z;
  }

  const emitters = [...buckets].map(([key, bucket]) => {
    const x = bucket.sumX / bucket.count;
    const z = bucket.sumZ / bucket.count;

    return {
      closeness: bucket.count / (1 + Math.hypot(x - focusX, z - focusZ) / bucketSize),
      emitter: { key, volume: Math.min(1, Math.sqrt(bucket.count / CELLS_FOR_FULL_VOLUME)), x, z },
    };
  });

  return emitters
    .toSorted((first, second) => {
      return second.closeness - first.closeness;
    })
    .slice(0, limit)
    .map((entry) => {
      return entry.emitter;
    });
}

export class EmitterLoops {
  readonly #engine: SoundEngine;
  readonly #heightAt: (x: number, z: number) => number;
  readonly #loops = new Map<string, SoundLoop>();
  readonly #sound: SoundDefinition;

  constructor(engine: SoundEngine, sound: SoundDefinition, heightAt: (x: number, z: number) => number) {
    this.#engine = engine;
    this.#sound = sound;
    this.#heightAt = heightAt;
  }

  update(emitters: readonly Emitter[]): void {
    const kept = new Set<string>();

    for (const emitter of emitters) {
      kept.add(emitter.key);
      this.#place(emitter);
    }

    for (const [key, loop] of this.#loops) {
      if (!kept.has(key)) {
        loop.stop(FADE_SECONDS);
        this.#loops.delete(key);
      }
    }
  }

  dispose(): void {
    this.update([]);
  }

  #place(emitter: Emitter): void {
    const point: SoundPoint = { x: emitter.x, y: this.#heightAt(emitter.x, emitter.z), z: emitter.z };
    const playing = this.#loops.get(emitter.key);

    if (playing !== undefined) {
      playing.setVolume(emitter.volume, LEVEL_SMOOTHING_SECONDS);
      playing.setPosition(point);

      return;
    }

    if (!this.#engine.isAudible) {
      return;
    }

    const loop = this.#engine.loop(this.#sound, point, { seconds: FADE_SECONDS, volume: emitter.volume });

    if (loop !== null) {
      this.#loops.set(emitter.key, loop);
    }
  }
}
