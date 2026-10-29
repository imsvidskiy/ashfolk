import { BUILDINGS, type BuildingRole, isFlammable } from "../../../content/buildings.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import { type Building, isComplete } from "../buildings.ts";
import { isChild, isElder, NEED_SECONDS, type Person } from "../person.ts";
import type { SocietySystem } from "../society.ts";
import type { Stock } from "../stock.ts";
import type { Tribe } from "../tribe.ts";
import { goodsPhrases } from "./provisions.ts";

export const MARCH_SPEED = 4.2;

const RATION_RELIEF = 0.55;
const RATION_HUNGER = 0.6;
const RAID_OVERHEAD_SECONDS = 160;
const LISTED_GOODS = 3;
const TORCHED_ROLES: readonly BuildingRole[] = ["enclosure", "craft"];
const FIGHTING_HEALTH = 0.6;
const FIGHTING_HUNGER = 0.5;
const DEFENDING_HUNGER = 0.85;
const PARTY_SHARE = 0.5;
const SMALLEST_PARTY = 3;
const LARGEST_PARTY = 6;
const NUMBER_WORDS: readonly string[] = ["no one", "one", "two", "three", "four", "five", "six", "seven", "eight"];

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

export function canFight(person: Person): boolean {
  return person.isAlive && !isChild(person) && !isElder(person) && person.health >= 0.45;
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
    return isFitForRaid(person) && person.job?.kind !== "flee";
  });

  return able.toSorted(strongerFirst).slice(0, partySize(able.length));
}

export function chooseAim(isAvengingBlood: boolean, canBurn: boolean, bitterness: number): RaidAim {
  if (isAvengingBlood) {
    return "revenge";
  }

  if (canBurn && bitterness > 0.5) {
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
  return (raid.fallenRaiders.length + raid.routedIds.size) / Math.max(1, raid.warriorIds.length);
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

function numberWord(count: number): string {
  const word = NUMBER_WORDS[count];

  if (word === undefined) {
    return String(count);
  }

  return word;
}

function namesOrCount(names: readonly string[]): string {
  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return numberWord(names.length);
}

function lootPhrase(loot: Stock): string | null {
  const goods = goodsPhrases(loot).slice(0, LISTED_GOODS);

  if (goods.length === 0) {
    return null;
  }

  return `carried off ${listed(goods)}`;
}

function listed(items: readonly string[]): string {
  if (items.length < 2) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function theTribe(name: string): string {
  return `the ${name}`;
}

export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function raidSummary(raid: Raid, attacker: string, defender: string): string {
  const outcomes: string[] = [];
  const plunder = lootPhrase(raid.loot);

  if (raid.fallenDefenders.length > 0) {
    outcomes.push(`${namesOrCount(raid.fallenDefenders)} fell`);
  }

  for (const building of raid.burned) {
    outcomes.push(`the ${building} was set ablaze`);
  }

  if (plunder !== null) {
    outcomes.push(plunder);
  }

  const losses = raid.fallenRaiders.length > 0 ? `, losing ${namesOrCount(raid.fallenRaiders)} of their own` : "";

  if (outcomes.length === 0) {
    return capitalized(`${theTribe(defender)} drove off a raid by ${theTribe(attacker)}${losses}`);
  }

  return capitalized(`${theTribe(attacker)} raided ${theTribe(defender)}: ${outcomes.join(", ")}${losses}`);
}

export function buildingName(building: Building): string {
  return BUILDINGS[building.kind].name.toLowerCase();
}
