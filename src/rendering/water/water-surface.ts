import { clamp } from "../../shared/math.ts";
import { isStandingWater, lookUpCell, type RiverTerrain, type SampledTerrain } from "../../world/terrain-sampling.ts";
import { NO_WATER } from "../../world/water.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { BANK_SINK, PRESENT_LEVEL, RIVER_BANK_LIFT } from "./shore-field.ts";

const BESIDE = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const DIAGONAL = [
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
] as const;

function levelAt(terrain: SampledTerrain, grid: WorldGrid, column: number, row: number): number {
  const last = grid.cellsPerSide - 1;

  return terrain.waterSurface[grid.index(clamp(column, 0, last), clamp(row, 0, last))];
}

function bankLevel(
  terrain: SampledTerrain,
  grid: WorldGrid,
  column: number,
  row: number,
  offsets: readonly (readonly [number, number])[]
): number {
  const levels = offsets
    .map(([columnOffset, rowOffset]) => {
      return levelAt(terrain, grid, column + columnOffset, row + rowOffset);
    })
    .filter((level) => {
      return level > PRESENT_LEVEL;
    });

  if (levels.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    levels.reduce((total, level) => {
      return total + level;
    }, 0) / levels.length
  );
}

function isNearStandingWater(terrain: RiverTerrain, grid: WorldGrid, column: number, row: number): boolean {
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (!grid.contains(column + columnOffset, row + rowOffset)) {
        continue;
      }

      const cell = grid.index(column + columnOffset, row + rowOffset);

      if (isStandingWater(terrain, cell)) {
        return true;
      }
    }
  }

  return false;
}

export function waterVertexLevel(terrain: RiverTerrain, grid: WorldGrid, column: number, row: number): number {
  const own = levelAt(terrain, grid, column, row);

  if (own > PRESENT_LEVEL) {
    return own;
  }

  const beside = bankLevel(terrain, grid, column, row, BESIDE);
  const nearest = Number.isFinite(beside) ? beside : bankLevel(terrain, grid, column, row, DIAGONAL);

  if (!Number.isFinite(nearest)) {
    return NO_WATER;
  }

  const ground = terrain.height[grid.index(column, row)];

  if (isNearStandingWater(terrain, grid, column, row)) {
    return Math.min(nearest, ground - BANK_SINK);
  }

  return Math.max(nearest, ground + RIVER_BANK_LIFT);
}

export function sampleWaterSurface(terrain: RiverTerrain, grid: WorldGrid, x: number, z: number): number {
  const { amountX, amountZ, column, row } = lookUpCell(grid, x, z);

  const corners = [
    waterVertexLevel(terrain, grid, column, row),
    waterVertexLevel(terrain, grid, column + 1, row),
    waterVertexLevel(terrain, grid, column, row + 1),
    waterVertexLevel(terrain, grid, column + 1, row + 1),
  ];

  if (
    corners.some((level) => {
      return level === NO_WATER;
    })
  ) {
    return NO_WATER;
  }

  const [first, right, below, diagonal] = corners;

  const near = first * (1 - amountX) + right * amountX;
  const far = below * (1 - amountX) + diagonal * amountX;

  return near * (1 - amountZ) + far * amountZ;
}
