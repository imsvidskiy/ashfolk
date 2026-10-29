import { clamp } from "../../shared/math.ts";
import { lookUpCell, type SampledTerrain } from "../../world/terrain-sampling.ts";
import { NO_WATER } from "../../world/water.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { BANK_SINK, BANK_STEP, PRESENT_LEVEL } from "./shore-field.ts";

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

  return levels.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.min(Math.max(...levels), Math.min(...levels) + BANK_STEP);
}

export function waterVertexLevel(terrain: SampledTerrain, grid: WorldGrid, column: number, row: number): number {
  const own = levelAt(terrain, grid, column, row);

  if (own > PRESENT_LEVEL) {
    return own;
  }

  const beside = bankLevel(terrain, grid, column, row, BESIDE);
  const nearest = Number.isFinite(beside) ? beside : bankLevel(terrain, grid, column, row, DIAGONAL);

  if (!Number.isFinite(nearest)) {
    return NO_WATER;
  }

  return Math.min(nearest, terrain.height[grid.index(column, row)] - BANK_SINK);
}

export function sampleWaterSurface(terrain: SampledTerrain, grid: WorldGrid, x: number, z: number): number {
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
