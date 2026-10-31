import { describe, expect, it } from "vitest";
import { Biome } from "../../content/biomes.ts";
import { Ground } from "../../content/grounds.ts";
import { PlantSpecies } from "../../content/plants.ts";
import { DEFAULT_WORLD_RULES, type WorldRules, worldRulesSchema } from "../../content/world-rules.ts";
import { createRandom } from "../../shared/random.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import {
  centerCell,
  createTestWorld,
  monumentAround,
  plantInCell,
  plantsTooSteep,
  steepeningRamp,
} from "../testing/test-world.ts";
import type { WorldState } from "../world/world-state.ts";
import { SNAG_LIFETIME_DAYS, VegetationGrowthSystem } from "./vegetation-growth.ts";

const SUMMER = 1.2;
const WINTER = 3.5;
const FAST_REGROWTH = worldRulesSchema.parse({ nature: { forestRegrowth: 3 } });
const NO_REGROWTH = worldRulesSchema.parse({ nature: { forestRegrowth: 0 } });

interface GrowthPeriod {
  days: number;
  firstDay: number;
  rules: WorldRules;
  season: number;
}

function growFor(world: WorldState, period: Partial<GrowthPeriod>): void {
  const { days, firstDay, rules, season }: GrowthPeriod = {
    days: 1,
    firstDay: 10,
    rules: DEFAULT_WORLD_RULES,
    season: SUMMER,
    ...period,
  };

  const growth = new VegetationGrowthSystem(world);
  const random = createRandom(6);
  const step = 0.01;

  for (let elapsed = 0; elapsed < days; elapsed += step) {
    growth.update(step, { day: firstDay + elapsed, season }, rules, random);
  }
}

describe("berries", () => {
  it("fill the bushes over a summer day", () => {
    const world = createTestWorld();

    const bush = plantInCell(world, centerCell(world), PlantSpecies.Bush);

    world.vegetation.setFruit(bush, 0);
    growFor(world, { season: SUMMER });

    expect(world.vegetation.fruit[bush]).toBeGreaterThan(0.7);
  });

  it("report their fruit in plant order", () => {
    const world = createTestWorld();
    const { vegetation } = world;

    const oaks = [10, 20, 30].map((column) => {
      return plantInCell(world, world.grid.index(column, 30), PlantSpecies.Oak);
    });
    const firstBush = plantInCell(world, world.grid.index(40, 30), PlantSpecies.Bush);

    vegetation.remove(oaks[0]);
    vegetation.remove(oaks[2]);

    const bushes = [
      firstBush,
      ...[50, 60].map((column) => {
        return plantInCell(world, world.grid.index(column, 30), PlantSpecies.Bush);
      }),
    ];

    for (const bush of bushes) {
      vegetation.setFruit(bush, 0);
    }

    vegetation.discardChanges();
    growFor(world, { days: 0.4, rules: NO_REGROWTH });

    expect(vegetation.takeChanges()?.indices).toEqual(
      Int32Array.from(
        [...bushes].sort((first, second) => {
          return first - second;
        })
      )
    );
    expect(bushes).not.toEqual(
      [...bushes].sort((first, second) => {
        return first - second;
      })
    );
  });

  it("disappear in winter", () => {
    const world = createTestWorld();

    const bush = plantInCell(world, centerCell(world), PlantSpecies.Bush);

    growFor(world, { season: WINTER });

    expect(world.vegetation.fruit[bush]).toBe(0);
  });
});

describe("snags", () => {
  it("fall a few days after the fire", () => {
    const world = createTestWorld();

    const cell = centerCell(world);
    const tree = plantInCell(world, cell, PlantSpecies.Oak);

    world.vegetation.burnTreesInCell(cell, 10);
    growFor(world, { days: SNAG_LIFETIME_DAYS - 1, firstDay: 10, rules: NO_REGROWTH });

    expect(world.vegetation.state[tree]).toBe(PlantState.Burnt);

    growFor(world, { days: 2, firstDay: 10 + SNAG_LIFETIME_DAYS - 1, rules: NO_REGROWTH });

    expect(world.vegetation.state[tree]).toBe(PlantState.Removed);
  });
});

describe("regrowth", () => {
  it("brings trees back to open forest land", () => {
    const world = createTestWorld({ biome: Biome.Forest, ground: Ground.Forest });

    growFor(world, { days: 2, rules: FAST_REGROWTH });

    expect(world.vegetation.aliveCount).toBeGreaterThan(10);
  });

  it("does nothing when regrowth is turned off or in winter", () => {
    const stopped = createTestWorld({ biome: Biome.Forest, ground: Ground.Forest });
    const frozen = createTestWorld({ biome: Biome.Forest, ground: Ground.Forest });

    growFor(stopped, { days: 2, rules: NO_REGROWTH });
    growFor(frozen, { days: 2, season: WINTER });

    expect(stopped.vegetation.aliveCount).toBe(0);
    expect(frozen.vegetation.aliveCount).toBe(0);
  });

  it("regrows each tree only on ground gentle enough for it", () => {
    const world = createTestWorld({ biome: Biome.Forest, ground: Ground.Forest, heightAt: steepeningRamp(1.4, 320) });

    growFor(world, { days: 128, rules: FAST_REGROWTH });

    const slopes = Array.from({ length: world.vegetation.count }, (_, plant) => {
      return world.slope(world.vegetation.cell[plant]);
    });

    expect(world.vegetation.aliveCount).toBeGreaterThan(400);
    expect(Math.max(...slopes)).toBeGreaterThan(0.6);
    expect(plantsTooSteep(world)).toEqual([]);
  });

  it("leaves glades open and lets thin stands grow back thin", () => {
    const world = createTestWorld({ biome: Biome.Forest, ground: Ground.Forest });
    const { grid, terrain, vegetation } = world;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      terrain.woodland[cell] = grid.cellCenterX(cell) < 0 ? 0 : 0.5;
    }

    growFor(world, { days: 192, rules: FAST_REGROWTH });

    const columns = Array.from({ length: vegetation.count }, (_, plant) => {
      return grid.columnOf(vegetation.cell[plant]);
    });
    const thinCells = grid.cellCount / 2;

    expect(
      columns.every((column) => {
        return column >= grid.cellsPerSide / 2;
      })
    ).toBe(true);
    expect(vegetation.aliveCount).toBeGreaterThan(thinCells * 0.3);
    expect(vegetation.aliveCount).toBeLessThan(thinCells * 0.65);
  });

  it("never regrows trees on monument ground", () => {
    const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });
    const ruin = monumentAround(grid, 0, 0, 60);
    const world = createTestWorld({ biome: Biome.Forest, ground: Ground.Forest, monuments: [ruin] });

    growFor(world, { days: 128, rules: FAST_REGROWTH });

    const onRuin = Array.from({ length: world.vegetation.count }, (_, plant) => {
      return world.vegetation.cell[plant];
    }).filter((cell) => {
      return world.isObstructed(cell);
    });

    expect(world.vegetation.aliveCount).toBeGreaterThan(400);
    expect(onRuin).toEqual([]);
  });

  it("keeps trees off sandy banks", () => {
    const world = createTestWorld({ biome: Biome.Forest, ground: Ground.Sand });

    growFor(world, { days: 2, rules: FAST_REGROWTH });

    expect(world.vegetation.aliveCount).toBe(0);
  });

  it("does not sprout on scorched ground", () => {
    const world = createTestWorld({ biome: Biome.Forest, ground: Ground.Forest });

    world.fields.scorch.fill(1);
    growFor(world, { days: 2, rules: FAST_REGROWTH });

    expect(world.vegetation.aliveCount).toBe(0);
  });
});
