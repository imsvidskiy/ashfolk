import { ADULT_AGE, ELDER_AGE } from "../../content/life-stages.ts";
import { isFoodKind, type ResourceKind } from "../../content/resources.ts";
import type { ToolMaterial, WeaponKind } from "../../content/weapons.ts";
import { FULL_TURN } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import type { CarriedItem, PersonPose } from "../../world/agent-poses.ts";
import { createMover, type Mover } from "../agents/movement.ts";
import type { Job } from "./jobs/job.ts";

export const YEARS_PER_DAY = 1;
export const NEED_SECONDS = 240;

const SHORTEST_LIFESPAN = 38;
const LIFESPAN_VARIATION = 22;
const CHILD_WALK_SPEED = 2;
const ELDER_WALK_SPEED = 1.8;
const ADULT_WALK_SPEED = 2.5;
const CHILD_RUN_SPEED = 3.8;
const ADULT_RUN_SPEED = 5.2;

export type DeathCause =
  | "age"
  | "battle"
  | "beast"
  | "blast"
  | "cold"
  | "earthquake"
  | "fire"
  | "gravity"
  | "hunger"
  | "lava"
  | "lightning"
  | "mammoth"
  | "tornado";

interface Carrying {
  amount: number;
  item: CarriedItem;
  resource: ResourceKind | null;
}

export interface Weapon {
  kind: WeaponKind;
  material: ToolMaterial;
}

export interface Person {
  age: number;
  appearanceSeed: number;
  carrying: Carrying;
  causeOfDeath: DeathCause | null;
  dangerCheckSeconds: number;
  deathSeconds: number;
  energy: number;
  health: number;
  homeId: number | null;
  hunger: number;
  id: number;
  isAlive: boolean;
  isFemale: boolean;
  job: Job | null;
  lastBirthDay: number;
  lifespan: number;
  mover: Mover;
  name: string;
  phase: number;
  pose: PersonPose;
  rethinkSeconds: number;
  speed: number;
  strandedDay: number;
  tribeId: number;
  warmth: number;
  weapon: Weapon | null;
}

interface PersonBirth {
  age: number;
  id: number;
  isFemale: boolean;
  name: string;
  tribeId: number;
  x: number;
  z: number;
}

export function createPerson(birth: PersonBirth, random: RandomSource): Person {
  return {
    age: birth.age,
    appearanceSeed: random.next(),
    carrying: { amount: 0, item: "nothing", resource: null },
    causeOfDeath: null,
    dangerCheckSeconds: random.next(),
    deathSeconds: 0,
    energy: 0.9,
    health: 1,
    homeId: null,
    hunger: random.between(0.15, 0.35),
    id: birth.id,
    isAlive: true,
    isFemale: birth.isFemale,
    job: null,
    lastBirthDay: Number.NEGATIVE_INFINITY,
    lifespan: SHORTEST_LIFESPAN + random.next() * LIFESPAN_VARIATION,
    mover: createMover(birth.x, birth.z, random.next() * FULL_TURN),
    name: birth.name,
    phase: random.next() * 10,
    pose: "idle",
    rethinkSeconds: random.next() * 2,
    speed: 0,
    strandedDay: Number.NEGATIVE_INFINITY,
    tribeId: birth.tribeId,
    warmth: 1,
    weapon: null,
  };
}

export function isChild(person: Person): boolean {
  return person.age < ADULT_AGE;
}

export function isElder(person: Person): boolean {
  return person.age > ELDER_AGE;
}

export function walkSpeed(person: Person): number {
  if (isChild(person)) {
    return CHILD_WALK_SPEED;
  }

  if (isElder(person)) {
    return ELDER_WALK_SPEED;
  }

  return ADULT_WALK_SPEED;
}

export function runSpeed(person: Person): number {
  if (isChild(person)) {
    return CHILD_RUN_SPEED;
  }

  return ADULT_RUN_SPEED;
}

export function carriedItem(person: Person): CarriedItem {
  if (person.carrying.amount <= 0) {
    return "nothing";
  }

  return person.carrying.item;
}

export function isCarryingAnything(person: Person): boolean {
  return carriedItem(person) !== "nothing";
}

export function dropCarrying(person: Person): void {
  person.carrying.amount = 0;
  person.carrying.item = "nothing";
  person.carrying.resource = null;
}

export function pickUp(person: Person, resource: ResourceKind, amount: number, item: CarriedItem): void {
  if (person.carrying.resource !== resource) {
    dropCarrying(person);
  }

  person.carrying.amount += amount;
  person.carrying.item = item;
  person.carrying.resource = resource;
}

export function putDown(person: Person, amount: number): void {
  person.carrying.amount -= amount;

  if (person.carrying.amount <= 0) {
    dropCarrying(person);
  }
}

export function carriedFood(person: Person): number {
  const { resource } = person.carrying;

  if (resource === null || !isFoodKind(resource)) {
    return 0;
  }

  return person.carrying.amount;
}

export function carriedAmount(person: Person, resource: ResourceKind): number {
  if (person.carrying.resource !== resource) {
    return 0;
  }

  return person.carrying.amount;
}
