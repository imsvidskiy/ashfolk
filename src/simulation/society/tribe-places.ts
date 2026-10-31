import { type BuildingKind, isLitCampfire } from "../../content/buildings.ts";
import { FULL_TURN } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import { aroundPoint, type Waypoint } from "../agents/navigation.ts";
import { type Building, type BuildingSystem, isComplete } from "./buildings.ts";
import type { Person } from "./person.ts";
import type { Tribe } from "./tribe.ts";

export const GOLDEN_ANGLE = 2.399;

const NEAREST_SLEEPER = 5;
const SLEEPING_RINGS = 4;
const SLEEPING_RING_GAP = 1.5;

export function campPoint(tribe: Tribe): Waypoint {
  return { x: tribe.campX, z: tribe.campZ };
}

export function campDistance(first: Tribe, second: Tribe): number {
  return Math.hypot(first.campX - second.campX, first.campZ - second.campZ);
}

export function nearCamp(tribe: Tribe, spread: number, random: RandomSource): Waypoint {
  return { x: tribe.campX + random.signed() * spread, z: tribe.campZ + random.signed() * spread };
}

export function campfireOf(tribe: Tribe, buildings: BuildingSystem): Building | null {
  return buildings.find(tribe.buildings.campfireId);
}

export function litCampfireOf(tribe: Tribe, buildings: BuildingSystem): Building | null {
  const campfire = campfireOf(tribe, buildings);

  if (campfire === null || !isLitCampfire(campfire)) {
    return null;
  }

  return campfire;
}

export function completedBuilding(buildings: BuildingSystem, id: number | null): Building | null {
  const building = buildings.find(id);

  if (building === null || !isComplete(building)) {
    return null;
  }

  return building;
}

export function tribeBuildings(tribe: Tribe, buildings: BuildingSystem): Building[] {
  const { campfireId, shelterIds, storehouseId, structureIds, totemId } = tribe.buildings;

  const found: Building[] = [];

  collectBuilding(buildings, campfireId, found);
  collectBuilding(buildings, storehouseId, found);
  collectBuilding(buildings, totemId, found);

  for (const shelterId of shelterIds) {
    collectBuilding(buildings, shelterId, found);
  }

  for (const structureId of structureIds) {
    collectBuilding(buildings, structureId, found);
  }

  return found;
}

function collectBuilding(buildings: BuildingSystem, id: number | null, found: Building[]): void {
  const building = buildings.find(id);

  if (building !== null) {
    found.push(building);
  }
}

export function completedOfKind(tribe: Tribe, buildings: BuildingSystem, kind: BuildingKind): Building | null {
  const building = tribeBuildings(tribe, buildings).find((candidate) => {
    return candidate.kind === kind && isComplete(candidate);
  });

  if (building === undefined) {
    return null;
  }

  return building;
}

export function sleepingSpot(person: Person, tribe: Tribe, buildings: BuildingSystem, random: RandomSource): Waypoint {
  const home = completedBuilding(buildings, person.homeId);

  if (home !== null) {
    return { x: home.x + random.signed(), z: home.z + random.signed() };
  }

  const angle = (person.id * GOLDEN_ANGLE) % FULL_TURN;
  const distance = NEAREST_SLEEPER + (person.id % SLEEPING_RINGS) * SLEEPING_RING_GAP;
  const center = fireOrCamp(tribe, buildings);

  return aroundPoint(center, distance, angle);
}

function fireOrCamp(tribe: Tribe, buildings: BuildingSystem): Waypoint {
  const campfire = litCampfireOf(tribe, buildings);

  if (campfire === null) {
    return campPoint(tribe);
  }

  return { x: campfire.x, z: campfire.z };
}
