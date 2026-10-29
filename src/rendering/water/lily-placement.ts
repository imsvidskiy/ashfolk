import { Biome } from "../../content/biomes.ts";
import { isPoolGround } from "../../content/grounds.ts";
import { FULL_TURN, hashToUnit, lerp } from "../../shared/math.ts";
import type { TerrainSnapshot } from "../../simulation/frame.ts";
import { isOnIsland } from "../../world/coast.ts";
import { hasWater } from "../../world/water.ts";
import type { WorldGrid } from "../../world/world-grid.ts";

export const SHALLOWEST_LILY_WATER = 0.15;
export const DEEPEST_LILY_WATER = 2.4;
export const MARSH_REACH_CELLS = 3;

const SALT_POOL = 3.17;
const SALT_SHORE = 5.31;
const SALT_CLUSTER = 7.43;
const SALT_PAD = 11.9;
const CLUSTER_CELLS = 4;
const POOL_CHANCE = 0.75;
const SHORE_CHANCE = 0.55;
const CLUSTER_CHANCE = 0.35;
const COLDEST_LILY = 4;
const LEAST_LILY_MOISTURE = 0.42;
const POOL_PADS = 7;
const SHORE_PADS = 9;
const POOL_SPREAD = 0.16;
const SHORE_SPREAD = 0.48;
const SMALLEST_PAD = 0.35;
const LARGEST_PAD = 0.7;
const FLOWER_SHARE = 0.2;
const PINK_SHARE = 0.35;

export interface LilyWorld {
  readonly grid: WorldGrid;
  readonly terrain: Pick<
    TerrainSnapshot,
    "baseTemperature" | "biome" | "coastDistance" | "ground" | "height" | "moisture" | "riverStrength" | "waterSurface"
  >;
}

export interface LilyPlacements {
  readonly flowers: number[];
  readonly pads: number[];
}

interface LilyCell {
  readonly cell: number;
  readonly isPool: boolean;
}

function isNearMarsh(world: LilyWorld, cell: number): boolean {
  const { grid, terrain } = world;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  for (let rowOffset = -MARSH_REACH_CELLS; rowOffset <= MARSH_REACH_CELLS; rowOffset += 1) {
    for (let columnOffset = -MARSH_REACH_CELLS; columnOffset <= MARSH_REACH_CELLS; columnOffset += 1) {
      const isInside = grid.contains(column + columnOffset, row + rowOffset);

      if (isInside && terrain.biome[grid.index(column + columnOffset, row + rowOffset)] === Biome.Swamp) {
        return true;
      }
    }
  }

  return false;
}

function isLilyShore(world: LilyWorld, cell: number): boolean {
  const { grid, terrain } = world;

  const depth = terrain.waterSurface[cell] - terrain.height[cell];

  if (!hasWater(terrain.waterSurface[cell], terrain.height[cell]) || terrain.riverStrength[cell] !== 0) {
    return false;
  }

  if (depth < SHALLOWEST_LILY_WATER || depth > DEEPEST_LILY_WATER) {
    return false;
  }

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const cluster = hashToUnit(Math.floor(column / CLUSTER_CELLS), Math.floor(row / CLUSTER_CELLS), SALT_CLUSTER);

  return cluster < CLUSTER_CHANCE && isNearMarsh(world, cell);
}

function canHoldLilies(world: LilyWorld, cell: number): boolean {
  const { terrain } = world;

  if (!isOnIsland(terrain.coastDistance, cell) || terrain.moisture[cell] < LEAST_LILY_MOISTURE) {
    return false;
  }

  return terrain.baseTemperature[cell] > COLDEST_LILY;
}

function scatter(placements: LilyPlacements, grid: WorldGrid, lily: LilyCell): void {
  const { cell, isPool } = lily;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const count = isPool ? POOL_PADS : SHORE_PADS;
  const spread = isPool ? POOL_SPREAD : SHORE_SPREAD;

  for (let pad = 0; pad < count; pad += 1) {
    const salt = SALT_PAD + pad * 4;
    const angle = hashToUnit(column, row, salt) * FULL_TURN;
    const reach = Math.sqrt(hashToUnit(column, row, salt + 1)) * spread * grid.cellSize;
    const size = lerp(SMALLEST_PAD, LARGEST_PAD, hashToUnit(column, row, salt + 2));
    const look = hashToUnit(column, row, salt + 3);

    const x = grid.cellCenterX(cell) + Math.cos(angle) * reach;
    const z = grid.cellCenterZ(cell) + Math.sin(angle) * reach;
    const turn = look * FULL_TURN * 7;

    placements.pads.push(x, z, turn, size);

    if (look < FLOWER_SHARE) {
      placements.flowers.push(x, z, turn, look < FLOWER_SHARE * PINK_SHARE ? -size : size);
    }
  }
}

export function lilyCells(world: LilyWorld): LilyCell[] {
  const { grid, terrain } = world;

  const cells: LilyCell[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!canHoldLilies(world, cell)) {
      continue;
    }

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    if (isPoolGround(terrain.ground[cell])) {
      if (hashToUnit(column, row, SALT_POOL) < POOL_CHANCE) {
        cells.push({ cell, isPool: true });
      }

      continue;
    }

    if (isLilyShore(world, cell) && hashToUnit(column, row, SALT_SHORE) < SHORE_CHANCE) {
      cells.push({ cell, isPool: false });
    }
  }

  return cells;
}

export function placeLilies(world: LilyWorld): LilyPlacements {
  const placements: LilyPlacements = { flowers: [], pads: [] };

  for (const lily of lilyCells(world)) {
    scatter(placements, world.grid, lily);
  }

  return placements;
}
