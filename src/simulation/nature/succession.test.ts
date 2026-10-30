import { describe, expect, it } from "vitest";
import { Biome, type BiomeIndex } from "../../content/biomes.ts";
import { Ground, type GroundIndex } from "../../content/grounds.ts";
import { isLivingTreeSpecies, plantSpeciesDefinition } from "../../content/plants.ts";
import { DEFAULT_WORLD_RULES } from "../../content/world-rules.ts";
import { createRandom } from "../../shared/random.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { createVegetatedWorld } from "../testing/test-world.ts";
import { WorldState } from "../world/world-state.ts";
import { climaxOf } from "./succession.ts";
import { VegetationGrowthSystem } from "./vegetation-growth.ts";

const DAYS_PER_SEASON = 3;
const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;
const BURNT_RADIUS = 160;
const STEP_DAYS = 0.01;

interface Census {
  grownTrees: number;
  shrubs: number;
  youngTrees: number;
}

function burntForest(biome: BiomeIndex = Biome.Forest, ground: GroundIndex = Ground.Forest): WorldState {
  const world = new WorldState(createVegetatedWorld({ biome, dimensions: { cellSize: 10, cellsPerSide: 64 }, ground }));

  for (const cell of world.grid.cellsInRadius(0, 0, BURNT_RADIUS)) {
    world.vegetation.burnTreesInCell(cell, 0);
    world.clearPlants(cell, false);
    world.fields.scorch[cell] = 1;
    world.markDisturbed(cell, 0);
  }

  return world;
}

class Seasons {
  readonly #growth: VegetationGrowthSystem;
  readonly #random = createRandom(9);
  readonly #world: WorldState;
  #day = 0;

  constructor(world: WorldState) {
    this.#world = world;
    this.#growth = new VegetationGrowthSystem(world);
  }

  pass(days: number): void {
    const end = this.#day + days;

    for (; this.#day < end; this.#day += STEP_DAYS) {
      const season = (this.#day / DAYS_PER_SEASON) % 4;

      this.#growth.update(STEP_DAYS, { day: this.#day, season }, DEFAULT_WORLD_RULES, this.#random);
      fadeScorch(this.#world, STEP_DAYS);
    }
  }
}

function fadeScorch(world: WorldState, days: number): void {
  for (const cell of world.recovering.values()) {
    world.fields.scorch[cell] = Math.max(0, world.fields.scorch[cell] - 0.22 * days);
  }
}

function censusWithin(world: WorldState, radius: number): Census {
  const { grid, vegetation } = world;

  const census: Census = { grownTrees: 0, shrubs: 0, youngTrees: 0 };

  for (const cell of grid.cellsInRadius(0, 0, radius)) {
    for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
      const species = vegetation.species[plant];
      const definition = plantSpeciesDefinition(species);

      if (!vegetation.isAlive(plant)) {
        continue;
      }

      if (definition.form === "shrub") {
        census.shrubs += 1;
      } else if (isLivingTreeSpecies(species) && vegetation.height[plant] < definition.heightRange[0] * 0.6) {
        census.youngTrees += 1;
      } else if (isLivingTreeSpecies(species)) {
        census.grownTrees += 1;
      }
    }
  }

  return census;
}

function climaxTrees(world: WorldState, radius: number): number {
  return world.grid.cellsInRadius(0, 0, radius).reduce((total, cell) => {
    return total + climaxOf(world, cell).trees.length;
  }, 0);
}

describe("succession after a fire", () => {
  it("leaves the ash bare for a while, then brings bushes before young trees", () => {
    const world = burntForest();
    const seasons = new Seasons(world);

    seasons.pass(1.5);

    const ash = censusWithin(world, BURNT_RADIUS - 20);

    seasons.pass(2);

    const bushes = censusWithin(world, BURNT_RADIUS - 20);

    seasons.pass(3);

    const saplings = censusWithin(world, BURNT_RADIUS - 20);

    expect(ash).toEqual({ grownTrees: 0, shrubs: 0, youngTrees: 0 });
    expect(bushes.shrubs).toBeGreaterThan(0);
    expect(bushes.youngTrees).toBe(0);
    expect(saplings.youngTrees).toBeGreaterThan(0);
  });

  it("grows young trees into a forest within a few years", () => {
    const world = burntForest();
    const seasons = new Seasons(world);

    seasons.pass(DAYS_PER_YEAR);

    const firstYear = censusWithin(world, BURNT_RADIUS - 20);

    seasons.pass(DAYS_PER_YEAR * 3);

    const fourthYear = censusWithin(world, BURNT_RADIUS - 20);

    expect(firstYear.youngTrees).toBeGreaterThan(firstYear.grownTrees);
    expect(fourthYear.grownTrees).toBeGreaterThan(climaxTrees(world, BURNT_RADIUS - 20) * 0.75);
  });

  it("spreads in from the surviving forest at the edge", () => {
    const world = burntForest();

    new Seasons(world).pass(DAYS_PER_YEAR * 0.75);

    const edge = censusWithin(world, BURNT_RADIUS);
    const middle = censusWithin(world, BURNT_RADIUS - 60);

    const edgeTrees = edge.youngTrees - middle.youngTrees;
    const edgeArea = BURNT_RADIUS ** 2 - (BURNT_RADIUS - 60) ** 2;

    expect(edgeTrees / edgeArea).toBeGreaterThan((middle.youngTrees / (BURNT_RADIUS - 60) ** 2) * 1.5);
  });

  it("stands dead trees back at their full height", () => {
    const world = burntForest(Biome.Swamp, Ground.Swamp);
    const { grid, vegetation } = world;

    new Seasons(world).pass(DAYS_PER_YEAR * 0.6);

    const snags = grid.cellsInRadius(0, 0, BURNT_RADIUS - 20).flatMap((cell) => {
      const heights: number[] = [];

      for (
        let plant = vegetation.firstPlantInCell(cell);
        plant !== NO_PLANT;
        plant = vegetation.nextPlantInCell(plant)
      ) {
        if (vegetation.isAlive(plant) && plantSpeciesDefinition(vegetation.species[plant]).form === "deadwood") {
          heights.push(vegetation.height[plant]);
        }
      }

      return heights.map((height) => {
        return { cell, height };
      });
    });

    const fullHeights = snags.map(({ cell }) => {
      return climaxOf(world, cell)
        .trees.filter((placement) => {
          return plantSpeciesDefinition(placement.species).form === "deadwood";
        })
        .map((placement) => {
          return Math.fround(placement.height);
        });
    });

    expect(snags.length).toBeGreaterThan(0);
    expect(
      snags.every(({ height }, index) => {
        return fullHeights[index]?.includes(height);
      })
    ).toBe(true);
  });

  it("brings glades back open and stands back thin", () => {
    const world = burntForest();
    const { grid, terrain } = world;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      terrain.woodland[cell] = grid.cellCenterX(cell) < 0 ? 0 : 1;
    }

    new Seasons(world).pass(DAYS_PER_YEAR * 4);

    const glade = grid.cellsInRadius(0, 0, BURNT_RADIUS).filter((cell) => {
      return grid.cellCenterX(cell) < -10;
    });

    expect(
      glade.every((cell) => {
        return world.vegetation.countTreesInCell(cell) === 0;
      })
    ).toBe(true);
    expect(censusWithin(world, BURNT_RADIUS - 20).grownTrees).toBeGreaterThan(50);
  });

  it("brings bushes and young trees back three times sooner on ash soil", () => {
    const ash = burntForest(Biome.Forest, Ground.Ash);
    const forest = burntForest();

    ash.fields.scorch.fill(0);
    forest.fields.scorch.fill(0);

    const ashSeasons = new Seasons(ash);
    const forestSeasons = new Seasons(forest);

    ashSeasons.pass(1.6);
    forestSeasons.pass(1.6);

    const earlyAsh = censusWithin(ash, BURNT_RADIUS - 20);

    expect(earlyAsh.shrubs).toBeGreaterThan(0);
    expect(earlyAsh.youngTrees).toBeGreaterThan(0);
    expect(censusWithin(forest, BURNT_RADIUS - 20)).toEqual({ grownTrees: 0, shrubs: 0, youngTrees: 0 });

    ashSeasons.pass(0.4);
    forestSeasons.pass(4.4);

    const onAsh = censusWithin(ash, BURNT_RADIUS - 20);
    const onForest = censusWithin(forest, BURNT_RADIUS - 20);

    expect(onAsh.shrubs).toBeGreaterThan(onForest.shrubs * 0.85);
    expect(onAsh.youngTrees + onAsh.grownTrees).toBeGreaterThan((onForest.youngTrees + onForest.grownTrees) * 0.75);
  });

  it("regrows the same way for the same world", () => {
    const first = burntForest();
    const second = burntForest();

    new Seasons(first).pass(DAYS_PER_YEAR * 2);
    new Seasons(second).pass(DAYS_PER_YEAR * 2);

    expect(second.vegetation.exportBuffers()).toEqual(first.vegetation.exportBuffers());
  });
});
