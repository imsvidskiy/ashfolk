import { isWaterCell, type RiverTerrain } from "./terrain-sampling.ts";
import { riverCodeOfWidth } from "./water.ts";
import type { WorldGrid } from "./world-grid.ts";

export const HOP_WIDTH = 4;
export const HOP_REACH = 22;
export const NOT_CLEAR = -1;

export const BROOK_STRENGTH = Math.floor(riverCodeOfWidth(HOP_WIDTH));

export const Passage = {
  Blocked: 0,
  Brook: 2,
  Ground: 1,
} as const;

const NOT_WET = -1;
const HOP_SPAN_CELLS = 3.2;
const HOP_OFFSETS = hopOffsets();

export type Passage = (typeof Passage)[keyof typeof Passage];

interface Point {
  readonly x: number;
  readonly z: number;
}

interface CellOffset {
  readonly column: number;
  readonly row: number;
}

function hopOffsets(): CellOffset[] {
  const reach = Math.floor(HOP_SPAN_CELLS);
  const offsets: CellOffset[] = [];

  for (let row = -reach; row <= reach; row += 1) {
    for (let column = -reach; column <= reach; column += 1) {
      if (Math.max(Math.abs(column), Math.abs(row)) >= 2 && Math.hypot(column, row) <= HOP_SPAN_CELLS) {
        offsets.push({ column, row });
      }
    }
  }

  return offsets;
}

export function isBrookCell(terrain: RiverTerrain, cell: number): boolean {
  const strength = terrain.riverStrength[cell];

  return strength > 0 && strength <= BROOK_STRENGTH && isWaterCell(terrain, cell);
}

export function traceHops(
  grid: WorldGrid,
  from: Point,
  to: Point,
  passageOf: (cell: number, enter: number, leave: number) => Passage
): number {
  const length = Math.hypot(to.x - from.x, to.z - from.z);

  let hops = 0;
  let wetFrom = NOT_WET;

  const isClear = grid.traceAlong(from.x, from.z, to.x, to.z, (cell, enter, leave) => {
    const passage = passageOf(cell, enter, leave);

    if (passage === Passage.Blocked) {
      return false;
    }

    if (passage === Passage.Ground) {
      wetFrom = NOT_WET;

      return true;
    }

    if (wetFrom === NOT_WET) {
      wetFrom = enter;
      hops += 1;
    }

    return (leave - wetFrom) * length <= HOP_REACH;
  });

  if (!isClear || wetFrom !== NOT_WET) {
    return NOT_CLEAR;
  }

  return hops;
}

export function hopTargets(grid: WorldGrid, cell: number, passageOf: (cell: number) => Passage): number[] {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const from = { x: grid.cellCenterX(cell), z: grid.cellCenterZ(cell) };
  const targets: number[] = [];

  for (const offset of HOP_OFFSETS) {
    const targetColumn = column + offset.column;
    const targetRow = row + offset.row;

    if (!grid.contains(targetColumn, targetRow)) {
      continue;
    }

    const target = grid.index(targetColumn, targetRow);

    if (passageOf(target) !== Passage.Ground) {
      continue;
    }

    const to = { x: grid.cellCenterX(target), z: grid.cellCenterZ(target) };

    if (traceHops(grid, from, to, passageOf) > 0) {
      targets.push(target);
    }
  }

  return targets;
}

export function bordersBrook(grid: WorldGrid, cell: number, passageOf: (cell: number) => Passage): boolean {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      const neighborColumn = column + columnOffset;
      const neighborRow = row + rowOffset;

      if (
        grid.contains(neighborColumn, neighborRow) &&
        passageOf(grid.index(neighborColumn, neighborRow)) === Passage.Brook
      ) {
        return true;
      }
    }
  }

  return false;
}
