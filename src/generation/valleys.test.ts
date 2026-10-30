import { describe, expect, it } from "vitest";
import { landEverywhere, shapeTerrain, trough, troughWithBasin } from "../world/testing/terrain-fixtures.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { analyzeDrainage } from "./drainage.ts";
import { carveValleys } from "./valleys.ts";

function lakeLevels(heights: Float32Array, grid: WorldGrid): number[] {
  return analyzeDrainage(heights, grid, new Float32Array(grid.cellCount), landEverywhere(grid.cellCount)).lakes.map(
    (lake) => {
      return lake.level;
    }
  );
}

describe("river valleys", () => {
  const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 96 });
  const original = shapeTerrain(grid, trough);
  const carved = Float32Array.from(original);

  carveValleys(carved, grid, new Float32Array(grid.cellCount), landEverywhere(grid.cellCount));

  it("sinks big rivers well below their banks", () => {
    const river = grid.cellAt(-5, -440);
    const bank = grid.cellAt(-65, -440);

    expect(original[river] - carved[river]).toBeGreaterThan(5);
    expect(carved[bank] - carved[river]).toBeGreaterThan(original[bank] - original[river] + 5);
  });

  it("rises from the river to the untouched land", () => {
    const profile = [-5, -25, -45, -65, -85, -150].map((x) => {
      return carved[grid.cellAt(x, -400)];
    });

    for (let step = 1; step < profile.length; step += 1) {
      expect(profile[step]).toBeGreaterThanOrEqual(profile[step - 1]);
    }

    expect(carved[grid.cellAt(-300, -400)]).toBe(original[grid.cellAt(-300, -400)]);
  });

  it("keeps the level of lakes the rivers run through", () => {
    const lakeGrid = new WorldGrid({ cellSize: 10, cellsPerSide: 128 });
    const basin = shapeTerrain(lakeGrid, troughWithBasin);

    const levelsBefore = lakeLevels(basin, lakeGrid);

    carveValleys(basin, lakeGrid, new Float32Array(lakeGrid.cellCount), landEverywhere(lakeGrid.cellCount));

    expect(levelsBefore.length).toBeGreaterThan(0);
    expect(lakeLevels(basin, lakeGrid)).toEqual(levelsBefore);
  });
});
