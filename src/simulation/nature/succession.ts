import { isBiomeIndex } from "../../content/biomes.ts";
import { groundDefinition } from "../../content/grounds.ts";
import {
  canGrowAt,
  isLivingTreeSpecies,
  isShrubSpecies,
  isTreeSpecies,
  PLANTING_RULES,
  plantSpeciesDefinition,
  TREE_SPACING,
} from "../../content/plants.ts";
import { clearingAt, plantingChance } from "../../generation/vegetation.ts";
import { FULL_TURN, hashToUnit, lerp } from "../../shared/math.ts";
import { createRandom, type RandomSource, type RandomState } from "../../shared/random.ts";
import { NO_PLANT, type PlantPlacement } from "../../world/vegetation-store.ts";
import { NO_BUILDING, type WorldState } from "../world/world-state.ts";
import type { Nursery } from "./nursery.ts";

export const TREE_GROWING_DAYS = 14;

const SHRUB_GROWING_DAYS = 3;
const VISITS_PER_CELL_PER_DAY = 2;
const SHRUB_DELAY_DAYS = 2;
const TREE_DELAY_DAYS = 4;
const SHRUB_SCORCH = 0.55;
const TREE_SCORCH = 0.25;
const SHRUB_CHANCE = 0.3;
const NEAR_SEEDING = 0.25;
const FAR_SEEDING = 0.05;
const SEED_REACH_CELLS = 4;
const SEED_BEARING_DAYS = 8;
const LONGEST_RECOVERY_DAYS = 72;
const CLIMAX_SALT = 61.7;
const SPREAD_WITHIN_CELL = 0.8;

interface Climax {
  readonly shrubs: readonly PlantPlacement[];
  readonly trees: readonly PlantPlacement[];
}

const BARE_CLIMAX: Climax = { shrubs: [], trees: [] };

interface Cover {
  shrubs: number;
  trees: number;
}

export interface SuccessionSnapshot {
  random: RandomState;
  visitBudget: number;
}

function coverOf(world: WorldState, cell: number): Cover {
  const { vegetation } = world;

  const cover: Cover = { shrubs: 0, trees: 0 };

  for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
    if (!vegetation.isAlive(plant)) {
      continue;
    }

    if (isTreeSpecies(vegetation.species[plant])) {
      cover.trees += 1;
    } else if (isShrubSpecies(vegetation.species[plant])) {
      cover.shrubs += 1;
    }
  }

  return cover;
}

export function climaxOf(world: WorldState, cell: number): Climax {
  const { grid, terrain } = world;

  const biome = terrain.biome[cell];

  if (!isBiomeIndex(biome)) {
    return BARE_CLIMAX;
  }

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const temperature = terrain.baseTemperature[cell];
  const clearing = clearingAt(terrain, cell);
  const { holdsTrees } = groundDefinition(terrain.ground[cell]);

  const shrubs: PlantPlacement[] = [];
  const trees: PlantPlacement[] = [];

  for (const [ruleIndex, rule] of PLANTING_RULES[biome].entries()) {
    const { form, heightRange } = plantSpeciesDefinition(rule.species);

    const salt = CLIMAX_SALT + ruleIndex * 7;

    if (form === "stone" || !canGrowAt(rule, temperature)) {
      continue;
    }

    if (hashToUnit(column, row, salt) >= plantingChance(rule, clearing, holdsTrees)) {
      continue;
    }

    if (!world.canGrowWild(cell, rule.species)) {
      continue;
    }

    const placement: PlantPlacement = {
      bornDay: 0,
      height: lerp(heightRange[0], heightRange[1], hashToUnit(column, row, salt + 1)) * rule.heightScale,
      rotation: hashToUnit(column, row, salt + 2) * FULL_TURN,
      seed: hashToUnit(column, row, salt + 3),
      species: rule.species,
      x: grid.centerX(column) + (hashToUnit(column, row, salt + 4) - 0.5) * SPREAD_WITHIN_CELL * grid.cellSize,
      z: grid.centerZ(row) + (hashToUnit(column, row, salt + 5) - 0.5) * SPREAD_WITHIN_CELL * grid.cellSize,
    };

    if (isTreeSpecies(rule.species)) {
      trees.push(placement);
    } else {
      shrubs.push(placement);
    }
  }

  return { shrubs, trees };
}

export class Succession {
  readonly #nursery: Nursery;
  readonly #random: RandomSource;
  readonly #world: WorldState;
  #visitBudget = 0;

  constructor(world: WorldState, nursery: Nursery) {
    this.#world = world;
    this.#nursery = nursery;
    this.#random = createRandom(world.seed * 19 + 11);
  }

  snapshot(): SuccessionSnapshot {
    return { random: this.#random.state(), visitBudget: this.#visitBudget };
  }

  restore(snapshot: SuccessionSnapshot): void {
    this.#random.restore(snapshot.random);
    this.#visitBudget = snapshot.visitBudget;
  }

  update(days: number, day: number, pace: number): void {
    const { recovering } = this.#world;

    if (recovering.size === 0) {
      return;
    }

    this.#visitBudget += days * recovering.size * VISITS_PER_CELL_PER_DAY * pace;

    const recovered = new Set<number>();

    while (this.#visitBudget >= 1) {
      this.#visitBudget -= 1;

      const cell = recovering.values()[this.#random.integer(0, recovering.size)];

      if (this.#visit(cell, day)) {
        recovered.add(cell);
      }
    }

    if (recovered.size > 0) {
      recovering.retain((cell) => {
        return !recovered.has(cell);
      });
    }
  }

  #visit(cell: number, day: number): boolean {
    const world = this.#world;

    if (!world.isOnIsland(cell) || world.isWater(cell)) {
      return true;
    }

    const { regrowth } = groundDefinition(world.terrain.ground[cell]);
    const age = (day - world.disturbedDay[cell]) * regrowth;

    if (age > LONGEST_RECOVERY_DAYS) {
      return true;
    }

    if (age < SHRUB_DELAY_DAYS || world.isBurning(cell) || world.occupancy[cell] !== NO_BUILDING) {
      return false;
    }

    const climax = climaxOf(world, cell);
    const cover = coverOf(world, cell);
    const scorch = world.fields.scorch[cell];

    if (cover.shrubs < climax.shrubs.length && scorch <= SHRUB_SCORCH && this.#random.chance(SHRUB_CHANCE * regrowth)) {
      this.#nursery.plant({ ...climax.shrubs[cover.shrubs], bornDay: day }, SHRUB_GROWING_DAYS);
    }

    const isTreeTime = age >= TREE_DELAY_DAYS && scorch <= TREE_SCORCH;
    const nextTree = climax.trees.at(cover.trees);
    const hasRoomForTree =
      nextTree !== undefined && !world.vegetation.hasTreeWithin(nextTree.x, nextTree.z, TREE_SPACING);

    if (hasRoomForTree && isTreeTime && this.#random.chance(this.#seedingChance(cell, day) * regrowth)) {
      this.#plantTree({ ...nextTree, bornDay: day });
    }

    return !hasRoomForTree && cover.shrubs >= climax.shrubs.length && scorch <= 0;
  }

  #plantTree(placement: PlantPlacement): void {
    if (isLivingTreeSpecies(placement.species)) {
      this.#nursery.plant(placement, TREE_GROWING_DAYS);

      return;
    }

    this.#world.plant(placement);
  }

  #seedingChance(cell: number, day: number): number {
    return this.#hasSeedTreeNear(cell, day) ? NEAR_SEEDING : FAR_SEEDING;
  }

  #hasSeedTreeNear(cell: number, day: number): boolean {
    const { grid, vegetation } = this.#world;

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (let rowOffset = -SEED_REACH_CELLS; rowOffset <= SEED_REACH_CELLS; rowOffset += 1) {
      for (let columnOffset = -SEED_REACH_CELLS; columnOffset <= SEED_REACH_CELLS; columnOffset += 1) {
        if (!grid.contains(column + columnOffset, row + rowOffset)) {
          continue;
        }

        const neighbor = grid.index(column + columnOffset, row + rowOffset);

        for (
          let plant = vegetation.firstPlantInCell(neighbor);
          plant !== NO_PLANT;
          plant = vegetation.nextPlantInCell(plant)
        ) {
          const isSeedTree = vegetation.isAlive(plant) && isLivingTreeSpecies(vegetation.species[plant]);

          if (isSeedTree && vegetation.bornDay[plant] <= day - SEED_BEARING_DAYS) {
            return true;
          }
        }
      }
    }

    return false;
  }
}
