import { clamp } from "../shared/math.ts";
import { createNoiseSampler, type NoiseSampler } from "../shared/noise.ts";
import { createRandom } from "../shared/random.ts";

export const ISLAND_SHAPES = ["round", "square"] as const;

const MEAN_REACH = 0.915;
const SHORTEST_REACH = 0.74;
const LONGEST_REACH = 0.972;
const COVE_DEPTH = 0.022;

export type IslandShapeKind = (typeof ISLAND_SHAPES)[number];

export interface IslandShape {
  readonly coastDistanceAt: (x: number, z: number) => number;
  readonly inlandDistanceAt: (x: number, z: number) => number;
  readonly kind: IslandShapeKind;
}

const SQUARE_SHAPE: IslandShape = {
  coastDistanceAt: squareDistance,
  inlandDistanceAt: squareDistance,
  kind: "square",
};

function squareDistance(x: number, z: number): number {
  return 1 - Math.max(Math.abs(x), Math.abs(z));
}

function broadReach(noise: NoiseSampler, directionX: number, directionZ: number): number {
  const lobes = noise.fractal(directionX * 1.3 + 4.1, directionZ * 1.3 - 2.7, { octaves: 2 });
  const bays = noise.fractal(directionX * 3.6 - 8.3, directionZ * 3.6 + 5.2, { octaves: 3 });

  return MEAN_REACH + 0.07 * lobes + 0.035 * bays;
}

function coastReach(noise: NoiseSampler, angle: number): number {
  const directionX = Math.cos(angle);
  const directionZ = Math.sin(angle);

  const headlands = noise.ridged(directionX * 7.5 + 1.9, directionZ * 7.5 + 6.6, { octaves: 2 });

  return clamp(broadReach(noise, directionX, directionZ) - 0.025 * headlands, SHORTEST_REACH, LONGEST_REACH);
}

function inlandReach(noise: NoiseSampler, angle: number): number {
  return clamp(broadReach(noise, Math.cos(angle), Math.sin(angle)), SHORTEST_REACH, LONGEST_REACH);
}

function insideFrame(x: number, z: number): number {
  return LONGEST_REACH - Math.max(Math.abs(x), Math.abs(z));
}

function roundShape(seed: number): IslandShape {
  const noise = createNoiseSampler(createRandom(seed * 31 + 17).derive(1));

  return {
    coastDistanceAt: (x, z) => {
      const reach = coastReach(noise, Math.atan2(z, x));
      const coves = COVE_DEPTH * noise.fractal(x * 9 - 3.4, z * 9 + 7.7, { octaves: 2 });

      return Math.min(reach - Math.hypot(x, z) + coves, insideFrame(x, z));
    },
    inlandDistanceAt: (x, z) => {
      return Math.min(inlandReach(noise, Math.atan2(z, x)) - Math.hypot(x, z), insideFrame(x, z));
    },
    kind: "round",
  };
}

export function isIslandShapeKind(value: string): value is IslandShapeKind {
  return ISLAND_SHAPES.some((shape) => {
    return shape === value;
  });
}

export function createIslandShape(kind: IslandShapeKind, seed: number): IslandShape {
  if (kind === "square") {
    return SQUARE_SHAPE;
  }

  return roundShape(seed);
}
