import { Biome, isBiomeIndex } from "../../content/biomes.ts";
import { groundDefinition } from "../../content/grounds.ts";
import { regrowingSpecies, TREE_SPACING } from "../../content/plants.ts";
import { isGrowingSeason } from "../../content/seasons.ts";
import type { WorldRules } from "../../content/world-rules.ts";
import { plantHeight } from "../../generation/vegetation.ts";
import { FULL_TURN } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import { NO_BUILDING, type WorldState } from "../world/world-state.ts";
import { Nursery, type NurserySnapshot } from "./nursery.ts";
import { Succession, type SuccessionSnapshot, TREE_GROWING_DAYS } from "./succession.ts";

export const SNAG_LIFETIME_DAYS = 4;

const REGROWTH_VISITS_PER_SQUARE_KILOMETER = 76.3;
const BERRY_UPDATE_DAYS = 0.05;
const SCORCH_BLOCKING_REGROWTH = 0.3;
const MEADOW_REGROWTH_CHANCE = 0.15;
const SPROUT_OFFSET_WITHIN_CELL = 0.35;
const REGROWING_BIOMES: ReadonlySet<number> = new Set([Biome.Forest, Biome.Swamp, Biome.Taiga]);

interface GrowthConditions {
  day: number;
  season: number;
}

export interface VegetationGrowthSnapshot {
  berryDays: number;
  nursery: NurserySnapshot;
  succession: SuccessionSnapshot;
  visitBudget: number;
}

function berryGrowthPerDay(season: number): number {
  if (season < 0.2) {
    return 0;
  }

  if (season < 2.4) {
    return 0.8;
  }

  if (season < 3) {
    return -0.2;
  }

  return -2;
}

function berryChange(season: number, days: number, rules: WorldRules): number {
  const growth = berryGrowthPerDay(season);

  if (growth <= 0) {
    return growth * days;
  }

  return growth * rules.nature.berryGrowth * days;
}

export class VegetationGrowthSystem {
  readonly #nursery: Nursery;
  readonly #succession: Succession;
  readonly #world: WorldState;
  #berryDays = 0;
  #visitBudget = 0;

  constructor(world: WorldState) {
    this.#world = world;
    this.#nursery = new Nursery(world);
    this.#succession = new Succession(world, this.#nursery);
  }

  snapshot(): VegetationGrowthSnapshot {
    return {
      berryDays: this.#berryDays,
      nursery: this.#nursery.snapshot(),
      succession: this.#succession.snapshot(),
      visitBudget: this.#visitBudget,
    };
  }

  restore(snapshot: VegetationGrowthSnapshot): void {
    this.#berryDays = snapshot.berryDays;
    this.#visitBudget = snapshot.visitBudget;
    this.#nursery.restore(snapshot.nursery);
    this.#succession.restore(snapshot.succession);
  }

  update(days: number, conditions: GrowthConditions, rules: WorldRules, random: RandomSource): void {
    this.#removeOldSnags(conditions.day);
    this.#regrow(days, conditions, rules, random);
    this.#berryDays += days;

    if (this.#berryDays < BERRY_UPDATE_DAYS) {
      return;
    }

    this.#world.vegetation.changeBerryFruit(berryChange(conditions.season, this.#berryDays, rules));
    this.#berryDays = 0;
  }

  #removeOldSnags(day: number): void {
    for (const index of this.#world.vegetation.takeBurntBefore(day - SNAG_LIFETIME_DAYS)) {
      this.#world.removePlant(index);
    }
  }

  #regrow(days: number, conditions: GrowthConditions, rules: WorldRules, random: RandomSource): void {
    const multiplier = rules.nature.forestRegrowth;

    if (multiplier <= 0 || !isGrowingSeason(conditions.season)) {
      return;
    }

    this.#nursery.grow(days * multiplier);
    this.#succession.update(days, conditions.day, multiplier);
    this.#visitBudget += days * REGROWTH_VISITS_PER_SQUARE_KILOMETER * this.#world.grid.squareKilometers * multiplier;

    while (this.#visitBudget >= 1) {
      this.#visitBudget -= 1;
      this.#tryToSprout(random.integer(0, this.#world.grid.cellCount), conditions.day, random);
    }
  }

  #tryToSprout(cell: number, day: number, random: RandomSource): void {
    const world = this.#world;

    if (!this.#canSprout(cell, random)) {
      return;
    }

    const biome = world.terrain.biome[cell];

    if (!isBiomeIndex(biome)) {
      return;
    }

    const candidates = regrowingSpecies(biome, world.terrain.baseTemperature[cell]);

    if (candidates.length === 0) {
      return;
    }

    const { grid } = world;

    const species = random.pick(candidates);

    if (!world.canGrowWild(cell, species)) {
      return;
    }

    const placement = {
      bornDay: day,
      height: plantHeight(species, random, 1),
      rotation: random.next() * FULL_TURN,
      seed: random.next(),
      species,
      x: grid.cellCenterX(cell) + random.between(-SPROUT_OFFSET_WITHIN_CELL, SPROUT_OFFSET_WITHIN_CELL) * grid.cellSize,
      z: grid.cellCenterZ(cell) + random.between(-SPROUT_OFFSET_WITHIN_CELL, SPROUT_OFFSET_WITHIN_CELL) * grid.cellSize,
    };

    if (world.vegetation.hasTreeWithin(placement.x, placement.z, TREE_SPACING)) {
      return;
    }

    this.#nursery.plant(placement, TREE_GROWING_DAYS);
  }

  #canSprout(cell: number, random: RandomSource): boolean {
    const world = this.#world;

    const biome = world.terrain.biome[cell];

    if (!world.isOpenGround(cell)) {
      return false;
    }

    if (world.occupancy[cell] !== NO_BUILDING || world.isBurning(cell) || world.recovering.has(cell)) {
      return false;
    }

    if (world.fields.scorch[cell] > SCORCH_BLOCKING_REGROWTH || world.vegetation.countTreesInCell(cell) > 0) {
      return false;
    }

    if (!groundDefinition(world.terrain.ground[cell]).holdsTrees) {
      return false;
    }

    if (REGROWING_BIOMES.has(biome)) {
      return true;
    }

    return biome === Biome.Meadow && random.chance(MEADOW_REGROWTH_CHANCE);
  }
}
