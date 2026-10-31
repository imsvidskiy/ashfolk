import { BUILDINGS, type BuildingRole } from "../../content/buildings.ts";
import { type Building, isComplete } from "./buildings.ts";
import { walkSpeed } from "./person.ts";
import type { PersonTick } from "./society-context.ts";
import { knows, type Tribe } from "./tribe.ts";
import { completedBuilding, litCampfireOf, tribeBuildings } from "./tribe-places.ts";

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

function warmPlaces(tick: PersonTick): WarmPlace[] {
  const campfire = litCampfireOf(tick.tribe, tick.context.buildings);

  const hearths = tribeBuildings(tick.tribe, tick.context.buildings)
    .filter((building) => {
      return isComplete(building) && HEARTH_ROLES.has(BUILDINGS[building.kind].role);
    })
    .map((building) => {
      return {
        building,
        reach: BUILDINGS[building.kind].footprint + SHELTER_REACH,
        seat: BUILDINGS[building.kind].footprint + HEARTH_SEAT,
      };
    });

  if (campfire === null) {
    return hearths;
  }

  return [{ building: campfire, reach: FIRESIDE_RADIUS, seat: FIRESIDE_SEAT }, ...hearths];
}

function distanceTo(tick: PersonTick, place: WarmPlace): number {
  const { mover } = tick.person;

  return Math.hypot(mover.x - place.building.x, mover.z - place.building.z);
}

export function nearestWarmPlace(tick: PersonTick): WarmPlace | null {
  let nearest: WarmPlace | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const place of warmPlaces(tick)) {
    const distance = distanceTo(tick, place);

    if (distance < nearestDistance) {
      nearest = place;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function isSleepingAtHome(tick: PersonTick, isAsleep: boolean): boolean {
  const home = completedBuilding(tick.context.buildings, tick.person.homeId);

  if (!isAsleep || home === null) {
    return false;
  }

  return Math.hypot(tick.person.mover.x - home.x, tick.person.mover.z - home.z) < SLEEPING_RADIUS;
}

export function isSheltered(tick: PersonTick, isAsleep: boolean): boolean {
  if (isSleepingAtHome(tick, isAsleep)) {
    return true;
  }

  return warmPlaces(tick).some((place) => {
    return isWithinReach(tick, place);
  });
}

export function isWithinReach(tick: PersonTick, place: WarmPlace): boolean {
  return distanceTo(tick, place) < place.reach;
}

export function warmthOnArrival(tick: PersonTick, place: WarmPlace): number {
  const distance = Math.max(0, distanceTo(tick, place) - place.reach);
  const days = (distance * ROAD_SAFETY) / walkSpeed(tick.person) / tick.context.environment.daySeconds;

  return tick.person.warmth - chillPerDay(tick) * days;
}
