import { describe, expect, it } from "vitest";
import { Ground } from "../../content/grounds.ts";
import { PlantSpecies } from "../../content/plants.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { createPowerSimulation } from "../testing/test-powers.ts";
import { snapshotOf } from "../testing/test-simulation.ts";
import { floodCells, plantInCell } from "../testing/test-world.ts";

describe("black-hole destruction", () => {
  it("swallows trees and buildings along advancing faults, fells outer trees inward and then drops the shelves", () => {
    const simulation = createPowerSimulation();
    const { world } = simulation;
    const { grid, vegetation } = world;
    const center = grid.cellAt(5, 5);
    const inner = plantInCell(world, center, PlantSpecies.Oak);
    const middle = plantInCell(world, grid.cellAt(45, 5), PlantSpecies.Oak);
    const edge = plantInCell(world, grid.cellAt(95, 5), PlantSpecies.Oak);
    const outside = plantInCell(world, grid.cellAt(115, 5), PlantSpecies.Oak);
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

    simulation.runTicks(4);

    expect(world.heightVersion).toBe(version + 1);
    expect(world.terrain.height[center]).toBe(before);

    simulation.runTicks(6);

    expect(world.terrain.height[center]).toBeLessThan(before - 25);
    expect(world.heightVersion).toBe(version + 2);
    expect(vegetation.state[edge]).toBe(PlantState.Fallen);
    expect(Math.sin(vegetation.rotation[edge])).toBeCloseTo(-1);
    expect(vegetation.isAlive(outside)).toBe(true);
    expect(world.terrain.height[grid.cellAt(115, 5)]).toBe(before);
  });

  it("pulls a distant inhabitant and shatters a settlement near the edge of the default footprint", () => {
    const simulation = createPowerSimulation();
    const { world } = simulation;
    const x = -165;
    const z = 5;

    simulation.usePower("tribe", -5, 5, { people: 3 });
    const [near, beyond] = simulation.society.people;

    near.mover.x = x + 485;
    near.mover.z = z;
    beyond.mover.x = x + 535;
    beyond.mover.z = z;
    const hut = simulation.buildings.add({ kind: "tent", rotation: 0, tribeId: 0, x: x + 300, z }, simulation.random);
    const before = world.terrain.height.slice();

    simulation.usePower("black-hole", x, z, { duration: 5 });

    const opening = simulation.advance(0).effects.find((effect) => {
      return effect.kind === "black-hole";
    });

    expect(opening?.radius).toBe(500);
    simulation.runTicks(30);
    expect(near.causeOfDeath).toBe("gravity");
    expect(beyond.causeOfDeath).toBeNull();
    simulation.runTicks(21);
    expect(simulation.buildings.all).not.toContain(hut);

    const north = world.grid.cellAt(x, z + 300);
    const south = world.grid.cellAt(x, z - 300);
    const untouched = world.grid.cellAt(x + 535, z);

    expect(Math.abs(world.terrain.height[north] - world.terrain.height[south])).toBeGreaterThan(10);
    expect(world.terrain.height[untouched]).toBe(before[untouched]);
    expect(
      world.terrain.height.some((height, cell) => {
        return height > before[cell] + 10;
      })
    ).toBe(true);
  });

  it("keeps a coastal collapse on the island and the protected map rim intact at maximum radius", () => {
    const simulation = createPowerSimulation();
    const { world } = simulation;
    const { grid } = world;
    const before = world.terrain.height.slice();

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (grid.cellCenterX(cell) > 100) {
        world.terrain.coastDistance[cell] = -1;
      }
    }

    simulation.usePower("black-hole", 95, 5, { duration: 5, radius: 1100 });
    simulation.runTicks(51);

    expect(world.heightAt(85, 5)).toBeLessThan(75);

    const protectedHeightChanged = world.terrain.height.some((height, cell) => {
      const isEditable = world.isOnIsland(cell) && grid.isInside(grid.cellCenterX(cell), grid.cellCenterZ(cell), 20);

      return !isEditable && height !== before[cell];
    });

    expect(protectedHeightChanged).toBe(false);
  });

  it("resumes after the first fracture without lifting the same shoulder twice", () => {
    const original = createPowerSimulation();
    const loaded = createPowerSimulation();

    original.usePower("black-hole", 5, 5, { duration: 5, radius: 240 });
    original.runTicks(46);
    const snapshot = snapshotOf(original);

    expect(snapshot.blackHoles?.[0]?.hasFractured).toBe(true);
    loaded.restore(snapshot);
    original.runTicks(6);
    loaded.runTicks(6);

    expect(loaded.world.terrain.height).toEqual(original.world.terrain.height);
    expect(loaded.world.terrain.ground).toEqual(original.world.terrain.ground);
  });

  it("emits the real swallowed wood and roof from their ground positions and restores a partial wave", () => {
    const simulation = createPowerSimulation();
    const { world } = simulation;
    const cell = world.grid.cellAt(5, 5);
    const pine = plantInCell(world, cell, PlantSpecies.Pine);
    const monument = plantInCell(world, world.grid.cellAt(15, 5), PlantSpecies.Menhir);
    const hut = simulation.buildings.add({ kind: "tent", rotation: 0.4, tribeId: 0, x: -5, z: 5 }, simulation.random);

    world.vegetation.burn(pine, 0);
    simulation.usePower("black-hole", 5, 5, { duration: 6, radius: 100 });

    const { effects } = simulation.advance(0);
    const wave = effects.find((effect) => {
      return effect.kind === "black-hole-inflow";
    });

    expect(wave?.sources.length).toBeLessThanOrEqual(32);
    expect(wave?.sources).toContainEqual(expect.objectContaining({ material: "wood", size: 20, x: 5, y: 100, z: 5 }));
    expect(wave?.sources).toContainEqual(
      expect.objectContaining({ material: "roof", rotation: hut.rotation, x: -5, y: 100, z: 5 })
    );
    expect(wave?.sources).not.toContainEqual(expect.objectContaining({ material: "rock", x: 15, z: 5 }));
    expect(world.vegetation.state[monument]).toBe(PlantState.Alive);

    simulation.runTicks(3);
    const loaded = createPowerSimulation();
    loaded.restore(snapshotOf(simulation));
    const resumed = loaded.initialWorld().frame.effects;
    expect(resumed).toContainEqual({ ...wave, elapsedSeconds: expect.closeTo(0.3, 6) });

    loaded.usePower("black-hole", 5, 5, { duration: 5, radius: 100 });
    const second = loaded.advance(0).effects.find((effect) => {
      return effect.kind === "black-hole";
    });
    expect(second?.wellId).toBeDefined();
    expect(second?.wellId).not.toBe(wave?.wellId);
    loaded.runTicks(61);

    const collapses = loaded.advance(0).effects.filter((effect) => {
      return effect.kind === "black-hole-collapse";
    });
    expect(collapses).toEqual([
      { kind: "black-hole-collapse", wellId: second?.wellId },
      { kind: "black-hole-collapse", wellId: wave?.wellId },
    ]);
  });

  it("opens the same next hole after saving an empty sky as it does in continuous play", () => {
    const original = createPowerSimulation();
    const loaded = createPowerSimulation();

    original.usePower("black-hole", 5, 5, { duration: 5, radius: 100 });
    original.runTicks(51);
    original.execute({ isPaused: true, type: "setPaused" });
    original.advance(0);

    for (let frame = 0; frame < 70; frame += 1) {
      original.advance(0.1);
    }

    const snapshot = snapshotOf(original);

    expect(snapshot.blackHoles).toEqual([]);
    loaded.restore(snapshot);
    original.usePower("black-hole", 25, 5, { duration: 5, radius: 100 });
    loaded.usePower("black-hole", 25, 5, { duration: 5, radius: 100 });

    expect(loaded.advance(0).effects).toEqual(original.advance(0).effects);
  });

  it("lifts water from its sampled waterline and stone from the lakebed", () => {
    const simulation = createPowerSimulation();
    const { world } = simulation;
    const cell = world.grid.cellAt(5, 5);

    floodCells(world, [cell], 12);
    plantInCell(world, cell, PlantSpecies.Boulder);
    simulation.usePower("black-hole", 5, 5, { duration: 5, radius: 10 });

    const wave = simulation.advance(0).effects.find((effect) => {
      return effect.kind === "black-hole-inflow";
    });

    expect(wave?.sources).toContainEqual(expect.objectContaining({ material: "water", x: 5, y: 112, z: 5 }));
    expect(wave?.sources).toContainEqual(expect.objectContaining({ material: "rock", x: 5, y: 100, z: 5 }));
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
    const hut = original.buildings.add({ kind: "tent", rotation: 0, tribeId: 0, x: 85, z: 5 }, original.random);
    const snapshot = snapshotOf(original);
    const loaded = createPowerSimulation();

    snapshot.blackHoles = [
      { effect: { durationSeconds: 5, kind: "black-hole", radius: 100, surfaceY: 100, x: 5, z: 5 }, remaining: 0.4 },
    ];
    loaded.restore(snapshot);
    const legacy = loaded.initialWorld().frame.effects.find((effect) => {
      return effect.kind === "black-hole";
    });

    loaded.usePower("black-hole", 155, 155, { duration: 5, radius: 20 });
    const fresh = loaded.advance(0).effects.find((effect) => {
      return effect.kind === "black-hole";
    });

    expect(legacy?.wellId).toBeDefined();
    expect(legacy?.radius).toBe(100);
    expect(loaded.buildings.find(hut.id)).not.toBeNull();
    expect(fresh?.wellId).toBeDefined();
    expect(fresh?.wellId).not.toBe(legacy?.wellId);
    loaded.runTicks(5);

    expect(loaded.world.heightAt(5, 5)).toBeLessThan(75);
    expect(loaded.buildings.find(hut.id)).toBeNull();
    expect(loaded.advance(0).chronicle).toContainEqual(
      expect.objectContaining({ text: "The black hole collapsed, leaving a hollow in the island" })
    );
  });
});
