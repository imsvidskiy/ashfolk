import { describe, expect, it } from "vitest";
import { createRandom } from "../shared/random.ts";
import { erodeAcrossScales } from "./erosion.ts";

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
