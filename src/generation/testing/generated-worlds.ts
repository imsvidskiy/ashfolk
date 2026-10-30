import type { IslandShapeKind } from "../../world/island-shape.ts";
import { DEFAULT_GENERATION_OPTIONS } from "../generation-options.ts";
import { type GeneratedWorld, generateWorld } from "../world-generator.ts";

export const COARSE_DIMENSIONS = { cellSize: 40, cellsPerSide: 128 };
export const FULL_SIZE_TIMEOUT = 120_000;

const VARIETY_DIMENSIONS = { cellSize: 50, cellsPerSide: 128 };
const VARIETY_SEEDS = Array.from({ length: 16 }, (_, index) => {
  return index + 1;
});
const SQUARE_VARIETY_SEEDS = VARIETY_SEEDS.slice(0, 6);

const generated = new Map<string, GeneratedWorld>();

interface IslandsAcrossSeeds {
  readonly round: readonly GeneratedWorld[];
  readonly square: readonly GeneratedWorld[];
}

function remembered(key: string, generate: () => GeneratedWorld): GeneratedWorld {
  const known = generated.get(key);

  if (known !== undefined) {
    return known;
  }

  const world = generate();

  generated.set(key, world);

  return world;
}

export function coarseWorld(seed: number, shape: IslandShapeKind = "round"): GeneratedWorld {
  return remembered(`coarse:${seed}:${shape}`, () => {
    return generateWorld(seed, { dimensions: COARSE_DIMENSIONS, erosionStrength: 1, shape });
  });
}

export function fullSizeWorld(seed: number, shape: IslandShapeKind = "round"): GeneratedWorld {
  return remembered(`full:${seed}:${shape}`, () => {
    return generateWorld(seed, { ...DEFAULT_GENERATION_OPTIONS, shape });
  });
}

function varietyWorld(seed: number, shape: IslandShapeKind): GeneratedWorld {
  return remembered(`variety:${seed}:${shape}`, () => {
    return generateWorld(seed, { dimensions: VARIETY_DIMENSIONS, erosionStrength: 1, shape });
  });
}

export function islandsAcrossSeeds(): IslandsAcrossSeeds {
  return {
    round: VARIETY_SEEDS.map((seed) => {
      return varietyWorld(seed, "round");
    }),
    square: SQUARE_VARIETY_SEEDS.map((seed) => {
      return varietyWorld(seed, "square");
    }),
  };
}
