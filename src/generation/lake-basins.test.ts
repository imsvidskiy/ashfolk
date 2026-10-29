import { describe, expect, it } from "vitest";
import { saturate } from "../shared/math.ts";
import { createRandom } from "../shared/random.ts";
import { type IslandSizeKind, islandDimensions } from "../world/island-size.ts";
import { landEverywhere, shapeTerrain, troughWithBasin } from "../world/testing/terrain-fixtures.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { analyzeDrainage, type DrainageBasins, NO_CELL } from "./hydrology.ts";
import { digRiverLakes, easeLakeShores, fillSinks, type LakeSiting } from "./lake-basins.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 192 });
const dryness = new Float32Array(grid.cellCount);
const coastDistance = landEverywhere(grid.cellCount);
const CLIFF_HEIGHT = 30;
const CLIFF_START = 100;
const CLIFF_WIDTH = 20;
const FAR_WALL_START = 450;
const FAR_WALL_HEIGHT = 250;
const TERRACE_START = 90;
const TERRACE_LAKE_Z = 300;
const TERRACE_LAKE_DEPTH = 20;
const TERRACE_LAKE_SPREAD = 2 * 50 * 50;
const GENTLE_SHORE_SLOPE = 0.12;
const GENTLE_SHORE_WIDTH = 40;
const SLOPE_TOLERANCE = 0.01;
const REACH_OF_EASING = 400;

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

describe("lake shore easing", () => {
  interface EasedShore {
    readonly basins: DrainageBasins;
    readonly coast: Float32Array;
    readonly eased: Float32Array;
    readonly uneased: Float32Array;
  }

  function levelsOf(lakes: DrainageBasins["lakes"]): number[][] {
    return lakes.map((lake) => {
      return [lake.level, lake.cellCount];
    });
  }

  function easeShores(heightAt: (x: number, z: number) => number, coast = coastDistance): EasedShore {
    const eased = shapeTerrain(grid, heightAt);
    const basins = fillSinks(eased, grid, dryness, coast);
    const uneased = Float32Array.from(eased);

    easeLakeShores(eased, grid, coast, basins);

    return { basins, coast, eased, uneased };
  }

  function besideCliff(x: number, z: number): number {
    const cliff = CLIFF_HEIGHT * saturate((x - CLIFF_START) / CLIFF_WIDTH);

    return troughWithBasin(x, z) + cliff + FAR_WALL_HEIGHT * saturate((x - FAR_WALL_START) / CLIFF_WIDTH);
  }

  function belowTerraceLake(x: number, z: number): number {
    const terrace = CLIFF_HEIGHT * saturate((z - TERRACE_START) / CLIFF_WIDTH);
    const pit = TERRACE_LAKE_DEPTH * Math.exp(-(x * x + (z - TERRACE_LAKE_Z) ** 2) / TERRACE_LAKE_SPREAD);

    return troughWithBasin(x, z) + terrace - pit;
  }

  function cliffWithSeaPatch(): Float32Array {
    const coast = Float32Array.from(coastDistance);

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      const x = grid.cellCenterX(cell);

      if (x > CLIFF_START + CLIFF_WIDTH && x < CLIFF_START + 4 * CLIFF_WIDTH && Math.abs(grid.cellCenterZ(cell)) < 30) {
        coast[cell] = -1;
      }
    }

    return coast;
  }

  function slopesAlong(heights: Float32Array, cells: readonly number[]): number[] {
    return cells.slice(1).map((cell, index) => {
      return Math.abs(heights[cell] - heights[cells[index]]) / grid.cellSize;
    });
  }

  it("turns a cliff beside a lake into a ramp that steepens away from the water", () => {
    const { eased, uneased } = easeShores(besideCliff);

    const row = grid.rowAt(0);
    const cliff = Array.from({ length: 5 }, (_, step) => {
      return grid.index(grid.columnAt(CLIFF_START - grid.cellSize + step * grid.cellSize), row);
    });

    expect(Math.max(...slopesAlong(uneased, cliff))).toBeGreaterThan(1);
    expect(Math.max(...slopesAlong(eased, cliff))).toBeLessThan(2 * GENTLE_SHORE_SLOPE);
  });

  it("only lowers land near a lake and leaves the lake, the sea and far land alone", () => {
    const { basins, coast, eased, uneased } = easeShores(besideCliff, cliffWithSeaPatch());

    const cells = Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    });
    const lowered = cells.filter((cell) => {
      return eased[cell] !== uneased[cell];
    });

    expect(
      cells.filter((cell) => {
        return eased[cell] > uneased[cell];
      })
    ).toEqual([]);
    expect(
      lowered.filter((cell) => {
        return basins.lakeIds[cell] !== NO_CELL || coast[cell] <= 0;
      })
    ).toEqual([]);
    expect(lowered.length).toBeGreaterThan(100);
    expect(
      Math.max(
        ...lowered.map((cell) => {
          return Math.hypot(grid.cellCenterX(cell), grid.cellCenterZ(cell));
        })
      )
    ).toBeLessThan(REACH_OF_EASING);
  });

  it.each([
    ["beside a cliff", besideCliff],
    ["below a terrace lake", belowTerraceLake],
  ])("keeps every lake at its level %s when the water is worked out again", (_, heightAt) => {
    const { basins, eased } = easeShores(heightAt);

    expect(basins.lakes.length).toBeGreaterThan(0);
    expect(levelsOf(analyzeDrainage(eased, grid, dryness, coastDistance).lakes)).toEqual(levelsOf(basins.lakes));
  });

  it("keeps the shore of a higher lake gentle where the cut of a lower lake reaches it", () => {
    const { basins, eased, uneased } = easeShores(belowTerraceLake);

    const column = grid.columnAt(0);
    const higher = basins.lakes.reduce((highest, lake) => {
      return lake.level > highest.level ? lake : highest;
    });
    const rim = Array.from({ length: grid.cellsPerSide }, (_, row) => {
      return grid.index(column, row);
    }).find((cell) => {
      return basins.lakeIds[cell] !== NO_CELL && basins.lakes[basins.lakeIds[cell]] === higher;
    });

    expect(basins.lakes).toHaveLength(2);
    expect(rim).toBeDefined();

    if (rim === undefined) {
      return;
    }

    const shore = Array.from({ length: GENTLE_SHORE_WIDTH / grid.cellSize + 1 }, (_, step) => {
      return grid.index(column, grid.rowOf(rim) - 1 - step);
    });

    expect(
      shore.some((cell) => {
        return eased[cell] < uneased[cell];
      })
    ).toBe(true);

    for (const slope of slopesAlong(eased, shore)) {
      expect(slope).toBeLessThan(GENTLE_SHORE_SLOPE + SLOPE_TOLERANCE);
    }
  });
});
