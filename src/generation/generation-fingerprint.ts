import { clamp } from "../shared/math.ts";
import type { GeneratedWorld } from "./world-generator.ts";

const MULTIPLIER = 0x01_00_01_93;
const STARTING_HASH = 0x81_1c_9d_c5;
const STEPS_PER_UNIT = 100;
const LARGEST_STEP = 1_000_000_000;
const UNSIGNED_RANGE = 2 ** 32;
const FINGERPRINT_LAYERS = ["baseTemperature", "carving", "ground", "height", "riverStrength", "waterSurface"] as const;

function mixed(hash: number, value: number): number {
  const step = Math.round(value * STEPS_PER_UNIT);

  if (Number.isNaN(step)) {
    return Math.imul(hash, MULTIPLIER);
  }

  return Math.imul(hash + clamp(step, -LARGEST_STEP, LARGEST_STEP), MULTIPLIER);
}

function mixedAll(hash: number, values: ArrayLike<number> & Iterable<number>): number {
  let next = mixed(hash, values.length);

  for (const value of values) {
    next = mixed(next, value);
  }

  return next;
}

export function generationFingerprint(world: GeneratedWorld): number {
  const { crossings, deposits, monuments, terrain, water } = world;

  const features = [
    water.rivers.length,
    ...water.rivers.flatMap((river) => {
      return [
        river.points.length,
        ...river.points.flatMap(({ surface, x, z }) => {
          return [x, z, surface];
        }),
      ];
    }),
    water.lakes.length,
    ...water.lakes.flatMap(({ cellCount, level }) => {
      return [cellCount, level];
    }),
    water.springs.length,
    ...water.springs.flatMap(({ level, x, z }) => {
      return [x, z, level];
    }),
    crossings.length,
    ...crossings.flatMap(({ endX, endZ, startX, startZ }) => {
      return [startX, startZ, endX, endZ];
    }),
    monuments.length,
    ...monuments.flatMap(({ cells, x, z }) => {
      return [x, z, cells.length];
    }),
    deposits.length,
    ...deposits.flatMap(({ cells, x, z }) => {
      return [x, z, cells.length];
    }),
  ];

  let hash = STARTING_HASH;

  for (const layer of FINGERPRINT_LAYERS) {
    hash = mixedAll(hash, terrain[layer]);
  }

  const fingerprint = mixedAll(hash, features);

  return fingerprint < 0 ? fingerprint + UNSIGNED_RANGE : fingerprint;
}
