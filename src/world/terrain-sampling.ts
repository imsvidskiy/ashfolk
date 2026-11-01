import { clamp } from "../shared/math.ts";
import { hasWater, NO_WATER } from "./water.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "./world-grid.ts";

export interface SampledTerrain {
  readonly height: Float32Array;
  readonly waterSurface: Float32Array;
}

export interface RiverTerrain extends SampledTerrain {
  readonly riverStrength: Uint8Array;
}

interface CellLookup {
  amountX: number;
  amountZ: number;
  column: number;
  row: number;
}

const lookup: CellLookup = { amountX: 0, amountZ: 0, column: 0, row: 0 };

export function lookUpCell(grid: WorldGrid, x: number, z: number): CellLookup {
  const { cellsPerSide, cellSize, halfSize } = grid;

  const gridX = clamp((x + halfSize) / cellSize - 0.5, 0, cellsPerSide - 1.001);
  const gridZ = clamp((z + halfSize) / cellSize - 0.5, 0, cellsPerSide - 1.001);

  lookup.column = Math.floor(gridX);
  lookup.row = Math.floor(gridZ);
  lookup.amountX = gridX - lookup.column;
  lookup.amountZ = gridZ - lookup.row;

  return lookup;
}

export function sampleCells(
  values: Float32Array,
  grid: WorldGrid,
  x: number,
  z: number,
  stride: number,
  channel: number
): number {
  const { amountX, amountZ, column, row } = lookUpCell(grid, x, z);

  const first = grid.index(column, row) * stride + channel;
  const below = first + grid.cellsPerSide * stride;

  const near = values[first] * (1 - amountX) + values[first + stride] * amountX;
  const far = values[below] * (1 - amountX) + values[below + stride] * amountX;

  return near * (1 - amountZ) + far * amountZ;
}

export function sampleHeight(heights: Float32Array, grid: WorldGrid, x: number, z: number): number {
  return sampleCells(heights, grid, x, z, 1, 0);
}

export function sampleSurface(terrain: SampledTerrain, grid: WorldGrid, x: number, z: number): number {
  const ground = sampleHeight(terrain.height, grid, x, z);
  const cell = grid.cellAt(x, z);

  if (cell < 0) {
    return ground;
  }

  const waterSurface = terrain.waterSurface[cell];

  if (waterSurface === NO_WATER || waterSurface <= ground) {
    return ground;
  }

  return waterSurface;
}

export function isWaterCell(terrain: SampledTerrain, cell: number): boolean {
  return hasWater(terrain.waterSurface[cell], terrain.height[cell]);
}

export function isRiverWater(terrain: RiverTerrain, cell: number): boolean {
  return terrain.riverStrength[cell] > 0 && isWaterCell(terrain, cell);
}

export function isStandingWater(terrain: RiverTerrain, cell: number): boolean {
  return terrain.riverStrength[cell] === 0 && isWaterCell(terrain, cell);
}

export function isWaterAtPoint(terrain: SampledTerrain, grid: WorldGrid, x: number, z: number): boolean {
  const cell = grid.cellAt(x, z);

  if (cell < 0) {
    return false;
  }

  return isWaterCell(terrain, cell);
}

export function sampleWaterLevel(terrain: SampledTerrain, grid: WorldGrid, x: number, z: number): number {
  if (!isWaterAtPoint(terrain, grid, x, z)) {
    return NO_WATER;
  }

  const { amountX, amountZ, column, row } = lookUpCell(grid, x, z);

  const cell = grid.index(column, row);
  const below = cell + grid.cellsPerSide;

  let level = 0;
  let weight = 0;

  function addCorner(corner: number, cornerWeight: number): void {
    if (isWaterCell(terrain, corner)) {
      level += terrain.waterSurface[corner] * cornerWeight;
      weight += cornerWeight;
    }
  }

  addCorner(cell, (1 - amountX) * (1 - amountZ));
  addCorner(cell + 1, amountX * (1 - amountZ));
  addCorner(below, (1 - amountX) * amountZ);
  addCorner(below + 1, amountX * amountZ);

  return weight > 0 ? level / weight : NO_WATER;
}

export function touchesWaterCell(terrain: SampledTerrain, grid: WorldGrid, cell: number): boolean {
  if (isWaterCell(terrain, cell)) {
    return true;
  }

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighbor = grid.neighborIndex(column, row, offset);

    if (neighbor >= 0 && isWaterCell(terrain, neighbor)) {
      return true;
    }
  }

  return false;
}
