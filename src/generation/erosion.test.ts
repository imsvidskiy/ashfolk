import { describe, expect, it } from "vitest";
import { createRandom } from "../shared/random.ts";
import { erodeAcrossScales, limitSlopes, relaxSlopes } from "./erosion.ts";

const CELL_SIZE = 10;
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
