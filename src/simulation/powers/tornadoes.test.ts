import { describe, expect, it } from "vitest";
import { isTreeSpecies, PlantSpecies } from "../../content/plants.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import type { TornadoEffect } from "../effects.ts";
import type { Simulation } from "../simulation.ts";
import { createPowerSimulation } from "../testing/test-powers.ts";
import { plantInCell } from "../testing/test-world.ts";
import { cellsInArea } from "../world/terrain-editing.ts";

function runFor(simulation: Simulation, seconds: number): string[] {
  const texts: string[] = [];

  for (let elapsed = 0; elapsed < seconds; elapsed += 0.25) {
    texts.push(
      ...simulation.advance(0.25).chronicle.map((entry) => {
        return entry.text;
      })
    );
  }

  return texts;
}

function takeTornado(simulation: Simulation): TornadoEffect {
  const [effect] = simulation.advance(0).effects;

  if (effect.kind !== "tornado") {
    throw new Error("Expected a tornado");
  }

  return effect;
}

function fallenTrees(simulation: Simulation): number {
  const { vegetation } = simulation.world;

  let fallen = 0;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    if (vegetation.state[plant] === PlantState.Fallen && isTreeSpecies(vegetation.species[plant])) {
      fallen += 1;
    }
  }

  return fallen;
}

describe("tornadoes", () => {
  it("walks with the wind and dies out after its lifetime", () => {
    const simulation = createPowerSimulation();

    simulation.weather.setWind(270, 30, 1);

    simulation.usePower("tornado", 0, 0, { lifetime: 10, strength: 100 });

    const { path } = takeTornado(simulation);
    const { windX, windZ } = simulation.environment;
    const last = path.length - 2;

    expect((path[last] - path[0]) * windX + (path[last + 1] - path[1]) * windZ).toBeGreaterThan(50);
    expect(simulation.isBusy).toBe(true);

    runFor(simulation, 11);

    expect(simulation.isBusy).toBe(false);
  });

  it("uproots trees on its way", () => {
    const simulation = createPowerSimulation();

    const grove = cellsInArea(simulation.world, { radius: 20, x: 0, z: 0 });

    for (const { cell } of grove) {
      simulation.world.clearPlants(cell, true);
      plantInCell(simulation.world, cell, PlantSpecies.Oak);
    }

    simulation.usePower("tornado", 0, 0, { lifetime: 5, strength: 100 });
    runFor(simulation, 5);

    expect(fallenTrees(simulation)).toBeGreaterThan(grove.length / 2);
  });

  it("tears down huts and names the people it kills", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, {});

    const [tribe] = simulation.society.tribes();
    const hut = simulation.buildings.add(
      { kind: "tent", rotation: 0, tribeId: tribe.id, x: tribe.campX, z: tribe.campZ },
      simulation.random
    );

    hut.progress = 1;

    for (const person of simulation.society.membersOf(tribe)) {
      person.health = 0.05;
    }

    simulation.usePower("tornado", tribe.campX, tribe.campZ, { lifetime: 5, strength: 100 });

    const texts = runFor(simulation, 5);

    expect(simulation.buildings.all).not.toContain(hut);
    expect(texts).toContainEqual(expect.stringContaining("swept away by a tornado"));
  });

  it("blows out the fire on its way", () => {
    const simulation = createPowerSimulation();

    const blaze = cellsInArea(simulation.world, { radius: 30, x: 0, z: 0 }).map(({ cell }) => {
      return cell;
    });

    for (const cell of blaze) {
      simulation.fire.ignite(cell, 0.8);
    }

    simulation.usePower("tornado", 0, 0, { lifetime: 5, strength: 100 });
    runFor(simulation, 1);

    const burning = blaze.filter((cell) => {
      return simulation.world.fields.fire[cell] > 0;
    });

    expect(burning.length).toBeLessThan(blaze.length / 4);
  });

  it("puts out a burning hut it passes over", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, {});

    const [tribe] = simulation.society.tribes();
    const hut = simulation.buildings.add(
      { kind: "tent", rotation: 0, tribeId: tribe.id, x: tribe.campX, z: tribe.campZ },
      simulation.random
    );

    hut.progress = 1;
    hut.burningSeconds = 60;

    simulation.usePower("tornado", tribe.campX, tribe.campZ, { lifetime: 5, strength: 5 });
    runFor(simulation, 0.5);

    expect(hut.burningSeconds).toBe(0);
  });

  it("refuses to touch down past the coast or off the map", () => {
    const simulation = createPowerSimulation();

    const { grid, terrain } = simulation.world;

    terrain.coastDistance[grid.cellAt(-300, 0)] = -5;

    simulation.usePower("tornado", -300, 0, { lifetime: 5, strength: 100 });
    simulation.usePower("tornado", grid.worldSize * 2, 0, { lifetime: 5, strength: 100 });

    expect(simulation.takeNotices()).toEqual([
      "A tornado has to touch down on the island.",
      "A tornado has to touch down on the island.",
    ]);
    expect(simulation.advance(0).effects).toEqual([]);
  });
});
