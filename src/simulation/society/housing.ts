import { BUILDINGS } from "../../content/buildings.ts";
import type { Building, BuildingSystem } from "./buildings.ts";
import type { Person } from "./person.ts";
import { BASE_HOUSING, type Tribe } from "./tribe.ts";
import { completedBuilding } from "./tribe-places.ts";

export function completedShelters(tribe: Tribe, buildings: BuildingSystem): Building[] {
  return tribe.buildings.shelterIds
    .map((shelterId) => {
      return completedBuilding(buildings, shelterId);
    })
    .filter((shelter) => {
      return shelter !== null;
    });
}

export function housingCapacity(tribe: Tribe, buildings: BuildingSystem): number {
  return completedShelters(tribe, buildings).reduce((capacity, shelter) => {
    return capacity + BUILDINGS[shelter.kind].capacity;
  }, BASE_HOUSING);
}

export function assignHomes(tribe: Tribe, buildings: BuildingSystem, members: readonly Person[]): void {
  const beds = completedShelters(tribe, buildings).flatMap((shelter) => {
    return Array.from({ length: BUILDINGS[shelter.kind].capacity }, () => {
      return shelter.id;
    });
  });

  for (const [index, person] of members.entries()) {
    person.homeId = bedAt(beds, index);
  }
}

function bedAt(beds: readonly number[], index: number): number | null {
  if (index >= beds.length) {
    return null;
  }

  return beds[index];
}
