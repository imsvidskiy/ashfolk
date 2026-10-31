import { describe, expect, it } from "vitest";
import { PlantSpecies } from "../../content/plants.ts";
import { NO_PLANT, type PlantPlacement } from "../../world/vegetation-store.ts";
import { centerCell, createTestWorld } from "../testing/test-world.ts";
import type { WorldState } from "../world/world-state.ts";
import { Nursery } from "./nursery.ts";

const FULL_HEIGHT = 20;
const GROWING_DAYS = 4;
const STEP_DAYS = 0.01;

function oakBornOn(world: WorldState, bornDay: number): PlantPlacement {
  const cell = centerCell(world);

  return {
    bornDay,
    height: FULL_HEIGHT,
    rotation: 0,
    seed: 0.5,
    species: PlantSpecies.Oak,
    x: world.grid.cellCenterX(cell),
    z: world.grid.cellCenterZ(cell),
  };
}

function plantInCenter(world: WorldState): number {
  const plant = world.vegetation.firstPlantInCell(centerCell(world));

  if (plant === NO_PLANT) {
    throw new Error("Expected a plant in the center cell");
  }

  return plant;
}

function growFor(nursery: Nursery, days: number): void {
  for (let elapsed = 0; elapsed < days; elapsed += STEP_DAYS) {
    nursery.grow(STEP_DAYS);
  }
}

describe("nursery", () => {
  it("plants a seedling small and raises it to full height over its growing days", () => {
    const world = createTestWorld();
    const nursery = new Nursery(world);

    nursery.plant(oakBornOn(world, 0), GROWING_DAYS);

    const seedling = plantInCenter(world);
    const planted = world.vegetation.height[seedling];

    growFor(nursery, GROWING_DAYS / 2);

    const halfway = world.vegetation.height[seedling];

    growFor(nursery, GROWING_DAYS);

    expect(planted).toBeCloseTo(FULL_HEIGHT * 0.2);
    expect(halfway).toBeGreaterThan(planted);
    expect(halfway).toBeLessThan(FULL_HEIGHT);
    expect(world.vegetation.height[seedling]).toBeCloseTo(FULL_HEIGHT);
    expect(nursery.snapshot().seedlings).toEqual([]);
  });

  it("leaves alone a plant that took the place of a lost seedling", () => {
    const world = createTestWorld();
    const nursery = new Nursery(world);

    nursery.plant(oakBornOn(world, 0), GROWING_DAYS);

    const seedling = plantInCenter(world);

    world.removePlant(seedling);

    const newcomer = world.plant({ ...oakBornOn(world, 1), height: 5 });

    growFor(nursery, GROWING_DAYS);

    expect(newcomer).toBe(seedling);
    expect(world.vegetation.height[newcomer]).toBe(5);
    expect(nursery.snapshot().seedlings).toEqual([]);
  });

  it("leaves alone a plant of another species that took the place of a lost seedling on its day", () => {
    const world = createTestWorld();
    const nursery = new Nursery(world);

    nursery.plant(oakBornOn(world, 0), GROWING_DAYS);

    const seedling = plantInCenter(world);

    world.removePlant(seedling);

    const newcomer = world.plant({ ...oakBornOn(world, 0), height: 5, species: PlantSpecies.Pine });

    growFor(nursery, GROWING_DAYS);

    expect(newcomer).toBe(seedling);
    expect(world.vegetation.height[newcomer]).toBe(5);
    expect(nursery.snapshot().seedlings).toEqual([]);
  });
});
