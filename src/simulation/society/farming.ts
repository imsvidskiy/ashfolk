import {
  CROP_CODE_NONE,
  CROP_KINDS,
  CROPS,
  type CropKind,
  cropCode,
  FENCED_CROP_OFFSET,
  hasHarvestPassed,
  isHarvestSeason,
  isSowingTime,
} from "../../content/crops.ts";
import { Ground, groundDefinition } from "../../content/grounds.ts";
import { isWinter, SEASON_COUNT } from "../../content/seasons.ts";
import { FULL_TURN } from "../../shared/math.ts";
import { ORTHOGONAL_STEPS } from "../../world/world-grid.ts";
import { aroundPoint } from "../agents/navigation.ts";
import { NO_BUILDING, PLOT_GROUND, type WorldState } from "../world/world-state.ts";
import { isDryWay } from "./footprints.ts";
import type { SocietyContext } from "./society-context.ts";
import { type Field, knows, type Tribe } from "./tribe.ts";
import { campPoint } from "./tribe-places.ts";

const MAXIMUM_FIELDS = 12;
const FIELDS_PER_MEMBER = 0.5;
const FIRST_FIELDS = 2;
const PLOWED_FIELDS = 2;
const FIELD_ATTEMPTS = 40;
const FIELD_SLOPE = 0.3;
const FERTILE_GROUND = 0.4;
const NEAREST_FIELD = 34;
const FARTHEST_FIELD = 80;
const TENDED_GROWTH = 0.45;
const TENDING_DECAY = 0.5;
const SPROUT_DISPLAY = 0.04;

export type FieldTask = "harvest" | "sow" | "tend";

const TASK_PRIORITY: Readonly<Record<FieldTask, number>> = { harvest: 3, sow: 2, tend: 1 };

function knownCrops(tribe: Tribe): CropKind[] {
  return CROP_KINDS.filter((kind) => {
    return knows(tribe, CROPS[kind].technology);
  });
}

function wantedFields(tribe: Tribe): number {
  const plowed = knows(tribe, "ploughing") ? PLOWED_FIELDS : 0;

  return Math.min(MAXIMUM_FIELDS, FIRST_FIELDS + plowed + tribe.memberCount * FIELDS_PER_MEMBER);
}

function isFarmable(tribe: Tribe, cell: number, context: SocietyContext): boolean {
  const { world } = context;

  if (cell < 0 || !world.isWalkable(cell) || !world.canPlace(cell, FIELD_SLOPE) || world.isTrodden(cell)) {
    return false;
  }

  if (groundDefinition(world.terrain.ground[cell]).fertility < FERTILE_GROUND) {
    return false;
  }

  if (
    tribe.fields.some((field) => {
      return field.cell === cell;
    })
  ) {
    return false;
  }

  return isDryWay(world, campPoint(tribe), {
    x: world.grid.cellCenterX(cell),
    z: world.grid.cellCenterZ(cell),
  });
}

function besideExistingField(tribe: Tribe, context: SocietyContext): number | null {
  const { grid } = context.world;
  const { random } = context;

  if (tribe.fields.length === 0) {
    return null;
  }

  const field = random.pick(tribe.fields);
  const [columnStep, rowStep] = random.pick(ORTHOGONAL_STEPS);

  const column = grid.columnOf(field.cell) + columnStep;
  const row = grid.rowOf(field.cell) + rowStep;

  if (!grid.contains(column, row)) {
    return null;
  }

  return grid.index(column, row);
}

function anywhereNearCamp(tribe: Tribe, context: SocietyContext): number {
  const { random, world } = context;

  const spot = aroundPoint(campPoint(tribe), random.between(NEAREST_FIELD, FARTHEST_FIELD), random.next() * FULL_TURN);

  return world.grid.cellAt(spot.x, spot.z);
}

export function addFieldIfNeeded(tribe: Tribe, context: SocietyContext): void {
  if (!knows(tribe, "farming") || tribe.fields.length >= wantedFields(tribe)) {
    return;
  }

  for (let attempt = 0; attempt < FIELD_ATTEMPTS; attempt += 1) {
    const beside = besideExistingField(tribe, context);

    const cell = beside === null || attempt % 2 === 1 ? anywhereNearCamp(tribe, context) : beside;

    if (isFarmable(tribe, cell, context)) {
      openField(tribe, cell, context.world);

      return;
    }
  }
}

function openField(tribe: Tribe, cell: number, world: WorldState): void {
  const [crop] = knownCrops(tribe);

  if (crop === undefined) {
    return;
  }

  const field: Field = {
    cell,
    crop,
    growth: 0,
    isFenced: knows(tribe, "ploughing"),
    isSown: false,
    plantings: 0,
    previousGround: world.terrain.ground[cell],
    tending: 0,
  };

  world.clearPlants(cell, false);
  world.setGround(cell, Ground.Farm);
  world.occupancy[cell] = PLOT_GROUND;
  tribe.fields.push(field);
  showField(field, world);
}

function abandonField(field: Field, world: WorldState): void {
  world.setCrop(field.cell, 0);
  world.setCropCode(field.cell, CROP_CODE_NONE);

  if (world.terrain.ground[field.cell] === Ground.Farm) {
    world.setGround(field.cell, field.previousGround);
  }

  if (world.occupancy[field.cell] === PLOT_GROUND) {
    world.occupancy[field.cell] = NO_BUILDING;
  }
}

export function abandonFields(tribe: Tribe, world: WorldState): void {
  for (const field of tribe.fields) {
    abandonField(field, world);
  }

  tribe.fields = [];
}

function shownCode(field: Field): number {
  const fence = field.isFenced ? FENCED_CROP_OFFSET : 0;

  if (!field.isSown) {
    return fence;
  }

  return cropCode(field.crop) + fence;
}

function showField(field: Field, world: WorldState): void {
  const growth = field.isSown ? Math.max(SPROUT_DISPLAY, field.growth) : 0;

  world.setCrop(field.cell, growth);
  world.setCropCode(field.cell, shownCode(field));
}

function seasonsPassed(tribe: Tribe, season: number): number {
  const previous = tribe.timers.fieldSeason;

  tribe.timers.fieldSeason = season;

  if (previous < 0) {
    return 0;
  }

  return (season - previous + SEASON_COUNT) % SEASON_COUNT;
}

function growField(field: Field, seasons: number, season: number): void {
  if (!field.isSown) {
    return;
  }

  if (hasHarvestPassed(field.crop, season)) {
    field.isSown = false;
    field.growth = 0;

    return;
  }

  if (isWinter(season)) {
    return;
  }

  const rate = (1 + field.tending * TENDED_GROWTH) / CROPS[field.crop].growSeasons;

  field.growth = Math.min(1, field.growth + seasons * rate);
}

export function updateFields(tribe: Tribe, context: SocietyContext, days: number): void {
  const { season } = context.environment;
  const { world } = context;

  const seasons = seasonsPassed(tribe, season);
  const isFenced = knows(tribe, "ploughing");

  for (const field of tribe.fields) {
    growField(field, seasons, season);
    field.tending = Math.max(0, field.tending - days * TENDING_DECAY);
    field.isFenced = isFenced;
    showField(field, world);
  }
}

export function abandonFloodedFields(tribe: Tribe, world: WorldState): void {
  const flooded = tribe.fields.filter((field) => {
    return world.isWater(field.cell);
  });

  if (flooded.length === 0) {
    return;
  }

  for (const field of flooded) {
    abandonField(field, world);
  }

  tribe.fields = tribe.fields.filter((field) => {
    return !flooded.includes(field);
  });
}

function cropToSow(tribe: Tribe, field: Field, season: number): CropKind | null {
  const sowable = knownCrops(tribe).filter((kind) => {
    return isSowingTime(kind, season);
  });

  if (sowable.length === 0) {
    return null;
  }

  const fieldIndex = tribe.fields.indexOf(field);

  return sowable[(fieldIndex + field.plantings) % sowable.length];
}

export function fieldTask(tribe: Tribe, field: Field, season: number): FieldTask | null {
  if (field.isSown && field.growth >= 1 && isHarvestSeason(field.crop, season)) {
    return "harvest";
  }

  if (!field.isSown && cropToSow(tribe, field, season) !== null) {
    return "sow";
  }

  if (field.isSown && field.growth < 1 && !isWinter(season)) {
    return "tend";
  }

  return null;
}

export function neediestField(tribe: Tribe, season: number): Field | null {
  let neediest: Field | null = null;
  let neediestScore = Number.NEGATIVE_INFINITY;

  for (const field of tribe.fields) {
    const task = fieldTask(tribe, field, season);

    if (task === null) {
      continue;
    }

    const score = TASK_PRIORITY[task] - field.tending;

    if (score > neediestScore) {
      neediest = field;
      neediestScore = score;
    }
  }

  return neediest;
}

export function sowField(tribe: Tribe, field: Field, season: number): void {
  const crop = cropToSow(tribe, field, season);

  if (crop === null) {
    return;
  }

  field.crop = crop;
  field.isSown = true;
  field.growth = 0;
  field.plantings += 1;
  field.tending = 0.3;
}
