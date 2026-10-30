import { describe, expect, it } from "vitest";
import { Biome } from "../../content/biomes.ts";
import { Ground } from "../../content/grounds.ts";
import { PlantSpecies } from "../../content/plants.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { Simulation } from "../simulation.ts";
import { brush, createPowerSimulation } from "../testing/test-powers.ts";
import {
  centerCell,
  createVegetatedWorld,
  monumentAround,
  plantInCell,
  plantsTooSteep,
  steepeningRamp,
} from "../testing/test-world.ts";
import { cellsInArea } from "../world/terrain-editing.ts";

describe("land", () => {
  it("flatten pulls the land towards where the stroke began", () => {
    const simulation = createPowerSimulation();

    const cell = simulation.world.grid.cellAt(30, 0);

    simulation.world.setHeight(cell, 140);
    brush(simulation, "flatten", 2);

    expect(simulation.world.terrain.height[cell]).toBeLessThan(110);
  });

  it("smooth softens a spike", () => {
    const simulation = createPowerSimulation();

    simulation.world.setHeight(centerCell(simulation.world), 180);
    brush(simulation, "smooth", 1);

    expect(simulation.world.terrain.height[centerCell(simulation.world)]).toBeLessThan(120);
  });

  it("raise lifts the land and lower sinks it", () => {
    const simulation = createPowerSimulation();

    const { terrain } = simulation.world;

    const cell = centerCell(simulation.world);
    const before = terrain.height[cell];

    brush(simulation, "raise", 1);

    const raised = terrain.height[cell];

    brush(simulation, "lower", 2);

    expect(raised).toBeGreaterThan(before + 5);
    expect(terrain.height[cell]).toBeLessThan(before - 5);
  });

  it("paint changes the ground and clears plants from rock", () => {
    const simulation = createPowerSimulation();

    const cell = centerCell(simulation.world);

    plantInCell(simulation.world, cell, PlantSpecies.Oak);
    simulation.beginStroke("paint", 0, 0, { material: "rock", radius: 40 });
    simulation.endStroke();

    expect(simulation.world.terrain.ground[cell]).toBe(Ground.Rock);
    expect(simulation.world.vegetation.hasPlantsInCell(cell)).toBe(false);
  });

  it("paint leaves the ground past the coast alone", () => {
    const simulation = createPowerSimulation();

    const { grid, terrain } = simulation.world;
    const cell = grid.cellAt(-20, 0);

    terrain.coastDistance[cell] = -5;
    simulation.beginStroke("paint", 0, 0, { material: "forest", radius: 40 });
    simulation.endStroke();

    expect(terrain.ground[centerCell(simulation.world)]).toBe(Ground.Forest);
    expect(terrain.ground[cell]).toBe(Ground.Meadow);
  });

  it("forest plants the chosen trees", () => {
    const simulation = createPowerSimulation();

    const before = simulation.world.vegetation.aliveCount;

    simulation.beginStroke("forest", 0, 0, { density: 100, species: "birch" });

    for (let step = 0; step < 40; step += 1) {
      simulation.advance(0.05);
    }

    expect(simulation.world.vegetation.aliveCount).toBeGreaterThan(before + 20);
  });

  it("forest plants every tree only on ground gentle enough for it", () => {
    const simulation = new Simulation(
      createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 96 }, heightAt: steepeningRamp(1.4, 480) })
    );
    const { vegetation } = simulation.world;

    const before = vegetation.aliveCount;

    for (const x of [-300, -100, 100, 300]) {
      simulation.beginStroke("forest", x, 0, { density: 100, radius: 120, species: "climate" });

      for (let step = 0; step < 40; step += 1) {
        simulation.advance(0.05);
      }

      simulation.endStroke();
    }

    expect(vegetation.aliveCount).toBeGreaterThan(before + 100);
    expect(plantsTooSteep(simulation.world)).toEqual([]);
  });

  it("forest plants nothing on monument ground", () => {
    const dimensions = { cellSize: 10, cellsPerSide: 96 };
    const ruin = monumentAround(new WorldGrid(dimensions), 0, 0, 50);
    const simulation = new Simulation(createVegetatedWorld({ dimensions, monuments: [ruin] }));
    const { vegetation } = simulation.world;

    const before = vegetation.count;

    simulation.beginStroke("forest", 0, 0, { density: 100, radius: 120, species: "oak" });

    for (let step = 0; step < 40; step += 1) {
      simulation.advance(0.05);
    }

    simulation.endStroke();

    const planted = Array.from({ length: vegetation.count - before }, (_, index) => {
      return vegetation.cell[before + index];
    });

    expect(planted.length).toBeGreaterThan(20);
    expect(
      planted.filter((cell) => {
        return simulation.world.isObstructed(cell);
      })
    ).toEqual([]);
  });

  it("forest turns the ground to forest floor only where a tree took root", () => {
    const simulation = new Simulation(
      createVegetatedWorld({ biome: Biome.Forest, dimensions: { cellSize: 10, cellsPerSide: 96 } })
    );
    const { terrain, vegetation } = simulation.world;

    const area = cellsInArea(simulation.world, { radius: 120, x: 0, z: 0 });

    for (const { cell } of area) {
      simulation.world.clearPlants(cell, true);
      terrain.coastDistance[cell] = 1;
    }

    simulation.beginStroke("forest", 0, 0, { density: 100, radius: 100, species: "oak" });

    for (let step = 0; step < 40; step += 1) {
      simulation.advance(0.05);
    }

    expect(
      area.filter(({ cell }) => {
        return terrain.ground[cell] === Ground.Forest || vegetation.hasPlantsInCell(cell);
      })
    ).toEqual([]);
  });

  it("forest suited to a hot climate grows acacias and palms", () => {
    const simulation = createPowerSimulation(20);
    const { vegetation } = simulation.world;

    const before = vegetation.count;

    simulation.beginStroke("forest", 0, 0, { density: 100, species: "climate" });

    for (let step = 0; step < 40; step += 1) {
      simulation.advance(0.05);
    }

    const planted = Array.from({ length: vegetation.count - before }, (_, index) => {
      return vegetation.species[before + index];
    });

    expect(planted.length).toBeGreaterThan(20);
    expect(
      planted.every((species) => {
        return species === PlantSpecies.Acacia || species === PlantSpecies.Palm;
      })
    ).toBe(true);
  });
});
