import { describe, expect, it } from "vitest";
import { Ground } from "../../content/grounds.ts";
import { PlantSpecies } from "../../content/plants.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { createPowerSimulation } from "../testing/test-powers.ts";
import { snapshotOf } from "../testing/test-simulation.ts";
import { floodCells, plantInCell } from "../testing/test-world.ts";

describe("black-hole destruction", () => {
  it("strips trees and buildings in widening rings, fells outer trees inward and lowers the basin once", () => {
    const simulation = createPowerSimulation();
    const { world } = simulation;
    const { grid, vegetation } = world;
    const center = grid.cellAt(5, 5);
    const inner = plantInCell(world, center, PlantSpecies.Oak);
    const middle = plantInCell(world, grid.cellAt(45, 5), PlantSpecies.Oak);
    const edge = plantInCell(world, grid.cellAt(65, 5), PlantSpecies.Oak);
    const outside = plantInCell(world, grid.cellAt(85, 5), PlantSpecies.Oak);
    const hut = simulation.buildings.add({ kind: "tent", rotation: 0, tribeId: 0, x: 45, z: 5 }, simulation.random);
    const before = world.terrain.height[center];
    const version = world.heightVersion;

    simulation.usePower("black-hole", 5, 5, { duration: 5, radius: 100 });

    expect(vegetation.state[inner]).toBe(PlantState.Removed);
    expect(world.terrain.ground[center]).toBe(Ground.Rock);
    expect(simulation.buildings.all).toContain(hut);

    simulation.runTicks(42);

    expect(vegetation.state[middle]).toBe(PlantState.Removed);
    expect(simulation.buildings.all).not.toContain(hut);
    expect(world.heightVersion).toBe(version);

    simulation.runTicks(10);

    expect(world.terrain.height[center]).toBeLessThan(before - 25);
    expect(world.heightVersion).toBe(version + 1);
    expect(vegetation.state[edge]).toBe(PlantState.Fallen);
    expect(Math.sin(vegetation.rotation[edge])).toBeCloseTo(-1);
    expect(vegetation.isAlive(outside)).toBe(true);
    expect(world.terrain.height[grid.cellAt(85, 5)]).toBe(before);
  });

  it("captures animals across water and leaves no carcass", () => {
    const simulation = createPowerSimulation();
    const { world } = simulation;

    simulation.usePower("deer", 0, 0, { herdSize: 2 });

    const [animal] = simulation.fauna.animals;

    animal.mover.x = 15;
    animal.mover.z = 5;
    floodCells(world, [world.grid.cellAt(25, 5), world.grid.cellAt(35, 5)], 4);
    simulation.usePower("black-hole", 75, 5, { duration: 5, radius: 110 });
    simulation.runTicks(20);

    expect(animal.causeOfDeath).toBe("gravity");
    expect(simulation.fauna.animals).not.toContain(animal);
  });

  it("remembers captured inhabitants through a save and reports the loss once", () => {
    const original = createPowerSimulation();

    original.usePower("tribe", 0, 0, { people: 8 });

    const [first] = original.society.people;
    const { x, z } = first.mover;

    for (const person of original.society.people) {
      person.mover.x = x;
      person.mover.z = z;
    }

    original.usePower("black-hole", x, z, { duration: 5, radius: 100 });
    original.runTicks(2);

    const snapshot = snapshotOf(original);
    const loaded = createPowerSimulation();

    loaded.restore(snapshot);
    loaded.runTicks(50);

    const notices = loaded.advance(0).chronicle.map((entry) => {
      return entry.text;
    });

    expect(
      notices.filter((text) => {
        return text.includes("black hole");
      })
    ).toEqual(["The black hole swallowed 8 people and left a hollow in the island"]);
  });

  it("collapses a well from a 0.12 save with no capture count", () => {
    const original = createPowerSimulation();
    const snapshot = snapshotOf(original);
    const loaded = createPowerSimulation();

    snapshot.blackHoles = [
      { effect: { durationSeconds: 5, kind: "black-hole", radius: 100, surfaceY: 100, x: 5, z: 5 }, remaining: 0.4 },
    ];
    loaded.restore(snapshot);
    loaded.runTicks(5);

    expect(loaded.world.heightAt(5, 5)).toBeLessThan(75);
    expect(loaded.advance(0).chronicle).toContainEqual(
      expect.objectContaining({ text: "The black hole collapsed, leaving a hollow in the island" })
    );
  });
});
