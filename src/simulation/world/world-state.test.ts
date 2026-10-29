import { describe, expect, it } from "vitest";
import { Ground, groundDefinition } from "../../content/grounds.ts";
import { PlantSpecies, plantSpeciesDefinition } from "../../content/plants.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import type { Spring } from "../../world/water.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import {
  centerCell,
  createTestWorld,
  floodCells,
  floodStrip,
  fordAcross,
  monumentAround,
  plantInCell,
} from "../testing/test-world.ts";
import { CROSSING_GROUND, MONUMENT_GROUND, NO_BUILDING, SPRING_GROUND } from "./world-state.ts";

function caveAt(grid: WorldGrid, cell: number): Spring {
  return {
    cells: [cell],
    directionX: 0,
    directionZ: 1,
    kind: "cave",
    level: 100,
    radius: 4,
    river: 0,
    seed: 0.5,
    x: grid.cellCenterX(cell),
    z: grid.cellCenterZ(cell),
  };
}

describe("world state", () => {
  it("interpolates heights between cell centers", () => {
    const world = createTestWorld({
      heightAt: (x) => {
        return 100 + x;
      },
    });

    expect(world.heightAt(5, 0)).toBeCloseTo(105);
    expect(world.heightAt(10, 0)).toBeCloseTo(110);
  });

  it("measures slope as rise over run", () => {
    const world = createTestWorld({
      heightAt: (x) => {
        return 100 + 0.5 * x;
      },
    });

    expect(world.slope(centerCell(world))).toBeCloseTo(0.5);
  });

  it("knows where the water is and how deep it is", () => {
    const world = createTestWorld();

    const cell = centerCell(world);

    floodCells(world, [cell], 3);

    expect(world.isWater(cell)).toBe(true);
    expect(world.waterDepth(cell)).toBeCloseTo(3);
    expect(world.surfaceAt(5, 5)).toBeCloseTo(103);
    expect(world.isWalkable(cell)).toBe(false);
  });

  it("plants nothing within a few metres of the coast", () => {
    const world = createTestWorld();

    const cell = centerCell(world);
    const x = world.grid.cellCenterX(cell);
    const z = world.grid.cellCenterZ(cell);
    const placement = { bornDay: 0, height: 8, rotation: 0, seed: 0.5, species: PlantSpecies.Spruce, x, z };

    expect(world.plant(placement)).toBeGreaterThanOrEqual(0);

    world.terrain.coastDistance.fill(3);

    expect(world.plant(placement)).toBe(NO_PLANT);
  });

  it("keeps everything beyond the coast off the island", () => {
    const world = createTestWorld();

    const cell = centerCell(world);

    expect(world.isOnIsland(cell)).toBe(true);
    expect(world.isWalkable(cell)).toBe(true);

    world.terrain.coastDistance[cell] = -5;

    expect(world.isOnIsland(cell)).toBe(false);
    expect(world.isWalkable(cell)).toBe(false);
  });

  it("cools raised land as generation cools high ground, summit chill included", () => {
    const world = createTestWorld();

    const cell = centerCell(world);

    world.setHeight(cell, 1200);

    expect(world.terrain.baseTemperature[cell]).toBeCloseTo(15 - 0.0095 * 1100 - 5.5, 4);

    world.setHeight(cell, 100);

    expect(world.terrain.baseTemperature[cell]).toBeCloseTo(15, 4);
  });

  it("resets ground fuel when the ground changes", () => {
    const world = createTestWorld();

    const cell = centerCell(world);

    world.setGround(cell, Ground.Steppe);

    expect(world.fields.fuel[cell]).toBeCloseTo(groundDefinition(Ground.Steppe).fuel);
    expect(world.groundChanges.takeRuns()).toEqual([{ firstRow: world.grid.rowOf(cell), rowCount: 1 }]);
  });

  it("tracks canopy fuel as trees are planted and removed", () => {
    const world = createTestWorld();

    const cell = centerCell(world);
    const tree = plantInCell(world, cell, PlantSpecies.Oak);

    expect(world.canopyFuel[cell]).toBeCloseTo(plantSpeciesDefinition(PlantSpecies.Oak).canopyFuel);

    world.removePlant(tree);

    expect(world.canopyFuel[cell]).toBe(0);
    expect(world.initialCanopyFuel[cell]).toBe(0);
  });

  it("keeps the starting canopy fuel while a cell burns", () => {
    const world = createTestWorld();

    const cell = centerCell(world);
    const tree = plantInCell(world, cell, PlantSpecies.Spruce);

    world.fields.fire[cell] = 0.5;
    world.removePlant(tree);

    expect(world.initialCanopyFuel[cell]).toBeCloseTo(plantSpeciesDefinition(PlantSpecies.Spruce).canopyFuel);
  });

  it("keeps walkers, builders and new plants off monument ground", () => {
    const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });
    const world = createTestWorld({ monuments: [monumentAround(grid, 0, 0, 15)] });

    const ruin = centerCell(world);
    const open = world.grid.cellAt(200, 0);

    expect(world.occupancy[ruin]).toBe(MONUMENT_GROUND);
    expect(world.isObstructed(ruin)).toBe(true);
    expect(world.isWalkable(ruin)).toBe(false);
    expect(world.canPlace(ruin, 1)).toBe(false);
    expect(world.isObstructed(open)).toBe(false);
    expect(world.isWalkable(open)).toBe(true);
    expect(world.canPlace(open, 1)).toBe(true);
  });

  it("keeps builders, walkers and plants off the ground of a spring and moves it with the water", () => {
    const world = createTestWorld();

    const first = centerCell(world);
    const second = world.grid.cellAt(200, 0);
    const tree = plantInCell(world, second, PlantSpecies.Oak);

    world.replaceWater({ ...world.water, springs: [caveAt(world.grid, first)] }, []);

    expect(world.occupancy[first]).toBe(SPRING_GROUND);
    expect(world.isObstructed(first)).toBe(true);
    expect(world.canPlace(first, 1)).toBe(false);
    expect(world.canGrowWild(first, PlantSpecies.Oak)).toBe(false);
    expect(world.vegetation.isAlive(tree)).toBe(true);

    world.replaceWater({ ...world.water, springs: [caveAt(world.grid, second)] }, []);

    expect(world.occupancy[first]).toBe(NO_BUILDING);
    expect(world.canPlace(first, 1)).toBe(true);
    expect(world.occupancy[second]).toBe(SPRING_GROUND);
    expect(world.vegetation.isAlive(tree)).toBe(false);
  });

  it("never clears monument stones, not even with the stones", () => {
    const world = createTestWorld();

    const cell = centerCell(world);
    const menhir = plantInCell(world, cell, PlantSpecies.Menhir);
    const boulder = plantInCell(world, cell, PlantSpecies.Boulder);

    world.clearPlants(cell, true);

    expect(world.vegetation.isAlive(menhir)).toBe(true);
    expect(world.vegetation.isAlive(boulder)).toBe(false);
  });

  it("keeps buildings and fields off the banks a crossing lands on but lets walkers over them", () => {
    const ford = fordAcross(-24, 24, 0);
    const world = createTestWorld({ crossings: [ford] });

    floodStrip(world, 20, 1.5);

    const bank = world.grid.cellAt(-24, 0);

    expect(world.occupancy[bank]).toBe(CROSSING_GROUND);
    expect(world.canPlace(bank, 1)).toBe(false);
    expect(world.isWalkable(bank)).toBe(true);
    expect(world.crossingAt(0, 0.5)).toBe(ford);
    expect(world.crossingAt(0, 3)).toBeNull();

    world.replaceWater(world.water, []);

    expect(world.occupancy[bank]).toBe(NO_BUILDING);
    expect(world.crossingAt(0, 0.5)).toBeNull();
  });

  it("keeps the fingerprint of the generated land after the land changes", () => {
    const world = createTestWorld();
    const fingerprint = world.generationFingerprint;

    world.setHeight(0, 900);

    expect(world.generationFingerprint).toBe(fingerprint);
  });
});
