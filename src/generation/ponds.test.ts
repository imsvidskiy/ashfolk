import { describe, expect, it } from "vitest";
import { pondEdgeReach, type Spring } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { pondCut } from "./ponds.ts";

const GRID = new WorldGrid({ cellSize: 1, cellsPerSide: 48 });
const POND: Spring = {
  cells: [],
  directionX: 1,
  directionZ: 0,
  kind: "pond",
  level: 2,
  radius: 8,
  river: 0,
  seed: 0.3,
  x: 0,
  z: 0,
};

function cellsOfGrid(): number[] {
  return Array.from({ length: GRID.cellCount }, (_, cell) => {
    return cell;
  });
}

function isInPond(cell: number): boolean {
  return pondEdgeReach(POND, GRID.cellCenterX(cell), GRID.cellCenterZ(cell)) > 0;
}

function heightsOf(heightAt: (cell: number) => number): Float32Array {
  return Float32Array.from(cellsOfGrid(), heightAt);
}

describe("pond cut", () => {
  it("sums the ground above the level over the cells inside the outline", () => {
    const heights = heightsOf((cell) => {
      return GRID.cellCenterX(cell);
    });

    const expected = cellsOfGrid()
      .filter(isInPond)
      .reduce((sum, cell) => {
        return sum + Math.max(0, heights[cell] - POND.level);
      }, 0);

    expect(expected).toBeGreaterThan(0);
    expect(pondCut(GRID, heights, POND)).toBeCloseTo(expected, 3);
  });

  it("ignores ground outside the outline", () => {
    const heights = heightsOf((cell) => {
      return isInPond(cell) ? POND.level + 1 : POND.level + 50;
    });

    expect(pondCut(GRID, heights, POND)).toBe(cellsOfGrid().filter(isInPond).length);
  });

  it("is zero when the ground lies below the level", () => {
    const heights = heightsOf(() => {
      return POND.level - 1;
    });

    expect(pondCut(GRID, heights, POND)).toBe(0);
  });
});
