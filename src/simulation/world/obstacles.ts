import { isRockSpecies, isTreeSpecies, PLANT_SPECIES } from "../../content/plants.ts";
import { distanceSquared } from "../../shared/math.ts";
import { NO_PLANT, PlantState, type VegetationStore } from "../../world/vegetation-store.ts";
import type { WorldGrid } from "../../world/world-grid.ts";

const LARGEST_PLANT_RADIUS = 5;
const SMALLEST_OBSTACLE = 0.15;

const BLOCKING_RADIUS_PER_METER = PLANT_SPECIES.map((species) => {
  if (isTreeSpecies(species.index) || isRockSpecies(species.index)) {
    return species.radiusPerMeter;
  }

  return 0;
});

export interface Obstacle {
  readonly radius: number;
  readonly x: number;
  readonly z: number;
}

function isStanding(vegetation: VegetationStore, plant: number): boolean {
  const state = vegetation.state[plant];

  return state === PlantState.Alive || state === PlantState.Burnt;
}

function isWithin(obstacle: Obstacle, x: number, z: number, reach: number): boolean {
  const distance = reach + obstacle.radius;

  return distanceSquared(obstacle.x, obstacle.z, x, z) < distance * distance;
}

export class ObstacleMap {
  readonly #buildings = new Map<number, Obstacle>();
  readonly #grid: WorldGrid;
  readonly #vegetation: VegetationStore;

  constructor(grid: WorldGrid, vegetation: VegetationStore) {
    this.#grid = grid;
    this.#vegetation = vegetation;
  }

  placeBuilding(id: number, obstacle: Obstacle): void {
    if (obstacle.radius <= 0) {
      return;
    }

    this.#buildings.set(id, obstacle);
  }

  clearBuilding(id: number): void {
    this.#buildings.delete(id);
  }

  near(x: number, z: number, reach: number): Obstacle[] {
    const obstacles: Obstacle[] = [];

    for (const building of this.#buildings.values()) {
      if (isWithin(building, x, z, reach)) {
        obstacles.push(building);
      }
    }

    const around: Obstacle = { radius: reach, x, z };
    const bounds = this.#grid.circleBounds(x, z, reach + LARGEST_PLANT_RADIUS);

    for (let row = bounds.firstRow; row <= bounds.lastRow; row += 1) {
      for (let column = bounds.firstColumn; column <= bounds.lastColumn; column += 1) {
        this.#addPlants(obstacles, this.#grid.index(column, row), around);
      }
    }

    return obstacles;
  }

  #addPlants(obstacles: Obstacle[], cell: number, around: Obstacle): void {
    const vegetation = this.#vegetation;

    for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
      const radius = BLOCKING_RADIUS_PER_METER[vegetation.species[plant]] * vegetation.height[plant];

      if (radius < SMALLEST_OBSTACLE || !isStanding(vegetation, plant)) {
        continue;
      }

      const distance = around.radius + radius;

      if (distanceSquared(vegetation.x[plant], vegetation.z[plant], around.x, around.z) < distance * distance) {
        obstacles.push({ radius, x: vegetation.x[plant], z: vegetation.z[plant] });
      }
    }
  }
}
