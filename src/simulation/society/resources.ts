import { Ground } from "../../content/grounds.ts";
import { distanceSquared, FULL_TURN } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { ORTHOGONAL_STEPS } from "../../world/world-grid.ts";
import type { Waypoint } from "../agents/navigation.ts";
import type { WorldState } from "../world/world-state.ts";

export const HOT_GROUND = 0.03;
const QUARRY_SLOPE = 0.9;
const CLIFF_SLOPE = 1.1;
const FISHING_DEPTH = 0.6;
const SHORE_ATTEMPTS = 40;
const CLOSEST_SHORE = 20;

interface PlantSearch {
  accepts: (plant: number) => boolean;
  radius: number;
  x: number;
  z: number;
}

export interface ShoreSpot {
  waterX: number;
  waterZ: number;
  x: number;
  z: number;
}

interface NearestPlant {
  distanceSquared: number;
  plant: number;
}

export function nearestPlant(world: WorldState, search: PlantSearch): number | null {
  const { cellSize } = world.grid;

  const ringCount = Math.ceil(search.radius / cellSize);

  const nearest: NearestPlant = { distanceSquared: search.radius * search.radius, plant: NO_PLANT };

  for (let ring = 0; ring <= ringCount; ring += 1) {
    if (nearest.plant !== NO_PLANT && (ring - 1) * cellSize > Math.sqrt(nearest.distanceSquared)) {
      break;
    }

    searchRing(world, search, ring, nearest);
  }

  if (nearest.plant === NO_PLANT) {
    return null;
  }

  return nearest.plant;
}

function searchRing(world: WorldState, search: PlantSearch, ring: number, nearest: NearestPlant): void {
  const { grid } = world;

  const centerColumn = grid.columnAt(search.x);
  const centerRow = grid.rowAt(search.z);

  for (let rowOffset = -ring; rowOffset <= ring; rowOffset += 1) {
    const columnStep = Math.abs(rowOffset) === ring ? 1 : 2 * ring;

    for (let columnOffset = -ring; columnOffset <= ring; columnOffset += columnStep) {
      const column = centerColumn + columnOffset;
      const row = centerRow + rowOffset;

      if (grid.contains(column, row)) {
        searchCell(world, grid.index(column, row), search, nearest);
      }
    }
  }
}

function searchCell(world: WorldState, cell: number, search: PlantSearch, nearest: NearestPlant): void {
  const { fields, vegetation } = world;

  if (fields.fire[cell] > 0 || fields.heat[cell] > HOT_GROUND || world.isWater(cell)) {
    return;
  }

  for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
    const squaredDistance = distanceSquared(search.x, search.z, vegetation.x[plant], vegetation.z[plant]);

    if (squaredDistance < nearest.distanceSquared && search.accepts(plant)) {
      nearest.distanceSquared = squaredDistance;
      nearest.plant = plant;
    }
  }
}

export function nearestQuarry(world: WorldState, x: number, z: number, radius: number): Waypoint | null {
  const { grid } = world;

  const centerColumn = grid.columnAt(x);
  const centerRow = grid.rowAt(z);

  const ringCount = Math.ceil(radius / grid.cellSize);

  for (let ring = 2; ring <= ringCount; ring += 2) {
    for (let step = 0; step < ring * 4; step += 1) {
      const angle = (step / (ring * 4)) * FULL_TURN;

      const column = centerColumn + Math.round(Math.cos(angle) * ring);
      const row = centerRow + Math.round(Math.sin(angle) * ring);

      if (isQuarry(world, column, row)) {
        return { x: grid.centerX(column), z: grid.centerZ(row) };
      }
    }
  }

  return null;
}

function isQuarry(world: WorldState, column: number, row: number): boolean {
  const { grid } = world;

  if (column < 1 || row < 1 || column >= grid.cellsPerSide - 1 || row >= grid.cellsPerSide - 1) {
    return false;
  }

  const cell = grid.index(column, row);

  if (world.isWater(cell) || world.slope(cell) > QUARRY_SLOPE) {
    return false;
  }

  const ground = world.terrain.ground[cell];

  if (ground === Ground.Rock || ground === Ground.RedRock) {
    return true;
  }

  return ORTHOGONAL_STEPS.some(([columnStep, rowStep]) => {
    return world.slope(grid.index(column + columnStep, row + rowStep)) > CLIFF_SLOPE;
  });
}

export function nearestShore(
  world: WorldState,
  origin: Waypoint,
  radius: number,
  random: RandomSource,
  accepts: (spot: ShoreSpot) => boolean
): ShoreSpot | null {
  for (let attempt = 0; attempt < SHORE_ATTEMPTS; attempt += 1) {
    const angle = random.next() * FULL_TURN;
    const distance = CLOSEST_SHORE + random.next() * radius;

    const spot = shoreSpotAt(world, origin.x + Math.cos(angle) * distance, origin.z + Math.sin(angle) * distance);

    if (spot !== null && accepts(spot)) {
      return spot;
    }
  }

  return null;
}

function shoreSpotAt(world: WorldState, x: number, z: number): ShoreSpot | null {
  const { grid } = world;

  const cell = grid.cellAt(x, z);

  if (cell < 0 || !world.isWalkable(cell)) {
    return null;
  }

  const cellColumn = grid.columnOf(cell);
  const cellRow = grid.rowOf(cell);

  for (const [columnStep, rowStep] of ORTHOGONAL_STEPS) {
    const column = cellColumn + columnStep;
    const row = cellRow + rowStep;

    if (isFishingWater(world, column, row)) {
      return {
        waterX: grid.centerX(column),
        waterZ: grid.centerZ(row),
        x: grid.cellCenterX(cell),
        z: grid.cellCenterZ(cell),
      };
    }
  }

  return null;
}

function isFishingWater(world: WorldState, column: number, row: number): boolean {
  if (!world.grid.contains(column, row)) {
    return false;
  }

  const cell = world.grid.index(column, row);

  return world.isWater(cell) && world.waterDepth(cell) > FISHING_DEPTH;
}
