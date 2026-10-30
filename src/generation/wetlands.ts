import { clamp, smoothstep } from "../shared/math.ts";
import { createNoiseSampler } from "../shared/noise.ts";
import { createRandom } from "../shared/random.ts";
import { isOnIsland } from "../world/coast.ts";
import { hasWater, type River, type RiverPoint } from "../world/water.ts";
import { ORTHOGONAL_STEPS, type WorldGrid } from "../world/world-grid.ts";
import { boxBlur } from "./box-blur.ts";

const UNREACHED = -1;
const LAKE_REACH = 420;
const RIVER_REACH = 220;
const RIVER_REACH_PER_WIDTH = 9;
const GRADE_WINDOW = 40;
const SLOW_RIVER_GRADE = 0.06;
const FAST_RIVER_GRADE = 0.16;
const FAST_RIVER_SHARE = 0.3;
const DELTA_DISTANCE = 700;
const DELTA_REACH = 1.8;
const LAKE_RISE = 14;
const RIVER_RISE = 12;
const BASIN_RADIUS = 260;
const BASIN_DEPTH_START = 3;
const BASIN_DEPTH_END = 12;
const FLAT_SHORE = 0.13;
const STEEP_SHORE = 0.28;
const FLAT_BASIN = 0.14;
const STEEP_BASIN = 0.28;
const STEEPEST_WETLAND = 0.36;
const HIGHEST_LOWLAND = 480;
const HIGHEST_WETLAND = 620;
const LOWEST_DRY_DESERT = 0.18;
const DRY_DESERT = 0.32;
const PATCH_SPAN = 420;
const PATCH_START = -0.3;
const PATCH_END = 0.1;
const WETLAND_THRESHOLD = 0.34;
const GENTLEST_WETNESS_CURVE = 0.7;
const STEEPEST_WETNESS_CURVE = 2.4;
const WETNESS_SPREAD = 50;
const SMALLEST_WETLAND = 3000;
const POOL_SPAN = 24;
const POOL_THRESHOLD = 0.16;
const POOL_WETNESS = 0.5;

export interface WetlandInputs {
  coastDistance: Float32Array;
  desert: Float64Array;
  grid: WorldGrid;
  heights: Float32Array;
  lakeIds: Int32Array;
  riverStrength: Uint8Array;
  rivers: readonly River[];
  seed: number;
  waterSurface: Float32Array;
}

interface WaterReach {
  distance: Float32Array;
  level: Float32Array;
  span: Float32Array;
}

export function isStillWater(inputs: WetlandInputs, cell: number): boolean {
  if (!hasWater(inputs.waterSurface[cell], inputs.heights[cell])) {
    return false;
  }

  return inputs.lakeIds[cell] >= 0 || inputs.riverStrength[cell] === 0;
}

function emptyReach(cellCount: number): WaterReach {
  return {
    distance: new Float32Array(cellCount).fill(UNREACHED),
    level: new Float32Array(cellCount),
    span: new Float32Array(cellCount),
  };
}

function spreadReach(grid: WorldGrid, reach: WaterReach, queue: Int32Array, sourceCount: number): void {
  let head = 0;
  let tail = sourceCount;

  while (head < tail) {
    const cell = queue[head];

    head += 1;

    const next = reach.distance[cell] + grid.cellSize;

    if (next > reach.span[cell]) {
      continue;
    }

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (const [columnOffset, rowOffset] of ORTHOGONAL_STEPS) {
      if (!grid.contains(column + columnOffset, row + rowOffset)) {
        continue;
      }

      const neighbor = grid.index(column + columnOffset, row + rowOffset);

      if (reach.distance[neighbor] !== UNREACHED) {
        continue;
      }

      reach.distance[neighbor] = next;
      reach.level[neighbor] = reach.level[cell];
      reach.span[neighbor] = reach.span[cell];
      queue[tail] = neighbor;
      tail += 1;
    }
  }
}

function reachFrom(grid: WorldGrid, reach: WaterReach): WaterReach {
  const queue = new Int32Array(grid.cellCount);

  let sourceCount = 0;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (reach.span[cell] > 0) {
      reach.distance[cell] = 0;
      queue[sourceCount] = cell;
      sourceCount += 1;
    }
  }

  spreadReach(grid, reach, queue, sourceCount);

  return reach;
}

function lakeSources(inputs: WetlandInputs): WaterReach {
  const reach = emptyReach(inputs.grid.cellCount);

  for (let cell = 0; cell < inputs.grid.cellCount; cell += 1) {
    if (isStillWater(inputs, cell)) {
      reach.level[cell] = inputs.waterSurface[cell];
      reach.span[cell] = LAKE_REACH;
    }
  }

  return reach;
}

function riverGrade(points: readonly RiverPoint[], index: number): number {
  const upstream = points[Math.max(0, index - GRADE_WINDOW)];
  const downstream = points[Math.min(points.length - 1, index + GRADE_WINDOW)];

  const run = Math.hypot(upstream.x - downstream.x, upstream.z - downstream.z);

  if (run === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(upstream.surface - downstream.surface) / run;
}

function riverSources(inputs: WetlandInputs): WaterReach {
  const { coastDistance, grid, heights, waterSurface } = inputs;

  const reach = emptyReach(grid.cellCount);

  for (const { points } of inputs.rivers) {
    for (const [index, point] of points.entries()) {
      const cell = grid.cellAt(point.x, point.z);

      if (cell < 0 || !hasWater(waterSurface[cell], heights[cell])) {
        continue;
      }

      const slowness = 1 - FAST_RIVER_SHARE * smoothstep(SLOW_RIVER_GRADE, FAST_RIVER_GRADE, riverGrade(points, index));
      const delta = 1 + (DELTA_REACH - 1) * smoothstep(DELTA_DISTANCE, 0, coastDistance[cell]);
      const span = (RIVER_REACH + RIVER_REACH_PER_WIDTH * point.width) * delta * slowness;

      if (span > reach.span[cell]) {
        reach.level[cell] = point.surface;
        reach.span[cell] = span;
      }
    }
  }

  return reach;
}

function shoreWetness(reach: WaterReach, height: number, cell: number, highestRise: number): number {
  const distance = reach.distance[cell];

  if (distance === UNREACHED) {
    return 0;
  }

  const nearness = 1 - smoothstep(0.35, 1, distance / reach.span[cell]);
  const lowness = 1 - smoothstep(highestRise * 0.45, highestRise, height - reach.level[cell]);

  return nearness * lowness;
}

function basinDepths(inputs: WetlandInputs): Float32Array {
  const { grid, heights } = inputs;

  const radius = Math.max(1, Math.round(BASIN_RADIUS / grid.cellSize / 2));
  const surroundings = boxBlur(grid, boxBlur(grid, heights, radius), radius);

  return surroundings.map((surrounding, cell) => {
    return surrounding - heights[cell];
  });
}

export function measureWetness(inputs: WetlandInputs, slopes: Float64Array): Float32Array {
  const { coastDistance, desert, grid, heights, waterSurface } = inputs;

  const noise = createNoiseSampler(createRandom(inputs.seed * 17 + 11));
  const lakes = reachFrom(grid, lakeSources(inputs));
  const rivers = reachFrom(grid, riverSources(inputs));
  const basins = basinDepths(inputs);
  const wetness = new Float32Array(grid.cellCount);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const height = heights[cell];

    if (!isOnIsland(coastDistance, cell) || hasWater(waterSurface[cell], height) || desert[cell] > DRY_DESERT) {
      continue;
    }

    const slope = slopes[cell];
    const shore = Math.max(
      shoreWetness(lakes, height, cell, LAKE_RISE),
      shoreWetness(rivers, height, cell, RIVER_RISE)
    );
    const basin = smoothstep(BASIN_DEPTH_START, BASIN_DEPTH_END, basins[cell]);
    const dryness = 1 - smoothstep(LOWEST_DRY_DESERT, DRY_DESERT, desert[cell]);
    const lowland = 1 - smoothstep(HIGHEST_LOWLAND, HIGHEST_WETLAND, height);
    const patch = noise.fractal(grid.cellCenterX(cell) / PATCH_SPAN, grid.cellCenterZ(cell) / PATCH_SPAN, {
      octaves: 3,
    });

    const ground = Math.max(
      shore * (1 - smoothstep(FLAT_SHORE, STEEP_SHORE, slope)),
      basin * (1 - smoothstep(FLAT_BASIN, STEEP_BASIN, slope))
    );

    wetness[cell] = ground * dryness * lowland * smoothstep(PATCH_START, PATCH_END, patch);
  }

  const radius = Math.max(1, Math.round(WETNESS_SPREAD / grid.cellSize / 2));
  const spread = boxBlur(grid, boxBlur(grid, wetness, radius), radius);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (slopes[cell] > STEEPEST_WETLAND) {
      spread[cell] = 0;
    }
  }

  return spread;
}

export function matchWetlandShare(wetness: Float32Array, coastDistance: Float32Array, share: number): void {
  const wet = new Float32Array(wetness.length);

  let landCells = 0;
  let wetCells = 0;

  for (let cell = 0; cell < wetness.length; cell += 1) {
    if (!isOnIsland(coastDistance, cell)) {
      continue;
    }

    landCells += 1;

    if (wetness[cell] > 0) {
      wet[wetCells] = wetness[cell];
      wetCells += 1;
    }
  }

  const ascending = wet.subarray(0, wetCells).sort();
  const rank = Math.floor(share * landCells);
  const reference = rank < wetCells ? ascending[wetCells - 1 - rank] : undefined;
  const exponent = reference === undefined ? GENTLEST_WETNESS_CURVE : Math.log(WETLAND_THRESHOLD) / Math.log(reference);
  const clamped = clamp(exponent, GENTLEST_WETNESS_CURVE, STEEPEST_WETNESS_CURVE);

  for (let cell = 0; cell < wetness.length; cell += 1) {
    wetness[cell] **= clamped;
  }
}

export function isWetland(wetness: number): boolean {
  return wetness > WETLAND_THRESHOLD;
}

function collectArea(grid: WorldGrid, isMember: (cell: number) => boolean, start: number, seen: Uint8Array): number[] {
  const area = [start];

  seen[start] = 1;

  for (const cell of area) {
    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (const [columnOffset, rowOffset] of ORTHOGONAL_STEPS) {
      if (!grid.contains(column + columnOffset, row + rowOffset)) {
        continue;
      }

      const neighbor = grid.index(column + columnOffset, row + rowOffset);

      if (seen[neighbor] === 0 && isMember(neighbor)) {
        seen[neighbor] = 1;
        area.push(neighbor);
      }
    }
  }

  return area;
}

export function findSmallAreas(grid: WorldGrid, isMember: (cell: number) => boolean): number[] {
  const seen = new Uint8Array(grid.cellCount);
  const smallestCells = SMALLEST_WETLAND / (grid.cellSize * grid.cellSize);
  const small: number[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (seen[cell] === 1 || !isMember(cell)) {
      continue;
    }

    const area = collectArea(grid, isMember, cell, seen);

    if (area.length < smallestCells) {
      small.push(...area);
    }
  }

  return small;
}

function isInterior(grid: WorldGrid, cell: number, isMarsh: (cell: number) => boolean): boolean {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (!grid.contains(column + columnOffset, row + rowOffset)) {
        return false;
      }

      if (!isMarsh(grid.index(column + columnOffset, row + rowOffset))) {
        return false;
      }
    }
  }

  return true;
}

export function findPools(
  grid: WorldGrid,
  seed: number,
  wetness: Float32Array,
  isMarsh: (cell: number) => boolean
): number[] {
  const noise = createNoiseSampler(createRandom(seed * 19 + 7));
  const pools: number[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!(isMarsh(cell) && isInterior(grid, cell, isMarsh))) {
      continue;
    }

    const pattern = noise.fractal(grid.cellCenterX(cell) / POOL_SPAN, grid.cellCenterZ(cell) / POOL_SPAN, {
      octaves: 2,
    });
    const threshold = POOL_THRESHOLD + (1 - smoothstep(WETLAND_THRESHOLD, 1, wetness[cell])) * POOL_WETNESS;

    if (pattern > threshold) {
      pools.push(cell);
    }
  }

  return pools;
}
