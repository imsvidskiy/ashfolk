import { describe, expect, it } from "vitest";
import { plantSpeciesDefinition } from "../../content/plants.ts";
import { TECHNOLOGIES } from "../../content/technologies.ts";
import { totalFood } from "../society/stock.ts";
import { createPowerSimulation } from "../testing/test-powers.ts";
import { floodCells, livingCount } from "../testing/test-world.ts";

describe("life", () => {
  it("brings a tribe that settles near the click", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 100, 100, { people: 5 });

    expect(simulation.society.population).toBe(5);
  });

  it("explains when a tribe has no dry land to settle on", () => {
    const simulation = createPowerSimulation();

    const { world } = simulation;

    floodCells(world, world.grid.cellsInRadius(0, 0, 200), 1.2);
    simulation.navigation.rebuild();
    simulation.usePower("tribe", 0, 0, {});

    expect(simulation.society.population).toBe(0);
    expect(simulation.takeNotices()).toEqual(["People need flat, dry land away from fire to settle here."]);
  });

  it("brings herds of every kind", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("deer", 0, 0, { herdSize: 4 });
    simulation.usePower("mammoth", 100, 0, { herdSize: 2 });
    simulation.usePower("wolf", -100, 0, { herdSize: 3 });
    simulation.usePower("ibex", 0, 100, { herdSize: 2 });

    expect(livingCount(simulation.fauna)).toBe(11);
    expect(simulation.takeNotices()).toEqual([]);
  });

  it("brings hares only to dry ground away from the water", () => {
    const simulation = createPowerSimulation();

    const { world } = simulation;

    floodCells(world, world.grid.cellsInRadius(0, 0, 30), 1.2);
    simulation.navigation.rebuild();
    simulation.usePower("hare", 35, 0, { herdSize: 3 });

    expect(simulation.takeNotices()).toEqual(["Hares need dry land away from water."]);

    simulation.usePower("hare", 200, 0, {});

    expect(
      simulation.fauna.animals.map((animal) => {
        return animal.kind;
      })
    ).toEqual(["hare", "hare", "hare"]);
  });

  it("abundance fills bushes and feeds the nearest tribe", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, { people: 4 });

    const [tribe] = simulation.society.tribes();

    const foodBefore = totalFood(tribe.stock);

    simulation.usePower("abundance", tribe.campX, tribe.campZ, {});

    expect(totalFood(tribe.stock)).toBeGreaterThan(foodBefore);
  });

  it("abundance ripens bushes with no tribe nearby", () => {
    const simulation = createPowerSimulation();

    const { grid, vegetation } = simulation.world;
    const bushes = grid.cellsInRadius(0, 0, 100).flatMap((cell) => {
      return vegetation.plantsInCell(cell).filter((plant) => {
        return plantSpeciesDefinition(vegetation.species[plant]).givesBerries;
      });
    });

    for (const bush of bushes) {
      vegetation.setFruit(bush, 0);
    }

    simulation.usePower("abundance", 0, 0, { radius: 120 });

    expect(bushes.length).toBeGreaterThan(0);
    expect(
      bushes.every((bush) => {
        return vegetation.fruit[bush] === 1;
      })
    ).toBe(true);
    expect(simulation.society.tribes()).toEqual([]);
    expect(simulation.takeNotices()).toEqual([]);
  });

  it("abundance feeds a tribe whose bushes are gone", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, { people: 4 });

    const [tribe] = simulation.society.tribes();

    for (const cell of simulation.world.grid.cellsInRadius(tribe.campX, tribe.campZ, 200)) {
      simulation.world.vegetation.clearCell(cell, true);
    }

    const foodBefore = totalFood(tribe.stock);

    simulation.usePower("abundance", tribe.campX, tribe.campZ, { radius: 120 });

    expect(totalFood(tribe.stock)).toBeGreaterThan(foodBefore);
    expect(simulation.takeNotices()).toEqual([]);
  });

  it("explains when abundance finds no bush and no tribe", () => {
    const simulation = createPowerSimulation();

    for (const cell of simulation.world.grid.cellsInRadius(0, 0, 200)) {
      simulation.world.vegetation.clearCell(cell, true);
    }

    simulation.usePower("abundance", 0, 0, { radius: 120 });

    expect(simulation.takeNotices()).toEqual(["There is nothing nearby to bless."]);
  });

  it("explains when abundance finds only burnt bushes", () => {
    const simulation = createPowerSimulation();

    const { grid, vegetation } = simulation.world;

    for (const cell of grid.cellsInRadius(0, 0, 200)) {
      for (const plant of vegetation.plantsInCell(cell)) {
        vegetation.burn(plant, 0);
      }
    }

    simulation.usePower("abundance", 0, 0, { radius: 120 });

    expect(simulation.takeNotices()).toEqual(["There is nothing nearby to bless."]);
  });

  it("inspiration brings the next discovery closer", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, { people: 4 });

    const [tribe] = simulation.society.tribes();

    simulation.usePower("inspiration", tribe.campX, tribe.campZ, { strength: 100 });
    simulation.advance(0.1);

    expect(tribe.technologies.has("fire")).toBe(true);
  });

  it("explains when inspiration finds no tribe", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("inspiration", 0, 0, {});

    expect(simulation.takeNotices()).toEqual(["There is no tribe nearby to inspire."]);
  });

  it("explains when the tribe already knows everything", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, { people: 4 });

    const [tribe] = simulation.society.tribes();

    for (const technology of TECHNOLOGIES) {
      tribe.technologies.add(technology.id);
    }

    simulation.usePower("inspiration", tribe.campX, tribe.campZ, {});

    expect(simulation.takeNotices()).toEqual([`${tribe.name} already knows everything there is to know.`]);
  });

  it("healing restores everyone in the circle", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, { people: 4 });

    for (const person of simulation.society.people) {
      person.health = 0.2;
      person.hunger = 0.9;
    }

    const [tribe] = simulation.society.tribes();

    simulation.usePower("healing", tribe.campX, tribe.campZ, { radius: 200 });

    expect(
      simulation.society.people.every((person) => {
        return person.health === 1 && person.hunger <= 0.2;
      })
    ).toBe(true);
  });

  it("explains when healing finds nobody", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("healing", 0, 0, {});

    expect(simulation.takeNotices()).toEqual(["There is nobody inside the circle to heal."]);
  });
});
