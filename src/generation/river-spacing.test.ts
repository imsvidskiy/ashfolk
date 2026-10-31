import { beforeAll, describe, expect, it } from "vitest";
import { ISLAND_SHAPES } from "../world/island-shape.ts";
import type { River, RiverPoint } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { NO_CELL } from "./drainage.ts";
import type { RiverChain } from "./river-chains.ts";
import { type RiverLand, SOURCE_REACH, spaceRiverChains } from "./river-spacing.ts";
import { labelPatches } from "./testing/cell-patches.ts";
import { coarseWorld, FULL_SIZE_TIMEOUT, fullSizeWorld } from "./testing/generated-worlds.ts";
import {
  endsAwayFromWater,
  isLakeWater,
  isNear,
  JUNCTION_CELLS,
  joinsRiver,
  lakeCellsNear,
  riverEnd,
  riverPathCells,
} from "./testing/water-checks.ts";
import type { GeneratedWorld } from "./world-generator.ts";

const TRUNK_COLUMN = 50;
const TRUNK_HEAD_ROW = 10;
const TRUNK_FLOW = 1000;
const STREAM_FLOW = 500;
const LATER_STREAM_FLOW = 400;
const SMALLEST_RIVER_GAP = 35;
const CONFLUENCE_REACH = 100;
const TRUNK_LAKE_CELLS = 1.5;
const SMOOTHING_SLACK = 10;
const SIDE_STREAM_COLUMN = 35;
const SIDE_STREAM_ROWS = [2, 90] as const;
const RAISED_FROM_ROW = 50;
const SIDE_SLOPE = 0.18;

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 100 });

interface PointBounds {
  maximumX: number;
  maximumZ: number;
  minimumX: number;
  minimumZ: number;
}

function landWithLake(lake: number = NO_CELL): RiverLand {
  const accumulation = new Float32Array(grid.cellCount);
  const lakeIds = new Int32Array(grid.cellCount).fill(NO_CELL);
  const heights = new Float32Array(grid.cellCount);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    heights[cell] = 100 - 0.01 * grid.rowOf(cell);
  }

  for (let row = TRUNK_HEAD_ROW; row < grid.cellsPerSide; row += 1) {
    accumulation[grid.index(TRUNK_COLUMN, row)] = TRUNK_FLOW + row;
  }

  if (lake !== NO_CELL) {
    lakeIds[lake] = 0;
  }

  return {
    basins: {
      lakeIds,
      lakes: [],
      network: {
        accumulation,
        filled: Float32Array.from(heights),
        order: new Int32Array(grid.cellCount),
        receivers: new Int32Array(grid.cellCount).fill(NO_CELL),
      },
      riverThreshold: 10_000,
      waterSurface: new Float32Array(grid.cellCount),
    },
    coastDistance: new Float32Array(grid.cellCount).fill(1),
    grid,
    heights,
  };
}

function rowCells(row: number, fromColumn: number, toColumn: number): number[] {
  const step = toColumn > fromColumn ? 1 : -1;
  const cells: number[] = [];

  for (let column = fromColumn; column !== toColumn + step; column += step) {
    cells.push(grid.index(column, row));
  }

  return cells;
}

function columnCells(column: number, fromRow: number, toRow: number): number[] {
  const cells: number[] = [];

  for (let row = fromRow; row <= toRow; row += 1) {
    cells.push(grid.index(column, row));
  }

  return cells;
}

function trunkCell(row: number): number {
  return grid.index(TRUNK_COLUMN, row);
}

function trunk(): RiverChain {
  const cells: number[] = [];

  for (let row = TRUNK_HEAD_ROW; row < grid.cellsPerSide; row += 1) {
    cells.push(trunkCell(row));
  }

  return { cells, joinsCell: NO_CELL, mouthReceiver: NO_CELL };
}

function stream(land: RiverLand, cells: number[], joinRow: number, flow: number): RiverChain {
  const mouth = cells.at(-1);

  if (mouth !== undefined) {
    land.basins.network.accumulation[mouth] = flow;
  }

  return { cells, joinsCell: trunkCell(joinRow), mouthReceiver: trunkCell(joinRow) };
}

function confluencesOf(rivers: readonly River[], first: River, second: River, reach: number): RiverPoint[] {
  const confluences: RiverPoint[] = [];

  for (const [tributary, main] of [
    [first, second],
    [second, first],
  ] as const) {
    if (joinsRiver(tributary, main, reach)) {
      confluences.push(riverEnd(tributary));
    }
  }

  for (const third of rivers) {
    if (third !== first && third !== second && joinsRiver(first, third, reach) && joinsRiver(second, third, reach)) {
      confluences.push(riverEnd(first), riverEnd(second));
    }
  }

  return confluences;
}

function boundsOf(points: readonly RiverPoint[]): PointBounds {
  const bounds = {
    maximumX: Number.NEGATIVE_INFINITY,
    maximumZ: Number.NEGATIVE_INFINITY,
    minimumX: Number.POSITIVE_INFINITY,
    minimumZ: Number.POSITIVE_INFINITY,
  };

  for (const point of points) {
    bounds.minimumX = Math.min(bounds.minimumX, point.x);
    bounds.maximumX = Math.max(bounds.maximumX, point.x);
    bounds.minimumZ = Math.min(bounds.minimumZ, point.z);
    bounds.maximumZ = Math.max(bounds.maximumZ, point.z);
  }

  return bounds;
}

function squaredDistanceToBounds(point: RiverPoint, bounds: PointBounds): number {
  const offsetX = Math.max(bounds.minimumX - point.x, 0, point.x - bounds.maximumX);
  const offsetZ = Math.max(bounds.minimumZ - point.z, 0, point.z - bounds.maximumZ);

  return offsetX * offsetX + offsetZ * offsetZ;
}

function sharesLake(generated: GeneratedWorld, lakes: Int32Array, first: RiverPoint, second: RiverPoint): boolean {
  const firstLakes = new Set(
    lakeCellsNear(generated, first).map((cell) => {
      return lakes[cell];
    })
  );

  return lakeCellsNear(generated, second).some((cell) => {
    return firstLakes.has(lakes[cell]);
  });
}

function lakeCrossingsOf(generated: GeneratedWorld, lakes: Int32Array, first: River, second: River): RiverPoint[] {
  const crossings: RiverPoint[] = [];

  for (const [inflow, outflow] of [
    [first, second],
    [second, first],
  ] as const) {
    const [source] = outflow.points;
    const mouth = riverEnd(inflow);

    if (source !== undefined && sharesLake(generated, lakes, mouth, source)) {
      crossings.push(mouth, source);
    }
  }

  return crossings;
}

function closestDistinctRivers(generated: GeneratedWorld): number {
  const { cellSize } = generated.dimensions;
  const { rivers } = generated.water;

  const lakes = labelPatches(new WorldGrid(generated.dimensions), (cell) => {
    return isLakeWater(generated.terrain, cell);
  });

  let closestSquared = Number.POSITIVE_INFINITY;

  for (const [index, first] of rivers.entries()) {
    for (const second of rivers.slice(index + 1)) {
      const confluences = [
        ...confluencesOf(rivers, first, second, cellSize * JUNCTION_CELLS),
        ...lakeCrossingsOf(generated, lakes, first, second),
      ];

      function isApart(point: RiverPoint): boolean {
        return confluences.every((confluence) => {
          return !isNear(point, confluence, CONFLUENCE_REACH);
        });
      }

      const firstPoints = first.points.filter(isApart);
      const secondPoints = second.points.filter(isApart);
      const secondBounds = boundsOf(secondPoints);

      for (const point of firstPoints) {
        if (squaredDistanceToBounds(point, secondBounds) >= closestSquared) {
          continue;
        }

        for (const other of secondPoints) {
          const offsetX = point.x - other.x;
          const offsetZ = point.z - other.z;

          closestSquared = Math.min(closestSquared, offsetX * offsetX + offsetZ * offsetZ);
        }
      }
    }
  }

  return Math.sqrt(closestSquared);
}

function alongToNearest(river: River, target: RiverPoint): { along: number; distance: number } {
  let along = 0;
  let best = { along: 0, distance: Number.POSITIVE_INFINITY };

  for (const [index, point] of river.points.entries()) {
    const previous = river.points[Math.max(0, index - 1)];

    along += Math.hypot(point.x - previous.x, point.z - previous.z);

    const distance = Math.hypot(point.x - target.x, point.z - target.z);

    if (distance < best.distance) {
      best = { along, distance };
    }
  }

  return best;
}

function isTrunkFedByLake(generated: GeneratedWorld, worldGrid: WorldGrid, river: River): boolean {
  const [head] = riverPathCells(worldGrid, river);

  return worldGrid
    .cellsInRadius(worldGrid.cellCenterX(head), worldGrid.cellCenterZ(head), worldGrid.cellSize * TRUNK_LAKE_CELLS)
    .some((cell) => {
      return isLakeWater(generated.terrain, cell);
    });
}

function joinsNearSources(generated: GeneratedWorld): string[] {
  const { cellSize } = generated.dimensions;
  const { rivers } = generated.water;

  const worldGrid = new WorldGrid(generated.dimensions);
  const trunks = rivers.filter((river) => {
    return !isTrunkFedByLake(generated, worldGrid, river);
  });
  const faults: string[] = [];

  for (const tributary of rivers) {
    const end = riverEnd(tributary);

    for (const main of trunks) {
      if (main === tributary) {
        continue;
      }

      const nearest = alongToNearest(main, end);

      if (nearest.distance < cellSize * JUNCTION_CELLS && nearest.along < SOURCE_REACH - SMOOTHING_SLACK) {
        faults.push(`river ${tributary.id} joins river ${main.id} ${Math.round(nearest.along)} m below its source`);
      }
    }
  }

  return faults;
}

describe("spaceRiverChains", () => {
  it("carries a stream that joins near a river's source on as that river's upper course", () => {
    const land = landWithLake();
    const upper = stream(land, rowCells(15, 80, TRUNK_COLUMN + 1), 15, STREAM_FLOW);

    const spaced = spaceRiverChains(land, [upper, trunk()]);

    expect(spaced).toEqual([
      { cells: [...upper.cells, ...trunk().cells.slice(5)], joinsCell: NO_CELL, mouthReceiver: NO_CELL },
    ]);
  });

  it("frees the source stretch a stream replaces", () => {
    const land = landWithLake();
    const upper = stream(land, rowCells(15, 80, TRUNK_COLUMN + 1), 15, STREAM_FLOW);
    const later: RiverChain = {
      cells: rowCells(12, 20, TRUNK_COLUMN - 1),
      joinsCell: trunkCell(12),
      mouthReceiver: trunkCell(12),
    };

    land.basins.network.accumulation[grid.index(TRUNK_COLUMN - 1, 12)] = LATER_STREAM_FLOW;

    for (let row = TRUNK_HEAD_ROW; row < grid.cellsPerSide - 1; row += 1) {
      land.basins.network.receivers[trunkCell(row)] = trunkCell(row + 1);
    }

    const [, joined] = spaceRiverChains(land, [later, upper, trunk()]);

    expect(joined).toEqual({
      cells: [...later.cells, trunkCell(12), trunkCell(13), trunkCell(14)],
      joinsCell: trunkCell(15),
      mouthReceiver: trunkCell(15),
    });
  });

  it("leads a stream that runs high above a river down the slope ahead into it", () => {
    const land = landWithLake();
    const [headRow, endRow] = SIDE_STREAM_ROWS;
    const side = stream(land, columnCells(SIDE_STREAM_COLUMN, headRow, endRow), 95, STREAM_FLOW);

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (grid.rowOf(cell) >= RAISED_FROM_ROW) {
        land.heights[cell] += SIDE_SLOPE * Math.abs(grid.columnOf(cell) - TRUNK_COLUMN) * grid.cellSize;
      }
    }

    const [, captured] = spaceRiverChains(land, [side, trunk()]);
    const connector = captured.cells.slice(RAISED_FROM_ROW - headRow + 1);

    expect(captured.cells.slice(0, RAISED_FROM_ROW - headRow + 1)).toEqual(
      columnCells(SIDE_STREAM_COLUMN, headRow, RAISED_FROM_ROW)
    );
    expect(captured.joinsCell).toBe(trunkCell(59));
    expect(connector.length).toBeGreaterThan(0);
    expect(
      connector.every((cell) => {
        return grid.columnOf(cell) >= SIDE_STREAM_COLUMN && grid.columnOf(cell) < TRUNK_COLUMN;
      })
    ).toBe(true);
  });

  it("keeps a lake's outflow and joins a stream to it near the lake", () => {
    const land = landWithLake(trunkCell(TRUNK_HEAD_ROW - 1));
    const tributary = stream(land, rowCells(15, 80, TRUNK_COLUMN + 1), 15, STREAM_FLOW);

    const spaced = spaceRiverChains(land, [tributary, trunk()]);

    expect(spaced).toEqual([trunk(), tributary]);
  });
});

describe("river spacing on generated islands", () => {
  it("keeps distinct rivers apart instead of running them side by side on several seeds and both shapes", () => {
    for (const seed of [3, 7, 11]) {
      for (const shape of ISLAND_SHAPES) {
        expect(closestDistinctRivers(coarseWorld(seed, shape))).toBeGreaterThan(SMALLEST_RIVER_GAP);
      }
    }
  });
});

describe("river spacing on full-size islands", () => {
  let worlds: GeneratedWorld[];

  beforeAll(() => {
    worlds = [fullSizeWorld(7), fullSizeWorld(1, "square")];
  }, FULL_SIZE_TIMEOUT);

  it("keeps the full-size rivers apart on both shapes", () => {
    for (const generated of worlds) {
      expect(closestDistinctRivers(generated)).toBeGreaterThan(SMALLEST_RIVER_GAP);
    }
  });
});

describe("river joins on full-size islands", () => {
  let worlds: GeneratedWorld[];

  beforeAll(() => {
    worlds = [fullSizeWorld(10), fullSizeWorld(1), fullSizeWorld(3, "square"), fullSizeWorld(8, "square")];
  }, FULL_SIZE_TIMEOUT);

  it("joins no river into another just below its cave or pond on several seeds and both shapes", () => {
    for (const generated of worlds) {
      expect(joinsNearSources(generated)).toEqual([]);
    }
  });

  it("ends every river in water: past the coast, in a lake or in another river", () => {
    for (const generated of worlds) {
      expect(endsAwayFromWater(generated)).toEqual([]);
    }
  });
});
