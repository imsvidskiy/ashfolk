import { describe, expect, it } from "vitest";
import { landEverywhere, shapeTerrain, trough, troughWithBasin } from "../world/testing/terrain-fixtures.ts";
import { hasWater } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { analyzeDrainage } from "./drainage.ts";
import { cellsAround } from "./testing/cell-patches.ts";
import { coarseWorld } from "./testing/generated-worlds.ts";
import { meanOf, median } from "./testing/statistics.ts";
import { isRiverWater } from "./testing/water-checks.ts";
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

describe("river valleys of a generated island", () => {
  it("sinks rivers into valleys below the land around them", () => {
    const world = coarseWorld(7);
    const { terrain } = world;

    const grid = new WorldGrid(world.dimensions);
    const depths: number[] = [];

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (!isRiverWater(terrain, cell)) {
        continue;
      }

      const land = cellsAround(grid, cell, 60, 100).filter((other) => {
        return !hasWater(terrain.waterSurface[other], terrain.height[other]);
      });

      if (land.length > 0) {
        const meanHeight = meanOf(
          land.map((other) => {
            return terrain.height[other];
          })
        );

        depths.push(meanHeight - terrain.waterSurface[cell]);
      }
    }

    expect(depths.length).toBeGreaterThan(100);
    expect(median(depths)).toBeGreaterThan(5);
  });
});
