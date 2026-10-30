import { beforeAll, describe, expect, it } from "vitest";
import { createRandom } from "../shared/random.ts";
import { slopeAt } from "../world/footing.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { erodeAcrossScales, limitSlopes, relaxSlopes } from "./erosion.ts";
import { COARSE_DIMENSIONS, coarseWorld, FULL_SIZE_TIMEOUT, fullSizeWorld } from "./testing/generated-worlds.ts";
import { meanOf, shareAbove } from "./testing/statistics.ts";
import type { GeneratedWorld } from "./world-generator.ts";

const CELL_SIZE = 10;
const STEEP = 1;
const CLIFF = Math.tan((55 * Math.PI) / 180);
const TERRACE_WINDOW = 24;
const TERRACE_STEEPNESS = 0.6;
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function steepestSlope(heights: Float32Array, size: number): number {
  let steepest = 0;

  for (let row = 1; row < size - 1; row += 1) {
    for (let column = 1; column < size - 1; column += 1) {
      for (const [columnStep, rowStep] of NEIGHBORS) {
        const drop = Math.abs(heights[row * size + column] - heights[(row + rowStep) * size + column + columnStep]);

        steepest = Math.max(steepest, drop / (Math.hypot(columnStep, rowStep) * CELL_SIZE));
      }
    }
  }

  return steepest;
}

function sumOf(heights: Float32Array): number {
  return heights.reduce((total, height) => {
    return total + height;
  }, 0);
}

function slopesOf(terrain: TerrainData, grid: WorldGrid): number[] {
  return Array.from({ length: grid.cellCount }, (_, cell) => {
    return slopeAt(terrain.height, grid, cell);
  });
}

function slopeAutocorrelation(generated: GeneratedWorld, lags: number): number[] {
  const { height } = generated.terrain;

  const grid = new WorldGrid(generated.dimensions);
  const size = grid.cellsPerSide;
  const sums = new Array<number>(lags + 1).fill(0);

  let windows = 0;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column + TERRACE_WINDOW < size; column += TERRACE_WINDOW / 2) {
      const steps = Array.from({ length: TERRACE_WINDOW }, (_, offset) => {
        const cell = grid.index(column + offset, row);

        return (height[cell + 1] - height[cell]) / grid.cellSize;
      });

      if (
        steps.some((step) => {
          return Math.abs(step) < TERRACE_STEEPNESS;
        })
      ) {
        continue;
      }

      const mean = meanOf(steps);
      const residuals = steps.map((step) => {
        return step - mean;
      });
      const variance = residuals.reduce((total, residual) => {
        return total + residual * residual;
      }, 0);

      if (variance < 1e-6) {
        continue;
      }

      for (let lag = 0; lag <= lags; lag += 1) {
        let product = 0;

        for (let index = 0; index + lag < residuals.length; index += 1) {
          product += residuals[index] * residuals[index + lag];
        }

        sums[lag] += product / variance;
      }

      windows += 1;
    }
  }

  return sums.map((sum) => {
    return sum / windows;
  });
}

function cone(size: number, summit: number): Float32Array {
  const heights = new Float32Array(size * size);
  const center = (size - 1) / 2;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      heights[row * size + column] = 100 + Math.max(0, summit - Math.hypot(column - center, row - center) * 9);
    }
  }

  return heights;
}

describe("thermal relaxation", () => {
  it("settles a spike into a slope at the talus angle without losing material", () => {
    const size = 32;
    const heights = new Float32Array(size * size).fill(100);

    heights[16 * size + 16] = 300;

    const before = sumOf(heights);
    const iterations = relaxSlopes(heights, size, CELL_SIZE, new Float32Array(size * size).fill(0.8), 1000);

    expect(iterations).toBeLessThan(1000);
    expect(steepestSlope(heights, size)).toBeLessThan(0.81);
    expect(sumOf(heights)).toBeCloseTo(before, -1);
  });

  it("lowers a steep face to an even slope instead of a staircase", () => {
    const size = 64;
    const heights = Float32Array.from({ length: size * size }, (_, cell) => {
      const column = cell % size;
      const row = (cell - column) / size;

      return Math.max(0, 40 - column) * 15 + row * 0.3;
    });

    relaxSlopes(heights, size, CELL_SIZE, new Float32Array(size * size).fill(0.92), 72);

    let turns = 0;
    let samples = 0;

    for (let row = 4; row < size - 4; row += 1) {
      const drops = Array.from({ length: 38 }, (_, offset) => {
        return heights[row * size + offset + 2] - heights[row * size + offset + 3];
      });

      for (let index = 1; index + 1 < drops.length; index += 1) {
        const before = drops[index] - drops[index - 1];
        const after = drops[index + 1] - drops[index];

        samples += 1;
        turns += before * after < 0 && Math.abs(before) > 0.5 && Math.abs(after) > 0.5 ? 1 : 0;
      }
    }

    expect(turns / samples).toBeLessThan(0.02);
  });
});

describe("slope limit", () => {
  it("keeps every neighbor drop under the limit and never raises the land", () => {
    const size = 40;
    const random = createRandom(4);
    const original = Float32Array.from({ length: size * size }, () => {
      return random.between(0, 400);
    });

    const heights = Float32Array.from(original);

    limitSlopes(heights, size, CELL_SIZE, 1.2);

    expect(steepestSlope(heights, size)).toBeLessThan(1.2 + 1e-4);
    expect(
      heights.every((height, cell) => {
        return height <= original[cell];
      })
    ).toBe(true);
  });
});

describe("erosion across scales", () => {
  const size = 64;
  const scales = [
    { dropletsPerCell: 1.5, factor: 4 },
    { dropletsPerCell: 1.5, factor: 2 },
    { dropletsPerCell: 1, factor: 1 },
  ];

  function erode(resistance: number): Float32Array {
    const heights = cone(size, 500);

    erodeAcrossScales(heights, size, createRandom(3), {
      coarseReach: new Float32Array(size * size).fill(1),
      resistance: new Float32Array(size * size).fill(resistance),
      scales,
    });

    return heights;
  }

  it("cuts the same valleys for the same seed", () => {
    const eroded = erode(0);

    expect(erode(0)).toEqual(eroded);
    expect(Math.max(...eroded)).toBeLessThan(Math.max(...cone(size, 500)));
  });

  it("leaves fully resistant rock untouched", () => {
    const untouched = cone(size, 500);

    const largestChange = erode(1).reduce((largest, height, cell) => {
      return Math.max(largest, Math.abs(height - untouched[cell]));
    }, 0);

    expect(largestChange).toBeLessThan(1e-3);
  });
});

describe("slopes of a generated island", () => {
  let fullSize: GeneratedWorld;

  beforeAll(() => {
    fullSize = fullSizeWorld(7);
  }, FULL_SIZE_TIMEOUT);

  it("keeps slopes realistic, with few cliffs", () => {
    const slopes = slopesOf(coarseWorld(7).terrain, new WorldGrid(COARSE_DIMENSIONS));

    const meanSlope = (Math.atan(meanOf(slopes)) * 180) / Math.PI;

    expect(meanSlope).toBeGreaterThan(14);
    expect(meanSlope).toBeLessThan(24);
    expect(shareAbove(slopes, STEEP)).toBeLessThan(0.03);
    expect(shareAbove(slopes, CLIFF)).toBeLessThan(0.001);
  });

  it("has few slopes steeper than 45 degrees and almost none steeper than 55", () => {
    const slopes = slopesOf(fullSize.terrain, new WorldGrid(fullSize.dimensions));

    expect(shareAbove(slopes, STEEP)).toBeLessThan(0.03);
    expect(shareAbove(slopes, CLIFF)).toBeLessThan(0.0005);
  });

  it("leaves no periodic terraces on steep slopes", () => {
    const correlation = slopeAutocorrelation(fullSize, 4);

    expect(correlation[1]).toBeGreaterThan(0.6);

    for (let lag = 2; lag < correlation.length; lag += 1) {
      expect(correlation[lag]).toBeLessThan(correlation[lag - 1]);
    }
  });
});
