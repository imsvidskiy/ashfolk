import { describe, expect, it } from "vitest";
import { Biome } from "../../content/biomes.ts";
import { Ground, groundDefinition } from "../../content/grounds.ts";
import { PlantSpecies } from "../../content/plants.ts";
import { DEFAULT_WORLD_RULES, type WorldRules, worldRulesSchema } from "../../content/world-rules.ts";
import { plantInitialVegetation } from "../../generation/vegetation.ts";
import { createRandom } from "../../shared/random.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { centerCell, createTestWorld, floodCells, plantInCell, type TestWorldOptions } from "../testing/test-world.ts";
import { TICK_SECONDS } from "../tick.ts";
import type { WorldState } from "../world/world-state.ts";
import { FireSystem } from "./fire.ts";

const LARGE_WORLD: Partial<TestWorldOptions> = { dimensions: { cellSize: 10, cellsPerSide: 96 } };

interface FireScenario {
  fire: FireSystem;
  world: WorldState;
}

function startFire(world: WorldState, windSpeed: number, rules: WorldRules = DEFAULT_WORLD_RULES): FireScenario {
  const fire = new FireSystem(world);

  fire.setWind(1, 0, windSpeed, rules);

  for (const cell of world.grid.cellsInRadius(5, 5, 26)) {
    const distance = Math.hypot(world.grid.cellCenterX(cell) - 5, world.grid.cellCenterZ(cell) - 5);

    fire.ignite(cell, 0.45 * (1 - (distance / 26) * 0.6));
  }

  return { fire, world };
}

function burnFor(scenario: FireScenario, seconds: number, rules: WorldRules = DEFAULT_WORLD_RULES): void {
  const random = createRandom(3);

  for (let elapsed = 0; elapsed < seconds; elapsed += TICK_SECONDS) {
    scenario.fire.update(TICK_SECONDS, { airTemperatureOffset: 0, day: 1, drought: 0.5 }, rules, random);
  }
}

function isTouched(world: WorldState, cell: number): boolean {
  return world.fields.fire[cell] > 0 || world.fields.scorch[cell] > 0.05;
}

function reachTowards(world: WorldState, directionX: number): number {
  let reach = 0;

  for (let cell = 0; cell < world.grid.cellCount; cell += 1) {
    const offsetX = (world.grid.cellCenterX(cell) - 5) * directionX;

    if (Math.abs(world.grid.cellCenterZ(cell) - 5) < 40 && isTouched(world, cell)) {
      reach = Math.max(reach, offsetX);
    }
  }

  return reach;
}

function forestWorld(): WorldState {
  const world = createTestWorld({ ...LARGE_WORLD, biome: Biome.Forest, ground: Ground.Forest });

  plantInitialVegetation(world.vegetation, world.grid, world.terrain, 5);

  for (let cell = 0; cell < world.grid.cellCount; cell += 1) {
    world.refreshCanopy(cell);
  }

  return world;
}

describe("igniting", () => {
  it("lights dry ground and refuses water and snow", () => {
    const world = createTestWorld();

    const fire = new FireSystem(world);
    const cell = centerCell(world);

    floodCells(world, [cell + 1], 2);
    world.fields.snow[cell + 2] = 0.8;

    expect(fire.ignite(cell, 0.5)).toBe(true);
    expect(fire.ignite(cell + 1, 0.5)).toBe(false);
    expect(fire.ignite(cell + 2, 0.5)).toBe(false);
    expect(fire.burningCount).toBe(1);
  });

  it("refuses bare rock", () => {
    const world = createTestWorld({ ground: Ground.Rock });

    const fire = new FireSystem(world);

    expect(fire.ignite(centerCell(world), 0.5)).toBe(false);
  });
});

describe("spreading", () => {
  it("stays near the flames in calm grass", () => {
    const scenario = startFire(createTestWorld(LARGE_WORLD), 0);

    burnFor(scenario, 60);

    expect(reachTowards(scenario.world, 1)).toBeLessThan(60);
  });

  it("runs downwind through grass in a strong wind", () => {
    const scenario = startFire(createTestWorld(LARGE_WORLD), 30);

    burnFor(scenario, 60);

    expect(reachTowards(scenario.world, 1)).toBeGreaterThan(120);
    expect(reachTowards(scenario.world, -1)).toBeLessThan(40);
  });

  it("creeps through a forest even without wind", () => {
    const scenario = startFire(forestWorld(), 0);

    burnFor(scenario, 60);

    expect(reachTowards(scenario.world, 1)).toBeGreaterThan(20);
    expect(reachTowards(scenario.world, 1)).toBeLessThan(200);
  });

  it("spreads faster when the spread rule is raised", () => {
    const fastRules = worldRulesSchema.parse({ fire: { spreadSpeed: 2.5 } });
    const normal = startFire(createTestWorld(LARGE_WORLD), 20);
    const fast = startFire(createTestWorld(LARGE_WORLD), 20, fastRules);

    burnFor(normal, 40);
    burnFor(fast, 40, fastRules);

    expect(reachTowards(fast.world, 1)).toBeGreaterThan(reachTowards(normal.world, 1));
  });

  it("stops at a river", () => {
    const world = createTestWorld(LARGE_WORLD);

    const riverCells = world.grid.cellsInRadius(85, 5, 400).filter((cell) => {
      const x = world.grid.cellCenterX(cell);

      return x > 70 && x < 100;
    });

    floodCells(world, riverCells, 1.5);

    const scenario = startFire(world, 40);

    burnFor(scenario, 90);

    expect(reachTowards(world, 1)).toBeLessThan(100);
  });
});

describe("burning out", () => {
  it("leaves scorched ground behind", () => {
    const world = createTestWorld();

    const scenario = startFire(world, 0);

    burnFor(scenario, 90);

    expect(scenario.fire.burningCount).toBe(0);
    expect(world.fields.scorch[centerCell(world)]).toBeGreaterThan(0.9);
    expect(world.fields.fuel[centerCell(world)]).toBeLessThan(0.05);
  });

  it("burns the trees standing in the flames", () => {
    const world = createTestWorld();

    const cell = centerCell(world);

    const tree = plantInCell(world, cell, PlantSpecies.Pine);
    const scenario = startFire(world, 0);

    burnFor(scenario, 120);

    expect(world.vegetation.state[tree]).toBe(PlantState.Burnt);
  });

  it("goes out when doused", () => {
    const world = createTestWorld();

    const scenario = startFire(world, 0);

    for (const cell of scenario.fire.burningCells()) {
      scenario.fire.douse(cell, 1);
    }

    burnFor(scenario, 1);

    expect(scenario.fire.burningCount).toBe(0);
  });

  it("leaves ground as scorched as the share of fuel it burnt when doused early", () => {
    const world = forestWorld();

    const cell = world.initialCanopyFuel.indexOf(Math.max(...world.initialCanopyFuel));
    const startingFuel = groundDefinition(world.terrain.ground[cell]).fuel + world.initialCanopyFuel[cell];
    const scenario: FireScenario = { fire: new FireSystem(world), world };

    scenario.fire.ignite(cell, 0.45);
    burnFor(scenario, 4);
    scenario.fire.douse(cell, 1);
    burnFor(scenario, TICK_SECONDS);

    const fuelLeft = world.fields.fuel[cell] + world.canopyFuel[cell];

    expect(world.fields.fire[cell]).toBe(0);
    expect(world.fields.scorch[cell]).toBeGreaterThan(0);
    expect(world.fields.scorch[cell]).toBeLessThan(1);
    expect(world.fields.scorch[cell]).toBeCloseTo(1 - fuelLeft / startingFuel);
  });

  it("throws embers from burning crowns in the wind", () => {
    const emberRules = worldRulesSchema.parse({ fire: { embers: 3 } });
    const conditions = { airTemperatureOffset: 0, day: 1, drought: 0.6 };
    const random = createRandom(8);

    const scenario = startFire(forestWorld(), 40, emberRules);

    let embers = 0;

    for (let elapsed = 0; elapsed < 30; elapsed += TICK_SECONDS) {
      embers += scenario.fire.update(TICK_SECONDS, conditions, emberRules, random).length;
    }

    expect(embers).toBeGreaterThan(0);
  });
});
