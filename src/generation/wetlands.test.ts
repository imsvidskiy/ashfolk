import { describe, expect, it } from "vitest";
import { slopeAt } from "../world/footing.ts";
import { landEverywhere } from "../world/testing/terrain-fixtures.ts";
import { NO_WATER } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { findPools, findSmallAreas, isWetland, matchWetlandShare, measureWetness } from "./wetlands.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 96 });
const LAKE_RADIUS = 120;
const LAKE_LEVEL = 100.5;
const TIED_WETNESS_SHARE = 1 / 97;

function wetnessOf(seed: number, desert = 0): Float32Array {
  const world = lakeWorld(seed, desert);
  const slopes = Float64Array.from({ length: grid.cellCount }, (_, cell) => {
    return slopeAt(world.heights, grid, cell);
  });

  return measureWetness(world, slopes);
}

function bentExponent(before: Float32Array, after: Float32Array, cell: number): number {
  return Math.log(after[cell]) / Math.log(before[cell]);
}

function lakeWorld(seed: number, desert = 0) {
  const heights = new Float32Array(grid.cellCount);
  const waterSurface = new Float32Array(grid.cellCount).fill(NO_WATER);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const x = grid.cellCenterX(cell);
    const z = grid.cellCenterZ(cell);

    const shoreDistance = Math.hypot(x, z) - LAKE_RADIUS;
    const rise = x < 0 ? 0.02 : 0.6;

    heights[cell] = shoreDistance < 0 ? 99 : 101 + shoreDistance * rise;

    if (shoreDistance < 0) {
      waterSurface[cell] = LAKE_LEVEL;
    }
  }

  return {
    coastDistance: landEverywhere(grid.cellCount),
    desert: new Float64Array(grid.cellCount).fill(desert),
    grid,
    heights,
    lakeIds: new Int32Array(grid.cellCount).fill(-1),
    riverStrength: new Uint8Array(grid.cellCount),
    rivers: [],
    seed,
    waterSurface,
  };
}

function shoreCells(side: number): number[] {
  return Array.from({ length: grid.cellCount }, (_, cell) => {
    return cell;
  }).filter((cell) => {
    const x = grid.cellCenterX(cell);
    const distance = Math.hypot(x, grid.cellCenterZ(cell)) - LAKE_RADIUS;

    return distance > 0 && distance < 120 && Math.sign(x) === side && Math.abs(x) > 60;
  });
}

function blobs(cells: readonly number[]): (cell: number) => boolean {
  const members = new Set(cells);

  return (cell) => {
    return members.has(cell);
  };
}

function square(column: number, row: number, size: number): number[] {
  const cells: number[] = [];

  for (let rowOffset = 0; rowOffset < size; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < size; columnOffset += 1) {
      cells.push(grid.index(column + columnOffset, row + rowOffset));
    }
  }

  return cells;
}

describe("wetlands", () => {
  it("soaks the flat shore of a lake and leaves the steep shore and the water dry", () => {
    const seeds = [1, 2, 3, 4, 5];

    const soaked = seeds.map((seed) => {
      const wetness = wetnessOf(seed);

      expect(
        shoreCells(1).every((cell) => {
          return !isWetland(wetness[cell]);
        })
      ).toBe(true);
      expect(wetness[grid.cellAt(0, 0)]).toBe(0);

      return shoreCells(-1).filter((cell) => {
        return isWetland(wetness[cell]);
      }).length;
    });

    expect(Math.max(...soaked)).toBeGreaterThan(shoreCells(-1).length / 4);
  });

  it("finds no wetland in a desert", () => {
    expect(
      wetnessOf(1, 0.6).every((wetness) => {
        return wetness === 0;
      })
    ).toBe(true);
  });

  it("comes out the same for the same seed", () => {
    expect(wetnessOf(3)).toEqual(wetnessOf(3));
  });

  it("drains patches too small to read as a swamp", () => {
    const speck = square(10, 10, 3);
    const marsh = square(40, 40, 10);

    expect(
      findSmallAreas(grid, blobs([...speck, ...marsh])).sort((first, second) => {
        return first - second;
      })
    ).toEqual(speck);
  });

  it("sinks pools only inside a swamp, never at its edge", () => {
    const marsh = square(20, 20, 30);
    const isMarsh = blobs(marsh);
    const wetness = new Float32Array(grid.cellCount).fill(1);

    const pools = findPools(grid, 5, wetness, isMarsh);

    expect(pools.length).toBeGreaterThan(0);
    expect(pools.length).toBeLessThan(marsh.length / 2);

    for (const pool of pools) {
      const column = grid.columnOf(pool);
      const row = grid.rowOf(pool);

      expect(column).toBeGreaterThan(20);
      expect(column).toBeLessThan(49);
      expect(row).toBeGreaterThan(20);
      expect(row).toBeLessThan(49);
    }
  });

  it("bends the wetness so the wetland covers the island's share, keeping the wettest ground wettest", () => {
    const wetness = Float32Array.from({ length: grid.cellCount }, (_, cell) => {
      return (0.6 * (cell % 97)) / 100;
    });
    const before = Float32Array.from(wetness);

    matchWetlandShare(wetness, landEverywhere(grid.cellCount), 0.2);

    const wetCells = wetness.filter((value) => {
      return isWetland(value);
    }).length;
    const wettest = before.indexOf(Math.max(...before));

    expect(Math.abs(wetCells / grid.cellCount - 0.2)).toBeLessThan(TIED_WETNESS_SHARE);
    expect(wetness[wettest]).toBe(Math.max(...wetness));
    expect(
      wetness.every((value, cell) => {
        return value <= 1 && (value === 0) === (before[cell] === 0);
      })
    ).toBe(true);
  });

  it("matches the share over land only, leaving ocean cells out of the reference", () => {
    const landCells = grid.cellCount / 2;
    const coastDistance = Float32Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell < landCells ? 1 : 0;
    });
    const wetness = Float32Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell < landCells ? 0.2 + (0.5 * cell) / landCells : 0.95;
    });
    const before = Float32Array.from(wetness);
    const reference = before[landCells - 1 - Math.floor(0.2 * landCells)];

    matchWetlandShare(wetness, coastDistance, 0.2);

    expect(bentExponent(before, wetness, 0)).toBeCloseTo(Math.log(0.34) / Math.log(reference), 4);
  });

  it("bends the gentlest way when too few cells are wet to reach the share", () => {
    const wetness = Float32Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell % 10 === 0 ? 0.5 : 0;
    });
    const before = Float32Array.from(wetness);

    matchWetlandShare(wetness, landEverywhere(grid.cellCount), 0.2);

    expect(bentExponent(before, wetness, 0)).toBeCloseTo(0.7, 4);
  });

  it("clamps the bend on very wet and very dry land", () => {
    const soaked = new Float32Array(grid.cellCount).fill(0.9);
    const parched = new Float32Array(grid.cellCount).fill(0.05);
    const soakedBefore = Float32Array.from(soaked);
    const parchedBefore = Float32Array.from(parched);

    matchWetlandShare(soaked, landEverywhere(grid.cellCount), 0.02);
    matchWetlandShare(parched, landEverywhere(grid.cellCount), 0.02);

    expect(bentExponent(soakedBefore, soaked, 0)).toBeCloseTo(2.4, 4);
    expect(bentExponent(parchedBefore, parched, 0)).toBeCloseTo(0.7, 4);
  });
});
