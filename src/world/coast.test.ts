import { describe, expect, it } from "vitest";
import { hasRoomFromCoast, isOnIsland, touchesOffIsland } from "./coast.ts";
import { landEverywhere } from "./testing/terrain-fixtures.ts";
import { WorldGrid } from "./world-grid.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 8 });

function coastWithVoidAt(column: number, row: number): Float32Array {
  const coastDistance = landEverywhere(grid.cellCount);

  coastDistance[grid.index(column, row)] = -3;

  return coastDistance;
}

function coastRisingEastward(): Float32Array {
  return Float32Array.from({ length: grid.cellCount }, (_, cell) => {
    return grid.columnOf(cell) * 10;
  });
}

describe("coast", () => {
  it("puts cells past the coast and outside the grid off the island", () => {
    const coastDistance = coastWithVoidAt(3, 3);

    coastDistance[grid.index(5, 5)] = 0;

    expect(isOnIsland(coastDistance, grid.index(2, 2))).toBe(true);
    expect(isOnIsland(coastDistance, grid.index(3, 3))).toBe(false);
    expect(isOnIsland(coastDistance, grid.index(5, 5))).toBe(false);
    expect(isOnIsland(coastDistance, -1)).toBe(false);
  });

  it("finds the void on all eight sides of a cell but not past the edge of the grid", () => {
    const coastDistance = coastWithVoidAt(3, 3);

    const touching = grid.cellsInRadius(grid.centerX(3), grid.centerZ(3), 15).filter((cell) => {
      return touchesOffIsland(coastDistance, grid, cell);
    });

    expect(touching).toHaveLength(8);
    expect(touching).not.toContain(grid.index(3, 3));
    expect(touchesOffIsland(coastDistance, grid, grid.index(5, 3))).toBe(false);
    expect(touchesOffIsland(landEverywhere(grid.cellCount), grid, grid.index(0, 0))).toBe(false);
  });

  it("keeps room from the coast by the distance blended between cell centers", () => {
    const coastDistance = coastRisingEastward();
    const z = grid.centerZ(4);

    expect(hasRoomFromCoast(coastDistance, grid, grid.centerX(0) + 5, z)).toBe(false);
    expect(hasRoomFromCoast(coastDistance, grid, grid.centerX(0) + 7, z)).toBe(true);
    expect(hasRoomFromCoast(coastDistance, grid, grid.centerX(1), z, 15)).toBe(false);
    expect(hasRoomFromCoast(coastDistance, grid, grid.centerX(2), z, 15)).toBe(true);
  });
});
