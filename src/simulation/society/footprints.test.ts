import { describe, expect, it } from "vitest";
import { createTestWorld, floodCells } from "../testing/test-world.ts";
import { footprintCells, isDryWay } from "./footprints.ts";

describe("footprints", () => {
  it("cover the cells the circle reaches into and none whose corner it misses", () => {
    const { grid } = createTestWorld();

    const cells = footprintCells(grid, 5, 5, 6);

    expect(cells).toHaveLength(5);
    expect(cells).toContain(grid.cellAt(5, 5));
    expect(cells).toContain(grid.cellAt(15, 5));
    expect(cells).not.toContain(grid.cellAt(15, 15));
  });
});

describe("dry ways", () => {
  it("are cut by a stream a single cell wide", () => {
    const world = createTestWorld();

    floodCells(world, [world.grid.cellAt(45, 5)], 1);

    expect(isDryWay(world, { x: 0, z: 5 }, { x: 90, z: 5 })).toBe(false);
    expect(isDryWay(world, { x: 0, z: 35 }, { x: 90, z: 35 })).toBe(true);
  });
});
