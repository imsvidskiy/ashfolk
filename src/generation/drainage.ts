import { hashToUnit } from "../shared/math.ts";
import { MinHeap } from "../shared/min-heap.ts";
import { isOnIsland, touchesOffIsland } from "../world/coast.ts";
import { type Lake, NO_WATER } from "../world/water.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../world/world-grid.ts";

export const NO_CELL = -1;
const REJECTED_LAKE = -2;
const FILL_EPSILON = 1e-3;
const FLOODED_DEPTH = 0.25;
const WANDER_SLOPE_SHARE = 0.65;
const WANDER_SALT = 61.7;
const WANDER_STEP = 10;
const WANDER_CHANCE_SALT = 29.3;

export interface HydrologyOptions {
  lakeMinimumArea: number;
  lakeMinimumCatchmentArea: number;
  lakeMinimumDepth: number;
  riverBasinMinimumArea: number;
  riverBasinMinimumDepth: number;
  riverCatchmentArea: number;
}

export const DEFAULT_HYDROLOGY: HydrologyOptions = {
  lakeMinimumArea: 3000,
  lakeMinimumCatchmentArea: 420_000,
  lakeMinimumDepth: 1.6,
  riverBasinMinimumArea: Number.POSITIVE_INFINITY,
  riverBasinMinimumDepth: 0.6,
  riverCatchmentArea: 200_000,
};

export const RESHAPED_LAND_HYDROLOGY: HydrologyOptions = { ...DEFAULT_HYDROLOGY, riverBasinMinimumArea: 500 };

interface CellThresholds {
  lakeMinimumCatchment: number;
  lakeMinimumCells: number;
  lakeMinimumDepth: number;
  riverBasinMinimumCells: number;
  riverBasinMinimumDepth: number;
  riverThreshold: number;
}

export interface DrainageNetwork {
  accumulation: Float32Array;
  filled: Float32Array;
  order: Int32Array;
  receivers: Int32Array;
}

export interface DrainageBasins {
  lakeIds: Int32Array;
  lakes: Lake[];
  network: DrainageNetwork;
  riverThreshold: number;
  waterSurface: Float32Array;
}

interface FloodedArea {
  cells: number[];
  level: number;
  maximumAccumulation: number;
  maximumDepth: number;
}

function toCellThresholds(grid: WorldGrid, options: HydrologyOptions): CellThresholds {
  const cellArea = grid.cellSize * grid.cellSize;

  return {
    lakeMinimumCatchment: options.lakeMinimumCatchmentArea / cellArea,
    lakeMinimumCells: Math.max(1, options.lakeMinimumArea / cellArea),
    lakeMinimumDepth: options.lakeMinimumDepth,
    riverBasinMinimumCells: Math.max(1, options.riverBasinMinimumArea / cellArea),
    riverBasinMinimumDepth: options.riverBasinMinimumDepth,
    riverThreshold: options.riverCatchmentArea / cellArea,
  };
}

export function isNearLake(grid: WorldGrid, lakeIds: Int32Array, x: number, z: number, radius: number): boolean {
  return grid.cellsInRadius(x, z, radius).some((cell) => {
    return lakeIds[cell] !== NO_CELL;
  });
}

function wanderingReceiver(grid: WorldGrid, filled: Float32Array, cell: number, weights: Float64Array): number {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const level = filled[cell];

  let steepest = 0;

  for (let index = 0; index < NEIGHBOR_OFFSETS.length; index += 1) {
    const offset = NEIGHBOR_OFFSETS[index];
    const neighbor = grid.neighborIndex(column, row, offset);

    weights[index] = neighbor < 0 ? 0 : Math.max(0, (level - filled[neighbor]) / offset.distance);
    steepest = Math.max(steepest, weights[index]);
  }

  let total = 0;

  for (let index = 0; index < NEIGHBOR_OFFSETS.length; index += 1) {
    weights[index] = Math.max(0, weights[index] - WANDER_SLOPE_SHARE * steepest);
    total += weights[index];
  }

  if (total <= 0) {
    return NO_CELL;
  }

  let pick = hashToUnit(column, row, WANDER_SALT) * total;

  for (let index = 0; index < NEIGHBOR_OFFSETS.length; index += 1) {
    pick -= weights[index];

    if (weights[index] > 0 && pick <= 0) {
      return grid.neighborIndex(column, row, NEIGHBOR_OFFSETS[index]);
    }
  }

  return NO_CELL;
}

function wanderReceivers(grid: WorldGrid, heights: Float32Array, filled: Float32Array, receivers: Int32Array): void {
  const wanderChance = Math.min(1, WANDER_STEP / grid.cellSize);
  const weights = new Float64Array(NEIGHBOR_OFFSETS.length);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (receivers[cell] === NO_CELL || filled[cell] > heights[cell]) {
      continue;
    }

    if (wanderChance < 1 && hashToUnit(grid.columnOf(cell), grid.rowOf(cell), WANDER_CHANCE_SALT) >= wanderChance) {
      continue;
    }

    const receiver = wanderingReceiver(grid, filled, cell, weights);

    if (receiver !== NO_CELL) {
      receivers[cell] = receiver;
    }
  }
}

function fillDepressions(heights: Float32Array, grid: WorldGrid, coastDistance: Float32Array): DrainageNetwork {
  const size = grid.cellsPerSide;
  const filled = Float32Array.from(heights);
  const closed = new Uint8Array(grid.cellCount);
  const receivers = new Int32Array(grid.cellCount).fill(NO_CELL);
  const order = new Int32Array(grid.cellCount);
  const heap = new MinHeap(size * 16);
  let processed = 0;

  function seedCell(cell: number): void {
    if (closed[cell] === 1 || !isOnIsland(coastDistance, cell)) {
      return;
    }

    closed[cell] = 1;
    heap.push(cell, filled[cell]);
  }

  for (let position = 0; position < size; position += 1) {
    seedCell(grid.index(position, 0));
    seedCell(grid.index(position, size - 1));
    seedCell(grid.index(0, position));
    seedCell(grid.index(size - 1, position));
  }

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (isOnIsland(coastDistance, cell) && touchesOffIsland(grid, coastDistance, cell)) {
      seedCell(cell);
    }
  }

  while (heap.size > 0) {
    const cell = heap.pop();

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);
    const level = filled[cell];

    order[processed] = cell;
    processed += 1;

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0) {
        continue;
      }

      if (closed[neighbor] === 1 || !isOnIsland(coastDistance, neighbor)) {
        continue;
      }

      const neighborLevel = Math.max(heights[neighbor], level + FILL_EPSILON);

      closed[neighbor] = 1;
      filled[neighbor] = neighborLevel;
      receivers[neighbor] = cell;
      heap.push(neighbor, neighborLevel);
    }
  }

  wanderReceivers(grid, heights, filled, receivers);

  const accumulation = new Float32Array(grid.cellCount).fill(1);

  for (let position = processed - 1; position >= 0; position -= 1) {
    const cell = order[position];
    const receiver = receivers[cell];

    if (receiver !== NO_CELL) {
      accumulation[receiver] += accumulation[cell];
    }
  }

  return { accumulation, filled, order, receivers };
}

function collectFloodedArea(
  grid: WorldGrid,
  heights: Float32Array,
  network: DrainageNetwork,
  start: number,
  visited: Int32Array,
  marker: number
): FloodedArea {
  const area: FloodedArea = { cells: [], level: Number.POSITIVE_INFINITY, maximumAccumulation: 0, maximumDepth: 0 };
  const stack = [start];

  visited[start] = marker;

  for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
    area.cells.push(cell);
    area.maximumAccumulation = Math.max(area.maximumAccumulation, network.accumulation[cell]);
    area.level = Math.min(area.level, network.filled[cell]);
    area.maximumDepth = Math.max(area.maximumDepth, network.filled[cell] - heights[cell]);

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0) {
        continue;
      }

      if (visited[neighbor] === NO_CELL && network.filled[neighbor] - heights[neighbor] >= FLOODED_DEPTH) {
        visited[neighbor] = marker;
        stack.push(neighbor);
      }
    }
  }

  return area;
}

function averageCell(grid: WorldGrid, cells: readonly number[]): { x: number; z: number } {
  let sumX = 0;
  let sumZ = 0;

  for (const cell of cells) {
    sumX += grid.cellCenterX(cell);
    sumZ += grid.cellCenterZ(cell);
  }

  return { x: sumX / cells.length, z: sumZ / cells.length };
}

function isFilledByRiver(area: FloodedArea, options: CellThresholds): boolean {
  return (
    area.cells.length >= options.riverBasinMinimumCells &&
    area.maximumAccumulation >= options.riverThreshold &&
    area.maximumDepth >= options.riverBasinMinimumDepth
  );
}

function isLakeKept(area: FloodedArea, centerDryness: number, options: CellThresholds): boolean {
  const catchmentNeeded = options.lakeMinimumCatchment * (1 + 6 * centerDryness);

  const isLargeLake =
    area.cells.length >= options.lakeMinimumCells &&
    area.maximumAccumulation >= catchmentNeeded &&
    area.maximumDepth >= options.lakeMinimumDepth;

  return isLargeLake || isFilledByRiver(area, options);
}

function findLakes(
  heights: Float32Array,
  network: DrainageNetwork,
  grid: WorldGrid,
  dryness: Float32Array,
  options: CellThresholds,
  waterSurface: Float32Array,
  lakeIds: Int32Array
): Lake[] {
  const lakes: Lake[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (lakeIds[cell] !== NO_CELL || network.filled[cell] - heights[cell] < FLOODED_DEPTH) {
      continue;
    }

    const id = lakes.length;
    const area = collectFloodedArea(grid, heights, network, cell, lakeIds, id);

    const center = averageCell(grid, area.cells);
    const centerDryness = dryness[grid.cellAt(center.x, center.z)];

    if (!isLakeKept(area, centerDryness, options)) {
      for (const floodedCell of area.cells) {
        lakeIds[floodedCell] = REJECTED_LAKE;
      }

      continue;
    }

    for (const floodedCell of area.cells) {
      waterSurface[floodedCell] = area.level;
    }

    lakes.push({
      cellCount: area.cells.length,
      centerX: center.x,
      centerZ: center.z,
      id,
      level: area.level,
    });
  }

  for (let cell = 0; cell < lakeIds.length; cell += 1) {
    if (lakeIds[cell] === REJECTED_LAKE) {
      lakeIds[cell] = NO_CELL;
    }
  }

  return lakes;
}

export function channelGround(heights: Float32Array, network: DrainageNetwork, cell: number): number {
  const filled = network.filled[cell];

  if (filled - heights[cell] < FLOODED_DEPTH) {
    return heights[cell];
  }

  return filled;
}

export function analyzeDrainage(
  heights: Float32Array,
  grid: WorldGrid,
  dryness: Float32Array,
  coastDistance: Float32Array,
  options: HydrologyOptions = DEFAULT_HYDROLOGY
): DrainageBasins {
  const thresholds = toCellThresholds(grid, options);
  const network = fillDepressions(heights, grid, coastDistance);
  const waterSurface = new Float32Array(grid.cellCount).fill(NO_WATER);
  const lakeIds = new Int32Array(grid.cellCount).fill(NO_CELL);

  const lakes = findLakes(heights, network, grid, dryness, thresholds, waterSurface, lakeIds);

  return { lakeIds, lakes, network, riverThreshold: thresholds.riverThreshold, waterSurface };
}
