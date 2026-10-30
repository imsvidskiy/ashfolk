import { describe, expect, it } from "vitest";
import { WorldGrid } from "../world/world-grid.ts";
import { NO_CELL } from "./drainage.ts";
import type { RiverChain } from "./river-chains.ts";
import { type RiverLand, spaceRiverChains } from "./river-spacing.ts";

const TRUNK_COLUMN = 50;
const TRUNK_HEAD_ROW = 10;
const TRUNK_FLOW = 1000;
const STREAM_FLOW = 500;
const LATER_STREAM_FLOW = 400;

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 100 });

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

  it("keeps a lake's outflow and joins a stream to it near the lake", () => {
    const land = landWithLake(trunkCell(TRUNK_HEAD_ROW - 1));
    const tributary = stream(land, rowCells(15, 80, TRUNK_COLUMN + 1), 15, STREAM_FLOW);

    const spaced = spaceRiverChains(land, [tributary, trunk()]);

    expect(spaced).toEqual([trunk(), tributary]);
  });
});
