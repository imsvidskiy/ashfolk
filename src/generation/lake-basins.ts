import { clamp, lerp, smoothstep } from "../shared/math.ts";
import { MinHeap } from "../shared/min-heap.ts";
import { type RandomSource, shuffle } from "../shared/random.ts";
import { isOnIsland } from "../world/coast.ts";
import { countForArea } from "../world/island-size.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../world/world-grid.ts";
import { boxBlur } from "./box-blur.ts";
import { analyzeDrainage, DEFAULT_HYDROLOGY, type DrainageBasins, NO_CELL } from "./drainage.ts";

const NORMAL_LAKE_COUNT = 3;
const SMALLEST_FEED = 1.2;
const LARGEST_FEED = 30;
const STEEPEST_RIVER = 0.09;
const RIVER_SAMPLE_CELLS = 15;
const DRIEST_SITE = 0.15;
const NEAREST_BOUNDARY = 0.22;
const SITE_SEPARATION = 900;
const LAKE_CLEARANCE = 400;
const SHALLOWEST_DIG = 12;
const DEEPEST_DIG = 45;
const CLOSING_MARGIN = 2.2;
const GENTLE_SHORE_SLOPE = 0.12;
const STEEPEST_SHORE_SLOPE = 0.85;
const GENTLE_SHORE_WIDTH = 40;
const SHORE_STEEPENING_WIDTH = 120;
const FAR_SLOPE = 0.95;
const FAR_SLOPE_START = 150;
const FAR_SLOPE_END = 300;
const SHORE_BAND = 150;
const WALL_SLOPE = 1.05;
const WALL_SLOPE_START = 300;
const WALL_SLOPE_END = 450;
const EXACT_CUT_WIDTH = 80;
const BLENDED_CUT_WIDTH = 160;
const CUT_BLUR_RADIUS = 20;
const CUT_BLUR_PASSES = 2;
const SHALLOW_CUT = 10;
const DEEP_CUT = 40;
const SHORE_CLEARANCE = 0.4;
const RISE_TABLE_STEP = 1;

export interface LakeSiting {
  readonly boundaryDistance: (cell: number) => number;
  readonly coastDistance: Float32Array;
  readonly dryness: Float32Array;
  readonly grid: WorldGrid;
  readonly random: RandomSource;
}

interface LakeSite {
  readonly cell: number;
  readonly riverSlope: number;
}

interface ShoreCut {
  readonly ceilings: Float32Array;
  readonly distances: Float32Array;
  readonly levels: Float32Array;
}

interface Clearance {
  readonly radius: number;
  readonly x: number;
  readonly z: number;
}

function riverSlope(basins: DrainageBasins, heights: Float32Array, grid: WorldGrid, start: number): number {
  let cell = start;
  let length = 0;

  for (let step = 0; step < RIVER_SAMPLE_CELLS; step += 1) {
    const receiver = basins.network.receivers[cell];

    if (receiver === NO_CELL) {
      break;
    }

    length += grid.distanceBetween(cell, receiver);
    cell = receiver;
  }

  if (length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return (heights[start] - heights[cell]) / length;
}

function isClearOf(grid: WorldGrid, cell: number, clearances: readonly Clearance[]): boolean {
  const x = grid.cellCenterX(cell);
  const z = grid.cellCenterZ(cell);

  return clearances.every((clearance) => {
    return Math.hypot(clearance.x - x, clearance.z - z) > clearance.radius;
  });
}

function feedingCells(basins: DrainageBasins, siting: LakeSiting): number[] {
  const { grid } = siting;

  const lakeFeed = DEFAULT_HYDROLOGY.lakeMinimumCatchmentArea / (grid.cellSize * grid.cellSize);
  const candidates: number[] = [];

  for (const [cell, flow] of basins.network.accumulation.entries()) {
    const isFedRiver = flow >= SMALLEST_FEED * lakeFeed && flow <= LARGEST_FEED * lakeFeed;

    if (isFedRiver && basins.lakeIds[cell] === NO_CELL && siting.dryness[cell] < DRIEST_SITE) {
      candidates.push(cell);
    }
  }

  return candidates;
}

function chooseSites(heights: Float32Array, basins: DrainageBasins, siting: LakeSiting): LakeSite[] {
  const { grid } = siting;

  const cellArea = grid.cellSize * grid.cellSize;
  const clearances: Clearance[] = basins.lakes.map((lake) => {
    return {
      radius: Math.sqrt((lake.cellCount * cellArea) / Math.PI) + LAKE_CLEARANCE,
      x: lake.centerX,
      z: lake.centerZ,
    };
  });
  const sites: LakeSite[] = [];
  const lakeCount = countForArea(grid, NORMAL_LAKE_COUNT);

  for (const cell of shuffle(siting.random, feedingCells(basins, siting))) {
    if (sites.length >= lakeCount) {
      break;
    }

    if (!isClearOf(grid, cell, clearances) || siting.boundaryDistance(cell) <= NEAREST_BOUNDARY) {
      continue;
    }

    const slope = riverSlope(basins, heights, grid, cell);

    if (slope < STEEPEST_RIVER) {
      sites.push({ cell, riverSlope: slope });
      clearances.push({ radius: SITE_SEPARATION, x: grid.cellCenterX(cell), z: grid.cellCenterZ(cell) });
    }
  }

  return sites;
}

function digBasin(heights: Float32Array, grid: WorldGrid, site: LakeSite, random: RandomSource): void {
  const spread = random.between(110, 170);
  const depth = clamp(8 + CLOSING_MARGIN * site.riverSlope * spread, SHALLOWEST_DIG, DEEPEST_DIG);

  const x = grid.cellCenterX(site.cell);
  const z = grid.cellCenterZ(site.cell);

  for (const cell of grid.cellsInRadius(x, z, spread * 3)) {
    const distanceSquared = (grid.cellCenterX(cell) - x) ** 2 + (grid.cellCenterZ(cell) - z) ** 2;

    heights[cell] -= depth * Math.exp(-distanceSquared / (2 * spread * spread));
  }
}

function shoreSlopeAt(distance: number): number {
  const nearSlope = lerp(
    GENTLE_SHORE_SLOPE,
    STEEPEST_SHORE_SLOPE,
    smoothstep(GENTLE_SHORE_WIDTH, SHORE_STEEPENING_WIDTH, distance)
  );

  const farSlope = lerp(FAR_SLOPE, WALL_SLOPE, smoothstep(WALL_SLOPE_START, WALL_SLOPE_END, distance));

  return lerp(nearSlope, farSlope, smoothstep(FAR_SLOPE_START, FAR_SLOPE_END, distance));
}

function rimFallAt(distance: number): number {
  return distance <= GENTLE_SHORE_WIDTH ? GENTLE_SHORE_SLOPE : STEEPEST_SHORE_SLOPE;
}

function shoreRises(): Float32Array {
  const rises = new Float32Array(Math.ceil(WALL_SLOPE_END / RISE_TABLE_STEP) + 1);

  for (let index = 1; index < rises.length; index += 1) {
    rises[index] = rises[index - 1] + RISE_TABLE_STEP * shoreSlopeAt((index - 0.5) * RISE_TABLE_STEP);
  }

  return rises;
}

const SHORE_RISES = shoreRises();

function shoreRiseAt(distance: number): number {
  const position = distance / RISE_TABLE_STEP;
  const last = SHORE_RISES.length - 1;

  if (position >= last) {
    return SHORE_RISES[last] + (position - last) * RISE_TABLE_STEP * WALL_SLOPE;
  }

  const index = Math.floor(position);

  return lerp(SHORE_RISES[index], SHORE_RISES[index + 1], position - index);
}

function canCutPast(heights: Float32Array, cut: ShoreCut, cell: number): boolean {
  return cut.distances[cell] <= SHORE_BAND || heights[cell] > cut.ceilings[cell];
}

function seedLakeCells(
  grid: WorldGrid,
  basins: DrainageBasins,
  values: Float32Array,
  distances: Float32Array,
  priorityOf: (level: number) => number
): MinHeap {
  const { lakeIds, lakes } = basins;

  const heap = new MinHeap(grid.cellsPerSide * 16);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (lakeIds[cell] !== NO_CELL) {
      distances[cell] = 0;
      values[cell] = lakes[lakeIds[cell]].level;
      heap.push(cell, priorityOf(values[cell]));
    }
  }

  return heap;
}

function measureShoreCut(heights: Float32Array, grid: WorldGrid, basins: DrainageBasins): ShoreCut {
  const { lakeIds } = basins;

  const ceilings = new Float32Array(grid.cellCount).fill(Number.POSITIVE_INFINITY);
  const distances = new Float32Array(grid.cellCount).fill(Number.POSITIVE_INFINITY);
  const heap = seedLakeCells(grid, basins, ceilings, distances, (level) => {
    return level;
  });
  const levels = ceilings.map((ceiling) => {
    return Number.isFinite(ceiling) ? ceiling : Number.NEGATIVE_INFINITY;
  });
  const cut: ShoreCut = { ceilings, distances, levels };
  const nearest = Int32Array.from(lakeIds, (lakeId, cell) => {
    return lakeId === NO_CELL ? NO_CELL : cell;
  });
  const isSettled = new Uint8Array(grid.cellCount);

  while (heap.size > 0) {
    const cell = heap.pop();

    if (isSettled[cell] === 1 || !canCutPast(heights, cut, cell)) {
      continue;
    }

    isSettled[cell] = 1;

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);
    const shore = nearest[cell];

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0 || lakeIds[neighbor] !== NO_CELL) {
        continue;
      }

      const distance = grid.distanceBetween(shore, neighbor);
      const ceiling = cut.levels[cell] + shoreRiseAt(distance);

      if (ceiling < cut.ceilings[neighbor]) {
        nearest[neighbor] = shore;
        cut.ceilings[neighbor] = ceiling;
        cut.distances[neighbor] = distance;
        cut.levels[neighbor] = cut.levels[cell];
        heap.push(neighbor, ceiling);
      }
    }
  }

  return cut;
}

function measureRimFloors(grid: WorldGrid, basins: DrainageBasins, ceilings: Float32Array): Float32Array {
  const { lakeIds } = basins;

  const floors = new Float32Array(grid.cellCount).fill(Number.NEGATIVE_INFINITY);
  const distances = new Float32Array(grid.cellCount).fill(Number.POSITIVE_INFINITY);
  const isSettled = new Uint8Array(grid.cellCount);
  const heap = seedLakeCells(grid, basins, floors, distances, (level) => {
    return -level;
  });

  while (heap.size > 0) {
    const cell = heap.pop();

    if (isSettled[cell] === 1) {
      continue;
    }

    isSettled[cell] = 1;

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);
    const isLake = lakeIds[cell] !== NO_CELL;

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0 || lakeIds[neighbor] !== NO_CELL || ceilings[neighbor] === Number.POSITIVE_INFINITY) {
        continue;
      }

      const step = isLake ? 0 : offset.distance * grid.cellSize;
      const distance = distances[cell] + step;
      const floor = floors[cell] - step * rimFallAt(distance - step / 2);

      if (floor > floors[neighbor]) {
        floors[neighbor] = floor;
        distances[neighbor] = distance;
        heap.push(neighbor, -floor);
      }
    }
  }

  return floors;
}

function blurredCuts(grid: WorldGrid, cuts: Float32Array): Float32Array {
  const radius = Math.round(CUT_BLUR_RADIUS / grid.cellSize);
  let blurred = cuts;

  if (radius < 1) {
    return blurred;
  }

  for (let pass = 0; pass < CUT_BLUR_PASSES; pass += 1) {
    blurred = boxBlur(grid.cellsPerSide, blurred, radius);
  }

  return blurred;
}

export function easeLakeShores(
  heights: Float32Array,
  grid: WorldGrid,
  coastDistance: Float32Array,
  basins: DrainageBasins
): void {
  const cut = measureShoreCut(heights, grid, basins);
  const floors = measureRimFloors(grid, basins, cut.ceilings);

  const isEased = (cell: number): boolean => {
    return basins.lakeIds[cell] === NO_CELL && isOnIsland(coastDistance, cell);
  };
  const exactCuts = heights.map((height, cell) => {
    return isEased(cell) ? Math.max(0, height - cut.ceilings[cell]) : 0;
  });
  const smoothCuts = blurredCuts(grid, exactCuts);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!isEased(cell)) {
      continue;
    }

    const nearness = 1 - smoothstep(EXACT_CUT_WIDTH, BLENDED_CUT_WIDTH, cut.distances[cell]);
    const depth = smoothstep(SHALLOW_CUT, DEEP_CUT, Math.min(exactCuts[cell], smoothCuts[cell]));
    const exactness = Math.max(nearness, depth);
    const lowest = Math.max(floors[cell], cut.levels[cell] + SHORE_CLEARANCE);
    const eased = heights[cell] - lerp(smoothCuts[cell], exactCuts[cell], exactness);

    heights[cell] = Math.min(heights[cell], Math.max(eased, lowest));
  }
}

export function digRiverLakes(heights: Float32Array, siting: LakeSiting): void {
  const basins = analyzeDrainage(heights, siting.grid, siting.dryness, siting.coastDistance);

  for (const site of chooseSites(heights, basins, siting)) {
    digBasin(heights, siting.grid, site, siting.random);
  }
}

export function fillSinks(
  heights: Float32Array,
  grid: WorldGrid,
  dryness: Float32Array,
  coastDistance: Float32Array
): DrainageBasins {
  const basins = analyzeDrainage(heights, grid, dryness, coastDistance);

  for (const [cell, level] of basins.network.filled.entries()) {
    if (basins.lakeIds[cell] === NO_CELL) {
      heights[cell] = Math.max(heights[cell], level);
    }
  }

  return basins;
}
