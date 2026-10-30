import { isOnIsland } from "../../world/coast.ts";
import type { TerrainData } from "../../world/terrain-data.ts";
import { hasWater, NO_WATER, type River, type RiverPoint } from "../../world/water.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import type { GeneratedWorld } from "../world-generator.ts";

export const JUNCTION_CELLS = 1.5;

const LAKE_REACH = 20;

export function isRiverWater(terrain: TerrainData, cell: number): boolean {
  return terrain.riverStrength[cell] > 0 && hasWater(terrain.waterSurface[cell], terrain.height[cell]);
}

export function isLakeWater(terrain: TerrainData, cell: number): boolean {
  return terrain.riverStrength[cell] === 0 && hasWater(terrain.waterSurface[cell], terrain.height[cell]);
}

export function riverPathCells(grid: WorldGrid, river: River): number[] {
  const cells: number[] = [];

  for (const point of river.points) {
    const cell = grid.cellAt(point.x, point.z);

    if (cell !== cells.at(-1)) {
      cells.push(cell);
    }
  }

  return cells;
}

export function riverEnd(river: River): RiverPoint {
  const end = river.points.at(-1);

  if (end === undefined) {
    throw new Error(`River ${river.id} has no points`);
  }

  return end;
}

export function isNear(point: RiverPoint, other: RiverPoint, reach: number): boolean {
  return Math.hypot(point.x - other.x, point.z - other.z) < reach;
}

export function joinsRiver(tributary: River, main: River, reach: number): boolean {
  const end = riverEnd(tributary);

  return main.points.some((point) => {
    return isNear(point, end, reach);
  });
}

export function lakeCellsNear(generated: GeneratedWorld, point: RiverPoint): number[] {
  const grid = new WorldGrid(generated.dimensions);

  return grid.cellsInRadius(point.x, point.z, LAKE_REACH).filter((cell) => {
    return isLakeWater(generated.terrain, cell);
  });
}

function isAtLake(generated: GeneratedWorld, point: RiverPoint): boolean {
  return lakeCellsNear(generated, point).length > 0;
}

function isCoastTaken(terrain: TerrainData, grid: WorldGrid, cell: number): boolean {
  return grid
    .cellsInRadius(grid.cellCenterX(cell), grid.cellCenterZ(cell), grid.cellSize * 1.5)
    .filter((neighbor) => {
      return !isOnIsland(terrain.coastDistance, neighbor);
    })
    .every((neighbor) => {
      return terrain.waterSurface[neighbor] !== NO_WATER;
    });
}

function reachesPastCoast(generated: GeneratedWorld, grid: WorldGrid, mouth: number): boolean {
  const { terrain } = generated;

  if (generated.shape === "square") {
    return grid.isOnEdge(mouth);
  }

  return !isOnIsland(terrain.coastDistance, mouth) || isCoastTaken(terrain, grid, mouth);
}

export function riverFaults(generated: GeneratedWorld): string[] {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const faults: string[] = [];

  for (const river of generated.water.rivers) {
    let level = Number.POSITIVE_INFINITY;

    for (const cell of riverPathCells(grid, river)) {
      const where = `river ${river.id} at ${grid.cellCenterX(cell)}, ${grid.cellCenterZ(cell)}`;

      if (isLakeWater(terrain, cell)) {
        continue;
      }

      if (!isRiverWater(terrain, cell)) {
        faults.push(`${where} runs dry`);

        continue;
      }

      if (terrain.waterSurface[cell] > level + 1e-3) {
        faults.push(`${where} rises by ${(terrain.waterSurface[cell] - level).toFixed(2)}`);
      }

      level = Math.min(level, terrain.waterSurface[cell]);
    }
  }

  return faults;
}

export function mouthFaults(generated: GeneratedWorld): string[] {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const faults: string[] = [];

  for (const river of generated.water.rivers.filter((candidate) => {
    return candidate.reachesEdge;
  })) {
    const mouth = riverPathCells(grid, river).at(-1);
    const end = river.points.at(-1);

    if (mouth === undefined || end === undefined) {
      continue;
    }

    const isPastCoast = reachesPastCoast(generated, grid, mouth);
    const waterfall = generated.water.waterfalls.find((candidate) => {
      return candidate.x === end.x && candidate.z === end.z;
    });

    if (!isPastCoast) {
      faults.push(`river ${river.id} ends inland at ${grid.cellCenterX(mouth)}, ${grid.cellCenterZ(mouth)}`);
    }

    if (waterfall === undefined || Math.abs(waterfall.top - terrain.waterSurface[mouth]) > 0.1) {
      faults.push(`river ${river.id} does not meet its waterfall`);
    }
  }

  return faults;
}

export function endsAwayFromWater(generated: GeneratedWorld): string[] {
  const { cellSize } = generated.dimensions;
  const { rivers } = generated.water;

  return rivers
    .filter((river) => {
      const end = riverEnd(river);

      const joins = rivers.some((other) => {
        return other !== river && joinsRiver(river, other, cellSize * JUNCTION_CELLS);
      });

      return !(river.reachesEdge || joins || isAtLake(generated, end));
    })
    .map((river) => {
      const end = riverEnd(river);

      return `river ${river.id} ends at ${Math.round(end.x)}, ${Math.round(end.z)}`;
    });
}
