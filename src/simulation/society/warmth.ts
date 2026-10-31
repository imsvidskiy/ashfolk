import { BUILDINGS, type BuildingRole, isLitCampfire } from "../../content/buildings.ts";
import { type Building, isComplete } from "./buildings.ts";
import { tribeBuildings } from "./camp-plan.ts";
import { walkSpeed } from "./person.ts";
import type { PersonTick } from "./society-context.ts";
import { knows, type Tribe } from "./tribe.ts";
import { completedBuilding } from "./tribe-places.ts";

const COMFORTABLE_TEMPERATURE = 9;
const WET_COLD_FACTOR = 1.4;
const WET_WEATHER = 0.3;
const CHILL_RATE = 0.11;
const DEFAULT_TEMPERATURE = 10;
const FIRESIDE_RADIUS = 15;
const SHELTER_REACH = 3;
const SLEEPING_RADIUS = 6;
const HIDE_CLOTHING = 0.85;
const WOVEN_CLOTHING = 0.6;
const ROAD_SAFETY = 1.6;
const FIRESIDE_SEAT = 5;
const HEARTH_SEAT = 1.5;
const HEARTH_ROLES: ReadonlySet<BuildingRole> = new Set(["craft", "dwelling", "store"]);

export interface WarmPlace {
  readonly building: Building;
  readonly reach: number;
  readonly seat: number;
}

function clothing(tribe: Tribe): number {
  if (knows(tribe, "weaving")) {
    return WOVEN_CLOTHING;
  }

  if (knows(tribe, "shelter")) {
    return HIDE_CLOTHING;
  }

  return 1;
}

function temperatureAround(tick: PersonTick): number {
  const { environment, world } = tick.context;

  const cell = world.grid.cellAt(tick.person.mover.x, tick.person.mover.z);

  if (cell < 0) {
    return DEFAULT_TEMPERATURE;
  }

  return world.temperature(cell, environment.airTemperatureOffset);
}

export function chillPerDay(tick: PersonTick): number {
  const { environment } = tick.context;

  const wetness = environment.precipitation > WET_WEATHER ? WET_COLD_FACTOR : 1;
  const coldness = Math.max(0, COMFORTABLE_TEMPERATURE - temperatureAround(tick)) * wetness;

  return coldness * CHILL_RATE * clothing(tick.tribe);
}

function isHearth(building: Building): boolean {
  return isComplete(building) && HEARTH_ROLES.has(BUILDINGS[building.kind].role);
}

function warmReach(building: Building): number {
  if (isLitCampfire(building)) {
    return FIRESIDE_RADIUS;
  }

  if (!isHearth(building)) {
    return 0;
  }

  return BUILDINGS[building.kind].footprint + SHELTER_REACH;
}

function warmSeat(building: Building): number {
  if (isLitCampfire(building)) {
    return FIRESIDE_SEAT;
  }

  return BUILDINGS[building.kind].footprint + HEARTH_SEAT;
}

function distanceTo(tick: PersonTick, building: Building): number {
  const { mover } = tick.person;

  return Math.hypot(mover.x - building.x, mover.z - building.z);
}

export function nearestWarmPlace(tick: PersonTick): WarmPlace | null {
  let nearest: WarmPlace | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const building of tribeBuildings(tick.tribe, tick.context)) {
    const reach = warmReach(building);
    const distance = distanceTo(tick, building);

    if (reach > 0 && distance < nearestDistance) {
      nearest = { building, reach, seat: warmSeat(building) };
      nearestDistance = distance;
    }
  }

  return nearest;
}

function isSleepingAtHome(tick: PersonTick, isAsleep: boolean): boolean {
  if (!isAsleep) {
    return false;
  }

  const home = completedBuilding(tick.context.buildings, tick.person.homeId);

  if (home === null) {
    return false;
  }

  return distanceTo(tick, home) < SLEEPING_RADIUS;
}

function isWarmedBy(tick: PersonTick, id: number | null): boolean {
  const building = tick.context.buildings.find(id);

  return building !== null && distanceTo(tick, building) < warmReach(building);
}

function isWarmedByAny(tick: PersonTick, ids: readonly number[]): boolean {
  for (const id of ids) {
    if (isWarmedBy(tick, id)) {
      return true;
    }
  }

  return false;
}

export function isSheltered(tick: PersonTick, isAsleep: boolean): boolean {
  if (isSleepingAtHome(tick, isAsleep)) {
    return true;
  }

  const { campfireId, shelterIds, storehouseId, structureIds, totemId } = tick.tribe.buildings;

  return (
    isWarmedBy(tick, campfireId) ||
    isWarmedBy(tick, storehouseId) ||
    isWarmedBy(tick, totemId) ||
    isWarmedByAny(tick, shelterIds) ||
    isWarmedByAny(tick, structureIds)
  );
}

export function isWithinReach(tick: PersonTick, place: WarmPlace): boolean {
  return distanceTo(tick, place.building) < place.reach;
}

export function warmthOnArrival(tick: PersonTick, place: WarmPlace): number {
  const distance = Math.max(0, distanceTo(tick, place.building) - place.reach);
  const days = (distance * ROAD_SAFETY) / walkSpeed(tick.person) / tick.context.environment.daySeconds;

  return tick.person.warmth - chillPerDay(tick) * days;
}
