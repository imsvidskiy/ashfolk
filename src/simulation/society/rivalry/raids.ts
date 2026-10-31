import { BUILDINGS, type BuildingRole, isFlammable } from "../../../content/buildings.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import { type Building, isComplete } from "../buildings.ts";
import type { JobKind } from "../jobs/job.ts";
import { isChild, isElder, NEED_SECONDS, type Person } from "../person.ts";
import type { SocietySystem } from "../society.ts";
import type { Stock } from "../stock.ts";
import type { Tribe } from "../tribe.ts";
import type { Relation } from "./relations.ts";

export const MARCH_SPEED = 4.2;

const RATION_RELIEF = 0.55;
const RATION_HUNGER = 0.6;
const RAID_OVERHEAD_SECONDS = 160;
const TORCHED_ROLES: readonly BuildingRole[] = ["enclosure", "craft"];
const ABLE_HEALTH = 0.45;
const FIGHTING_HEALTH = 0.6;
const FIGHTING_HUNGER = 0.5;
const DEFENDING_HUNGER = 0.85;
const PARTY_SHARE = 0.5;
const SMALLEST_PARTY = 3;
const LARGEST_PARTY = 6;
const BURNING_STANDING = -50;
const STEADY_JOBS: ReadonlySet<JobKind> = new Set(["defend", "envoy", "fight", "flee", "hide", "raid"]);

export type RaidPhase = "assault" | "march" | "muster" | "retreat";

export type RaidAim = "burn" | "plunder" | "revenge";

export interface Raid {
  readonly aim: RaidAim;
  readonly attackerId: number;
  readonly burned: string[];
  readonly defenderId: number;
  readonly fallenDefenders: string[];
  readonly fallenRaiders: string[];
  readonly id: number;
  isAlarmRaised: boolean;
  readonly loot: Stock;
  phase: RaidPhase;
  phaseSeconds: number;
  readonly rally: Waypoint;
  readonly routedIds: Set<number>;
  readonly struckIds: Set<number>;
  readonly target: Waypoint;
  readonly warriorIds: readonly number[];
}

export function isBusy(person: Person): boolean {
  return person.job !== null && STEADY_JOBS.has(person.job.kind);
}

export function canFight(person: Person): boolean {
  return person.isAlive && !isChild(person) && !isElder(person) && person.health >= ABLE_HEALTH;
}

export function isFitToDefend(person: Person): boolean {
  return canFight(person) && person.hunger < DEFENDING_HUNGER;
}

function isFitForRaid(person: Person): boolean {
  return canFight(person) && person.health >= FIGHTING_HEALTH && person.hunger < FIGHTING_HUNGER;
}

export function rationsFor(distance: number, hungerRate: number): number {
  const seconds = (2 * distance) / MARCH_SPEED + RAID_OVERHEAD_SECONDS;

  return Math.ceil(((seconds / NEED_SECONDS) * hungerRate) / RATION_RELIEF);
}

export function eatRation(person: Person, rations: number): number {
  if (person.hunger < RATION_HUNGER || rations <= 0) {
    return rations;
  }

  person.hunger = Math.max(0, person.hunger - RATION_RELIEF);

  return rations - 1;
}

function partySize(ableCount: number): number {
  if (ableCount < SMALLEST_PARTY) {
    return 0;
  }

  return Math.min(LARGEST_PARTY, Math.max(SMALLEST_PARTY, Math.round(ableCount * PARTY_SHARE)));
}

function strongerFirst(first: Person, second: Person): number {
  if (first.health !== second.health) {
    return second.health - first.health;
  }

  return first.age - second.age;
}

export function chooseWarriors(members: readonly Person[]): Person[] {
  const able = members.filter((person) => {
    return isFitForRaid(person) && !isBusy(person);
  });

  return able.toSorted(strongerFirst).slice(0, partySize(able.length));
}

export function chooseAim(relation: Relation, canBurn: boolean): RaidAim {
  if (relation.lastGrudge === "blood") {
    return "revenge";
  }

  if (canBurn && relation.standing < BURNING_STANDING) {
    return "burn";
  }

  return "plunder";
}

export function livingRaiders(people: SocietySystem, raid: Raid): Person[] {
  const living: Person[] = [];

  for (const id of raid.warriorIds) {
    const person = people.findPerson(id);

    if (person?.isAlive === true) {
      living.push(person);
    }
  }

  return living;
}

export function lossShare(raid: Raid): number {
  return (raid.fallenRaiders.length + raid.routedIds.size) / raid.warriorIds.length;
}

export function burnableBuilding(buildings: readonly Building[], tribe: Tribe): Building | null {
  const standing = buildings.filter((building) => {
    return building.tribeId === tribe.id && isComplete(building) && isFlammable(building.kind);
  });

  for (const role of TORCHED_ROLES) {
    const target = standing.find((building) => {
      return BUILDINGS[building.kind].role === role;
    });

    if (target !== undefined) {
      return target;
    }
  }

  return null;
}

export function buildingName(building: Building): string {
  return BUILDINGS[building.kind].name.toLowerCase();
}
