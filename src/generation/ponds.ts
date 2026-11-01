import { lerp, smoothstep } from "../shared/math.ts";
import { hasWater, POND_SHORE_SLOPE, pondEdgeReach, pondOutlineExtent, type Spring } from "../world/water.ts";
import type { WorldGrid } from "../world/world-grid.ts";

const DEEPEST_POND = 4.5;
const STRAND_HEIGHT = 0.2;
const STRAND_WIDTH = 15;
const BEACH_WIDTH = 12;
const DEEPEST_SHORE_CUT = 12;
const WET_REACH = 0.75;
const SHORE_CELLS = 0.5;
const LOWEST_RIM = 1.5;
const LOWEST_OUTLET_RIM = 4;
const RIM_CELLS = 1;
const OUTLET_SECTOR = 0.7;
const BANK_CELLS = 1.5;

interface PondTargets {
  readonly grid: WorldGrid;
  readonly heights: Float32Array;
  readonly riverStrength: Uint8Array;
  readonly uncarvedHeights: Float32Array;
  readonly waterSurface: Float32Array;
}

function isAtOutlet(pond: Spring, x: number, z: number): boolean {
  const distance = Math.max(1e-3, Math.hypot(x - pond.x, z - pond.z));

  return (pond.directionX * (x - pond.x) + pond.directionZ * (z - pond.z)) / distance > OUTLET_SECTOR;
}

function highestCuttableRise(reach: number): number {
  if (reach <= 0) {
    return STRAND_HEIGHT + DEEPEST_SHORE_CUT;
  }

  return DEEPEST_SHORE_CUT - Math.min(DEEPEST_POND, reach * POND_SHORE_SLOPE);
}

export function pondFits(grid: WorldGrid, heights: Float32Array, pond: Spring): boolean {
  const shoreReach = grid.cellSize * SHORE_CELLS;

  for (const cell of grid.cellsInRadius(pond.x, pond.z, pondOutlineExtent(pond) + shoreReach)) {
    const x = grid.cellCenterX(cell);
    const z = grid.cellCenterZ(cell);

    const reach = pondEdgeReach(pond, x, z);
    const rise = heights[cell] - pond.level;
    const isRim = reach < 0 && reach > -grid.cellSize * RIM_CELLS;

    if (reach > -shoreReach && rise > highestCuttableRise(reach)) {
      return false;
    }

    if (isRim && rise < -LOWEST_RIM && !isAtOutlet(pond, x, z)) {
      return false;
    }
  }

  return true;
}

export function pondCut(grid: WorldGrid, heights: Float32Array, pond: Spring): number {
  let cut = 0;

  for (const cell of grid.cellsInRadius(pond.x, pond.z, pondOutlineExtent(pond))) {
    if (pondEdgeReach(pond, grid.cellCenterX(cell), grid.cellCenterZ(cell)) > 0) {
      cut += Math.max(0, heights[cell] - pond.level);
    }
  }

  return cut;
}

export function isRiverWater(
  targets: Pick<PondTargets, "heights" | "riverStrength" | "waterSurface">,
  cell: number
): boolean {
  return targets.riverStrength[cell] > 0 && hasWater(targets.waterSurface[cell], targets.heights[cell]);
}

function fillPondCell(targets: PondTargets, pond: Spring, cell: number, reach: number): void {
  const { heights, riverStrength, uncarvedHeights, waterSurface } = targets;

  const bed = pond.level - Math.min(DEEPEST_POND, reach * POND_SHORE_SLOPE);

  heights[cell] = Math.min(heights[cell], Math.max(bed, uncarvedHeights[cell] - DEEPEST_SHORE_CUT));

  if (!hasWater(pond.level, heights[cell])) {
    return;
  }

  waterSurface[cell] = pond.level;
  riverStrength[cell] = 0;
}

function shapeShore(targets: PondTargets, pond: Spring, cell: number, reach: number): void {
  const { grid, heights, riverStrength, uncarvedHeights } = targets;

  if (isRiverWater(targets, cell)) {
    return;
  }

  const rise = smoothstep(STRAND_WIDTH, STRAND_WIDTH + BEACH_WIDTH, -reach);

  const beach = lerp(pond.level + STRAND_HEIGHT, uncarvedHeights[cell], rise);
  const deepest = uncarvedHeights[cell] - DEEPEST_SHORE_CUT * (1 - rise);

  heights[cell] = Math.min(heights[cell], Math.max(beach, deepest));

  if (reach <= -grid.cellSize * BANK_CELLS || riverStrength[cell] !== 0) {
    return;
  }

  const raise = isAtOutlet(pond, grid.cellCenterX(cell), grid.cellCenterZ(cell)) ? LOWEST_OUTLET_RIM : LOWEST_RIM;
  const bank = Math.min(pond.level, uncarvedHeights[cell] + raise) + STRAND_HEIGHT;

  heights[cell] = Math.max(heights[cell], bank);
}

export function pondShoreReach(pond: Spring): number {
  return pondOutlineExtent(pond) + STRAND_WIDTH + BEACH_WIDTH;
}

export function carvePond(targets: PondTargets, pond: Spring): void {
  const { grid } = targets;

  const wetReach = grid.cellSize * WET_REACH;

  for (const cell of grid.cellsInRadius(pond.x, pond.z, pondShoreReach(pond))) {
    const x = grid.cellCenterX(cell);
    const z = grid.cellCenterZ(cell);

    const reach = Math.max(pondEdgeReach(pond, x, z), wetReach - Math.hypot(x - pond.x, z - pond.z));

    if (reach > 0) {
      fillPondCell(targets, pond, cell, reach);

      continue;
    }

    shapeShore(targets, pond, cell, reach);
  }
}
