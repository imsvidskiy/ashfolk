import { clamp } from "../shared/math.ts";
import { type RandomSource, shuffle } from "../shared/random.ts";
import { countForArea } from "../world/island-size.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import { analyzeDrainage, DEFAULT_HYDROLOGY, type DrainageBasins, NO_CELL } from "./hydrology.ts";

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

interface Pond {
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

function isClearOf(grid: WorldGrid, cell: number, ponds: readonly Pond[]): boolean {
  const x = grid.cellCenterX(cell);
  const z = grid.cellCenterZ(cell);

  return ponds.every((pond) => {
    return Math.hypot(pond.x - x, pond.z - z) > pond.radius;
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
  const ponds: Pond[] = basins.lakes.map((lake) => {
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

    if (!isClearOf(grid, cell, ponds) || siting.boundaryDistance(cell) <= NEAREST_BOUNDARY) {
      continue;
    }

    const slope = riverSlope(basins, heights, grid, cell);

    if (slope < STEEPEST_RIVER) {
      sites.push({ cell, riverSlope: slope });
      ponds.push({ radius: SITE_SEPARATION, x: grid.cellCenterX(cell), z: grid.cellCenterZ(cell) });
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
): void {
  const { lakeIds, network } = analyzeDrainage(heights, grid, dryness, coastDistance);

  for (const [cell, level] of network.filled.entries()) {
    if (lakeIds[cell] === NO_CELL) {
      heights[cell] = Math.max(heights[cell], level);
    }
  }
}
