import { describe, expect, it } from "vitest";
import { createRandom } from "../shared/random.ts";
import { type IslandSizeKind, islandDimensions } from "../world/island-size.ts";
import { landEverywhere, shapeTerrain, troughWithBasin } from "../world/testing/terrain-fixtures.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { analyzeDrainage } from "./hydrology.ts";
import { digRiverLakes, fillSinks, type LakeSiting } from "./lake-basins.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 192 });
const dryness = new Float32Array(grid.cellCount);
const coastDistance = landEverywhere(grid.cellCount);

function gentleValley(): Float32Array {
  return shapeTerrain(grid, (x, z) => {
    return 200 - 0.03 * z + 0.12 * Math.abs(x);
  });
}

function boundaryDistance(cell: number): number {
  return 1 - Math.max(Math.abs(grid.cellCenterX(cell)), Math.abs(grid.cellCenterZ(cell))) / grid.halfSize;
}

function siting(seed: number): LakeSiting {
  return { boundaryDistance, coastDistance, dryness, grid, random: createRandom(seed) };
}

describe("river lakes", () => {
  it("dams a fed river into a lake away from the island rim", () => {
    const heights = gentleValley();

    expect(analyzeDrainage(heights, grid, dryness, coastDistance).lakes).toHaveLength(0);

    digRiverLakes(heights, siting(3));

    const { lakes } = analyzeDrainage(heights, grid, dryness, coastDistance);

    expect(lakes.length).toBeGreaterThan(0);

    for (const lake of lakes) {
      expect(boundaryDistance(grid.cellAt(lake.centerX, lake.centerZ))).toBeGreaterThan(0.15);
    }
  });

  it("digs the same lakes for the same seed", () => {
    const first = gentleValley();
    const second = gentleValley();

    digRiverLakes(first, siting(3));
    digRiverLakes(second, siting(3));

    expect(second).toEqual(first);
  });
});

describe("river lakes on islands of each size", () => {
  function lakesDugOn(size: IslandSizeKind): number {
    const sized = new WorldGrid(islandDimensions(size));
    const sizedDryness = new Float32Array(sized.cellCount);
    const sizedCoast = landEverywhere(sized.cellCount);
    const valleys = shapeTerrain(sized, (x, z) => {
      return 200 - 0.03 * z + 0.12 * Math.abs((((x % 1200) + 1800) % 1200) - 600);
    });

    digRiverLakes(valleys, {
      boundaryDistance: (cell) => {
        return 1 - Math.max(Math.abs(sized.cellCenterX(cell)), Math.abs(sized.cellCenterZ(cell))) / sized.halfSize;
      },
      coastDistance: sizedCoast,
      dryness: sizedDryness,
      grid: sized,
      random: createRandom(3),
    });

    return analyzeDrainage(valleys, sized, sizedDryness, sizedCoast).lakes.length;
  }

  it("digs more lakes on a larger island", () => {
    expect(lakesDugOn("small")).toBe(2);
    expect(lakesDugOn("normal")).toBe(3);
    expect(lakesDugOn("large")).toBe(4);
  }, 30_000);
});

describe("sink filling", () => {
  it("fills pits too small to hold a lake", () => {
    const heights = shapeTerrain(grid, (x, z) => {
      return 100 + 0.02 * z + 0.01 * x;
    });

    heights[grid.cellAt(5, 5)] -= 3;
    fillSinks(heights, grid, dryness, coastDistance);

    const { network } = analyzeDrainage(heights, grid, dryness, coastDistance);

    expect(
      network.filled.every((level, cell) => {
        return level - heights[cell] < 0.01;
      })
    ).toBe(true);
  });

  it("leaves lake basins to fill with water", () => {
    const heights = shapeTerrain(grid, troughWithBasin);
    const center = grid.cellAt(5, 5);

    const bottom = heights[center];

    fillSinks(heights, grid, dryness, coastDistance);

    expect(heights[center]).toBe(bottom);
    expect(analyzeDrainage(heights, grid, dryness, coastDistance).lakes.length).toBeGreaterThan(0);
  });
});
