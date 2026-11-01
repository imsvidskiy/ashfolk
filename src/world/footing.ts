import { isPoolGround } from "../content/grounds.ts";
import { plantSpeciesDefinition, woodlandShare } from "../content/plants.ts";
import { hashToUnit } from "../shared/math.ts";
import { hasRoomFromCoast, isOnIsland } from "./coast.ts";
import { isWaterCell, type SampledTerrain, touchesWaterCell } from "./terrain-sampling.ts";
import type { WorldGrid } from "./world-grid.ts";

export const CELL_STAND_INSET = 0.5;

const WALKABLE_SLOPE = 1.15;
const STAND_SALT = 19.19;

export interface FootingTerrain extends SampledTerrain {
  readonly coastDistance: Float32Array;
  readonly ground: Uint8Array;
}

interface WildTerrain extends FootingTerrain {
  readonly woodland: Float32Array;
}

function gradientX(heights: Float32Array, grid: WorldGrid, column: number, row: number): number {
  const last = grid.cellsPerSide - 1;

  const east = heights[grid.index(Math.min(last, column + 1), row)];
  const west = heights[grid.index(Math.max(0, column - 1), row)];

  return (east - west) / (2 * grid.cellSize);
}

function gradientZ(heights: Float32Array, grid: WorldGrid, column: number, row: number): number {
  const last = grid.cellsPerSide - 1;

  const south = heights[grid.index(column, Math.min(last, row + 1))];
  const north = heights[grid.index(column, Math.max(0, row - 1))];

  return (south - north) / (2 * grid.cellSize);
}

export function gradientXAt(heights: Float32Array, grid: WorldGrid, cell: number): number {
  return gradientX(heights, grid, grid.columnOf(cell), grid.rowOf(cell));
}

export function gradientZAt(heights: Float32Array, grid: WorldGrid, cell: number): number {
  return gradientZ(heights, grid, grid.columnOf(cell), grid.rowOf(cell));
}

export function slopeAt(heights: Float32Array, grid: WorldGrid, cell: number): number {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  return Math.hypot(gradientX(heights, grid, column, row), gradientZ(heights, grid, column, row));
}

export function isWalkableGround(terrain: FootingTerrain, grid: WorldGrid, cell: number): boolean {
  if (!isOnIsland(terrain.coastDistance, cell) || isWaterCell(terrain, cell)) {
    return false;
  }

  return slopeAt(terrain.height, grid, cell) < WALKABLE_SLOPE;
}

export function isOpenGround(terrain: FootingTerrain, grid: WorldGrid, cell: number): boolean {
  if (!isOnIsland(terrain.coastDistance, cell) || grid.isOnEdge(cell) || isPoolGround(terrain.ground[cell])) {
    return false;
  }

  return !touchesWaterCell(terrain, grid, cell);
}

export function canStandOn(terrain: FootingTerrain, grid: WorldGrid, cell: number, steepestSlope: number): boolean {
  return isOpenGround(terrain, grid, cell) && slopeAt(terrain.height, grid, cell) <= steepestSlope;
}

export function admitsWildPlant(terrain: WildTerrain, grid: WorldGrid, cell: number, species: number): boolean {
  const share = woodlandShare(species, terrain.woodland[cell]);

  return hashToUnit(grid.columnOf(cell), grid.rowOf(cell), STAND_SALT) < share;
}

export function canGrowWild(terrain: WildTerrain, grid: WorldGrid, cell: number, species: number): boolean {
  const { steepestSlope } = plantSpeciesDefinition(species);

  return canStandOn(terrain, grid, cell, steepestSlope) && admitsWildPlant(terrain, grid, cell, species);
}

export function hasRoomToGrow(terrain: WildTerrain, grid: WorldGrid, x: number, z: number, species: number): boolean {
  const cell = grid.cellAt(x, z);

  return canGrowWild(terrain, grid, cell, species) && hasRoomFromCoast(terrain.coastDistance, grid, x, z);
}
