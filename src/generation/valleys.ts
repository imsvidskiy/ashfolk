import { clamp, smoothstep } from "../shared/math.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import { analyzeDrainage, type DrainageBasins, NO_CELL } from "./drainage.ts";

const SMALLEST_VALLEY_FLOW = 0.25;
const LAKE_TAPER_CELLS = 12;
const LAKE_MARGIN = 0.6;
const FLOOR_RISE = 0.03;
const SIDE_CUT_LIMIT = 1.6;
const WIDEST_HALF_WIDTH = 75;

interface ValleyShape {
  readonly depth: number;
  readonly floorHalfWidth: number;
  readonly halfWidth: number;
}

interface ValleyCarving {
  readonly grid: WorldGrid;
  readonly heights: Float32Array;
  readonly original: Float32Array;
}

function valleyShape(strength: number, taper: number): ValleyShape {
  const halfWidth = clamp(22 + 12 * strength, 10, WIDEST_HALF_WIDTH);

  return {
    depth: clamp(5 + 4 * strength, 1.5, 22) * taper,
    floorHalfWidth: halfWidth * clamp(0.15 + 0.07 * strength, 0, 0.45),
    halfWidth,
  };
}

function downstreamLakeLevels({ lakeIds, lakes, network }: DrainageBasins): Float32Array {
  const levels = new Float32Array(lakeIds.length).fill(Number.NEGATIVE_INFINITY);

  for (const cell of network.order) {
    const lakeId = lakeIds[cell];
    const receiver = network.receivers[cell];

    if (lakeId !== NO_CELL) {
      levels[cell] = lakes[lakeId].level;

      continue;
    }

    if (receiver !== NO_CELL) {
      levels[cell] = levels[receiver];
    }
  }

  return levels;
}

function cellsBelowLakes({ lakeIds, network }: DrainageBasins): Float32Array {
  const distances = new Float32Array(lakeIds.length).fill(Number.POSITIVE_INFINITY);

  for (let position = network.order.length - 1; position >= 0; position -= 1) {
    const cell = network.order[position];
    const receiver = network.receivers[cell];

    if (lakeIds[cell] !== NO_CELL) {
      distances[cell] = 0;
    }

    if (receiver !== NO_CELL) {
      distances[receiver] = Math.min(distances[receiver], distances[cell] + 1);
    }
  }

  return distances;
}

function stampValley(carving: ValleyCarving, cell: number, floor: number, shape: ValleyShape): void {
  const { grid, heights, original } = carving;

  const reach = Math.ceil(shape.halfWidth / grid.cellSize);
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const sideCut = SIDE_CUT_LIMIT * shape.depth;

  for (let rowOffset = -reach; rowOffset <= reach; rowOffset += 1) {
    for (let columnOffset = -reach; columnOffset <= reach; columnOffset += 1) {
      const distance = Math.sqrt(columnOffset * columnOffset + rowOffset * rowOffset) * grid.cellSize;

      if (distance > shape.halfWidth || !grid.contains(column + columnOffset, row + rowOffset)) {
        continue;
      }

      const neighbor = grid.index(column + columnOffset, row + rowOffset);
      const ground = original[neighbor];
      const floorHere = floor + FLOOR_RISE * distance;

      if (ground <= floorHere) {
        continue;
      }

      const profile = 1 - smoothstep(shape.floorHalfWidth, shape.halfWidth, distance);

      heights[neighbor] = Math.min(heights[neighbor], ground - profile * Math.min(ground - floorHere, sideCut));
    }
  }
}

function widestAlongRows(levels: Float32Array, size: number, reach: number): Float32Array {
  const widest = new Float32Array(levels.length);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let highest = Number.NEGATIVE_INFINITY;

      for (let offset = Math.max(0, column - reach); offset <= Math.min(size - 1, column + reach); offset += 1) {
        highest = Math.max(highest, levels[row * size + offset]);
      }

      widest[column * size + row] = highest;
    }
  }

  return widest;
}

function protectLakeRims(carving: ValleyCarving, basins: DrainageBasins): void {
  const { grid, heights, original } = carving;

  const levels = new Float32Array(grid.cellCount).fill(Number.NEGATIVE_INFINITY);
  const reach = Math.ceil(WIDEST_HALF_WIDTH / grid.cellSize);

  for (const [cell, lakeId] of basins.lakeIds.entries()) {
    if (lakeId !== NO_CELL) {
      levels[cell] = basins.lakes[lakeId].level + LAKE_MARGIN;
    }
  }

  const guarded = widestAlongRows(widestAlongRows(levels, grid.cellsPerSide, reach), grid.cellsPerSide, reach);

  for (const [cell, level] of guarded.entries()) {
    heights[cell] = Math.max(heights[cell], Math.min(original[cell], level));
  }
}

export function carveValleys(
  heights: Float32Array,
  grid: WorldGrid,
  dryness: Float32Array,
  coastDistance: Float32Array
): void {
  const basins = analyzeDrainage(heights, grid, dryness, coastDistance);
  const carving: ValleyCarving = { grid, heights, original: Float32Array.from(heights) };
  const baseLevels = downstreamLakeLevels(basins);
  const belowLakes = cellsBelowLakes(basins);
  const smallestFlow = SMALLEST_VALLEY_FLOW * basins.riverThreshold;

  for (const [cell, flow] of basins.network.accumulation.entries()) {
    if (flow < smallestFlow || basins.lakeIds[cell] !== NO_CELL) {
      continue;
    }

    const shape = valleyShape(
      Math.log2(flow / basins.riverThreshold),
      smoothstep(0, LAKE_TAPER_CELLS, belowLakes[cell])
    );

    const floor = Math.max(carving.original[cell] - shape.depth, baseLevels[cell] + LAKE_MARGIN);

    if (floor < carving.original[cell]) {
      stampValley(carving, cell, floor, shape);
    }
  }

  protectLakeRims(carving, basins);
}
