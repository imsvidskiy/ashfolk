import { clamp } from "../../shared/math.ts";
import { type CellRegion, grownRegion } from "../../world/change-tracking.ts";
import { NO_WATER } from "../../world/water.ts";

export const ShoreChannel = {
  Depth: 0,
  FlowX: 1,
  FlowZ: 2,
  Reach: 3,
} as const;

export const PRESENT_LEVEL = NO_WATER / 2;
export const BANK_SINK = 0.3;
export const BANK_STEP = 1.5;
export const DRY_DEPTH = -1;
export const MAXIMUM_REACH = 12;
export const SHORE_CHANNELS = 4;
export const NOT_POND = Number.POSITIVE_INFINITY;

const CORNER_BRIDGE = 0.25;
const SOFT_SHORE_SINK = 0.05;

export interface ShoreSource {
  readonly cellSize: number;
  readonly heights: Float32Array;
  readonly levels: Float32Array;
  readonly pondDepths: Float32Array;
  readonly size: number;
}

function isWet(level: number): boolean {
  return level > PRESENT_LEVEL;
}

function bankLevel(source: ShoreSource, column: number, row: number): number {
  const { levels, size } = source;

  let highestBeside = NO_WATER;
  let highest = NO_WATER;

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      const neighborColumn = clamp(column + columnOffset, 0, size - 1);
      const neighborRow = clamp(row + rowOffset, 0, size - 1);
      const level = levels[neighborRow * size + neighborColumn];

      if (!isWet(level)) {
        continue;
      }

      highest = Math.max(highest, level);

      if (Math.abs(rowOffset) + Math.abs(columnOffset) === 1) {
        highestBeside = Math.max(highestBeside, level);
      }
    }
  }

  return isWet(highestBeside) ? highestBeside : highest;
}

function wetDepth(source: ShoreSource, column: number, row: number): number {
  const { heights, levels, size } = source;

  if (column < 0 || row < 0 || column >= size || row >= size) {
    return 0;
  }

  const cell = row * size + column;

  if (!isWet(levels[cell])) {
    return 0;
  }

  return Math.max(0, levels[cell] - heights[cell]);
}

function deepestBeside(source: ShoreSource, column: number, row: number): number {
  let deepest = 0;

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      deepest = Math.max(deepest, wetDepth(source, column + columnOffset, row + rowOffset));
    }
  }

  return deepest;
}

function cornerDepth(source: ShoreSource, column: number, row: number): number {
  const west = wetDepth(source, column - 1, row);
  const east = wetDepth(source, column + 1, row);
  const north = wetDepth(source, column, row - 1);
  const south = wetDepth(source, column, row + 1);

  return Math.max(Math.min(west, north), Math.min(north, east), Math.min(east, south), Math.min(south, west));
}

function bankSink(source: ShoreSource, cell: number, column: number, row: number): number {
  if (source.pondDepths[cell] !== NOT_POND) {
    return SOFT_SHORE_SINK;
  }

  return Math.max(BANK_SINK, deepestBeside(source, column, row));
}

function flowAcross(before: number, after: number, cellSize: number): number {
  if (!(isWet(before) && isWet(after))) {
    return 0;
  }

  return (before - after) / (cellSize * 2);
}

function writeShore(source: ShoreSource, column: number, row: number, target: Float32Array): void {
  const { cellSize, heights, levels, size } = source;

  const cell = row * size + column;
  const offset = cell * SHORE_CHANNELS;
  const level = levels[cell];
  const ground = heights[cell];

  if (isWet(level)) {
    const west = levels[row * size + Math.max(0, column - 1)];
    const east = levels[row * size + Math.min(size - 1, column + 1)];
    const north = levels[Math.max(0, row - 1) * size + column];
    const south = levels[Math.min(size - 1, row + 1) * size + column];

    target[offset + ShoreChannel.Depth] = level - ground;
    target[offset + ShoreChannel.FlowX] = flowAcross(west, east, cellSize);
    target[offset + ShoreChannel.FlowZ] = flowAcross(north, south, cellSize);

    return;
  }

  target[offset + ShoreChannel.FlowX] = 0;
  target[offset + ShoreChannel.FlowZ] = 0;

  if (target[offset + ShoreChannel.Reach] > 1) {
    target[offset + ShoreChannel.Depth] = DRY_DEPTH;

    return;
  }

  const bank = bankLevel(source, column, row);
  const bankDepth = isWet(bank)
    ? Math.min(bank - ground, -bankSink(source, cell, column, row), source.pondDepths[cell])
    : DRY_DEPTH;
  const corner = cornerDepth(source, column, row);

  target[offset + ShoreChannel.Depth] = corner > 0 ? Math.max(bankDepth, -CORNER_BRIDGE * corner) : bankDepth;
}

function reachThrough(target: Float32Array, size: number, column: number, row: number): number {
  if (column < 0 || row < 0 || column >= size || row >= size) {
    return MAXIMUM_REACH;
  }

  return target[(row * size + column) * SHORE_CHANNELS + ShoreChannel.Reach] + 1;
}

function resetReach(source: ShoreSource, region: CellRegion, target: Float32Array): void {
  const { levels, size } = source;

  for (let row = region.firstRow; row <= region.lastRow; row += 1) {
    for (let column = region.firstColumn; column <= region.lastColumn; column += 1) {
      const cell = row * size + column;

      target[cell * SHORE_CHANNELS + ShoreChannel.Reach] = isWet(levels[cell]) ? 0 : MAXIMUM_REACH;
    }
  }
}

function sweepReach(target: Float32Array, size: number, region: CellRegion, direction: 1 | -1): void {
  const { firstColumn, firstRow, lastColumn, lastRow } = region;

  const startRow = direction === 1 ? firstRow : lastRow;
  const startColumn = direction === 1 ? firstColumn : lastColumn;

  for (let row = startRow; row >= firstRow && row <= lastRow; row += direction) {
    const previousRow = row - direction;

    for (let column = startColumn; column >= firstColumn && column <= lastColumn; column += direction) {
      const offset = (row * size + column) * SHORE_CHANNELS + ShoreChannel.Reach;
      const previousColumn = column - direction;
      const nextColumn = column + direction;

      target[offset] = Math.min(
        target[offset],
        reachThrough(target, size, previousColumn, row),
        reachThrough(target, size, previousColumn, previousRow),
        reachThrough(target, size, column, previousRow),
        reachThrough(target, size, nextColumn, previousRow)
      );
    }
  }
}

function writeShores(source: ShoreSource, region: CellRegion, target: Float32Array): void {
  for (let row = region.firstRow; row <= region.lastRow; row += 1) {
    for (let column = region.firstColumn; column <= region.lastColumn; column += 1) {
      writeShore(source, column, row, target);
    }
  }
}

function rebuildShores(source: ShoreSource, region: CellRegion, target: Float32Array): void {
  resetReach(source, region, target);
  sweepReach(target, source.size, region, 1);
  sweepReach(target, source.size, region, -1);
  writeShores(source, region, target);
}

export function buildShoreField(source: ShoreSource, target: Float32Array): void {
  const last = source.size - 1;

  rebuildShores(source, { firstColumn: 0, firstRow: 0, lastColumn: last, lastRow: last }, target);
}

export function updateShoreField(source: ShoreSource, region: CellRegion, target: Float32Array): void {
  rebuildShores(source, grownRegion(region, MAXIMUM_REACH, source.size), target);
}

export function updateShoreDepths(source: ShoreSource, region: CellRegion, target: Float32Array): void {
  writeShores(source, grownRegion(region, 1, source.size), target);
}
