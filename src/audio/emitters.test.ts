import { describe, expect, it } from "vitest";
import { WorldGrid } from "../world/world-grid.ts";
import { groupCells } from "./emitters.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 96 });

function block(column: number, row: number, size: number): number[] {
  const cells: number[] = [];

  for (let rowOffset = 0; rowOffset < size; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < size; columnOffset += 1) {
      cells.push(grid.index(column + columnOffset, row + rowOffset));
    }
  }

  return cells;
}

describe("grouping cells into emitters", () => {
  it("gathers a fire into one emitter at its middle", () => {
    const emitters = groupCells(grid, block(50, 50, 4), { bucketSize: 80, focusX: 0, focusZ: 0, limit: 4 });

    expect(emitters).toHaveLength(1);
    expect(emitters[0]?.x).toBeCloseTo(grid.centerX(51.5));
    expect(emitters[0]?.volume).toBe(1);
  });

  it("keeps the fires closest to the view when there are too many", () => {
    const near = block(48, 48, 2);
    const far = block(5, 5, 2);
    const emitters = groupCells(grid, [...far, ...near], { bucketSize: 80, focusX: 0, focusZ: 0, limit: 1 });

    expect(emitters).toHaveLength(1);
    expect(emitters[0]?.x).toBeCloseTo(grid.centerX(48.5));
  });

  it("keeps fires in different rows and columns apart", () => {
    const fires = [...block(10, 50, 2), ...block(50, 50, 2), ...block(50, 10, 2)];
    const emitters = groupCells(grid, fires, { bucketSize: 80, focusX: 0, focusZ: 0, limit: 4 });

    expect(emitters).toHaveLength(3);
  });

  it("makes a small fire quieter than a large one", () => {
    const [small] = groupCells(grid, block(50, 50, 1), { bucketSize: 80, focusX: 0, focusZ: 0, limit: 4 });

    expect(small?.volume).toBeCloseTo(0.25);
  });
});
