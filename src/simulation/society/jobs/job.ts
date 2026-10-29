import { plantSpeciesDefinition } from "../../../content/plants.ts";
import type { PersonPose } from "../../../world/agent-poses.ts";
import type { VegetationStore } from "../../../world/vegetation-store.ts";
import { faceTowards, moveAlong, setDestination, stopMoving } from "../../agents/movement.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import { dryStandSpot, nearestDrySpot } from "../../agents/walkable-ground.ts";
import { isCarryingAnything, type Person, walkSpeed } from "../person.ts";
import type { PersonTick, SocietyContext } from "../society-context.ts";
import type { Tribe } from "../tribe.ts";

const RUNNING_SPEED = 3.4;
const DRY_DESTINATION_RADIUS = 40;
const WORK_ARRIVAL_DISTANCE = 0.3;
const SHORTEST_APPROACH = 0.01;
const WORKPLACE_TOLERANCE = 3;

export type JobKind =
  | "build"
  | "chop"
  | "clay"
  | "craft"
  | "defend"
  | "deliver"
  | "eat"
  | "envoy"
  | "farm"
  | "fight"
  | "fish"
  | "flee"
  | "gather"
  | "hide"
  | "hunt"
  | "idle"
  | "migrate"
  | "mine"
  | "mourn"
  | "pick"
  | "plant"
  | "play"
  | "pray"
  | "quarry"
  | "raid"
  | "sleep"
  | "tend"
  | "warm";

export const JOB_LABELS: Readonly<Record<JobKind, string>> = {
  build: "Building",
  chop: "Chopping wood",
  clay: "Digging clay",
  craft: "Crafting",
  defend: "Defending the camp",
  deliver: "Carrying goods to camp",
  eat: "Eating",
  envoy: "Bringing gifts of peace",
  farm: "Working the field",
  fight: "Fighting",
  fish: "Fishing",
  flee: "Running from danger",
  gather: "Gathering berries",
  hide: "Running for shelter",
  hunt: "Hunting",
  idle: "Resting",
  migrate: "Moving to a new camp",
  mine: "Mining ore",
  mourn: "Mourning the fallen",
  pick: "Picking fruit",
  plant: "Planting",
  play: "Playing",
  pray: "Praying at the totem",
  quarry: "Breaking stone",
  raid: "Raiding",
  sleep: "Sleeping",
  tend: "Feeding the campfire",
  warm: "Warming up by the fire",
};

export interface Job {
  cancel?: (tribe: Tribe) => void;
  readonly claimedPlant?: number;
  readonly isExpedition?: boolean;
  readonly kind: JobKind;
  readonly label?: string;
  update: (tick: PersonTick) => Job | null;
}

export interface WorkTarget {
  readonly radius: number;
  readonly reach: number;
  readonly x: number;
  readonly z: number;
}

type ErrandProgress = "abandoned" | "finished" | "traveling" | "working";

type ErrandPhase = "abandoned" | "travel" | "work";

function travelPose(person: Person, speed: number): PersonPose {
  if (speed > RUNNING_SPEED) {
    return "run";
  }

  if (isCarryingAnything(person)) {
    return "carry";
  }

  return "walk";
}

export function plantTarget(vegetation: VegetationStore, plant: number, reach: number): WorkTarget {
  const { radiusPerMeter } = plantSpeciesDefinition(vegetation.species[plant]);

  return { radius: radiusPerMeter * vegetation.height[plant], reach, x: vegetation.x[plant], z: vegetation.z[plant] };
}

function approachDirection(person: Person, target: WorkTarget): Waypoint {
  const awayX = person.mover.x - target.x;
  const awayZ = person.mover.z - target.z;

  const distance = Math.hypot(awayX, awayZ);

  if (distance < SHORTEST_APPROACH) {
    return { x: 1, z: 0 };
  }

  return { x: awayX / distance, z: awayZ / distance };
}

export function isFreePlant(tick: PersonTick, plant: number): boolean {
  return tick.context.world.vegetation.isAlive(plant) && !tick.tribe.claimedPlants.has(plant);
}

export function canWorkAtPlant(tick: PersonTick, plant: number, reach: number): boolean {
  const { navigation, world } = tick.context;
  const { mover } = tick.person;

  const target = plantTarget(world.vegetation, plant, reach);

  return (
    dryStandSpot(world, target, target.radius + target.reach, mover) !== null && navigation.isWithinWalk(mover, target)
  );
}

export function headToWork(person: Person, target: WorkTarget, context: SocietyContext): void {
  const standOff = target.radius + target.reach;
  const standing = dryStandSpot(context.world, target, standOff, person.mover);

  if (standing !== null) {
    setDestination(person.mover, standing, context.navigation, { arrivalDistance: WORK_ARRIVAL_DISTANCE });

    return;
  }

  const direction = approachDirection(person, target);
  const spot = { x: target.x + direction.x * standOff, z: target.z + direction.z * standOff };

  setDestination(person.mover, nearestDrySpot(context.world, spot, DRY_DESTINATION_RADIUS), context.navigation, {
    arrivalDistance: WORK_ARRIVAL_DISTANCE,
  });
}

export function headTo(person: Person, destination: Waypoint, context: SocietyContext): void {
  const dryDestination = nearestDrySpot(context.world, destination, DRY_DESTINATION_RADIUS);

  setDestination(person.mover, dryDestination, context.navigation);
}

export function headToBank(person: Person, bank: Waypoint, context: SocietyContext): void {
  setDestination(person.mover, bank, context.navigation, { arrivalDistance: WORK_ARRIVAL_DISTANCE });
}

export function walk(tick: PersonTick, speed: number): boolean {
  const { context, person } = tick;

  person.speed = speed;
  person.pose = travelPose(person, speed);

  const isThere = moveAlong(person.mover, tick.seconds, speed, context.world, context.navigation);

  if (isThere) {
    person.speed = 0;
  }

  return isThere;
}

export function standStill(person: Person, pose: PersonPose): void {
  person.pose = pose;
  person.speed = 0;
  stopMoving(person.mover);
}

export class Errand {
  readonly #focus: Waypoint | null;
  readonly #workPose: PersonPose;
  readonly #workSeconds: number;
  #elapsedWork = 0;
  #phase: ErrandPhase = "travel";

  constructor(workSeconds: number, workPose: PersonPose, focus: Waypoint | null = null) {
    this.#focus = focus;
    this.#workSeconds = workSeconds;
    this.#workPose = workPose;
  }

  update(tick: PersonTick): ErrandProgress {
    if (this.#phase === "travel") {
      this.#travel(tick);
    }

    if (this.#phase === "travel") {
      return "traveling";
    }

    if (this.#phase === "abandoned") {
      return "abandoned";
    }

    standStill(tick.person, this.#workPose);
    this.#faceFocus(tick);
    this.#elapsedWork += tick.seconds;

    if (this.#elapsedWork < this.#workSeconds) {
      return "working";
    }

    return "finished";
  }

  restartWork(): void {
    this.#elapsedWork = 0;
  }

  #faceFocus(tick: PersonTick): void {
    const focus = this.#focus;

    if (focus === null) {
      return;
    }

    faceTowards(tick.person.mover, focus.x, focus.z);
  }

  #travel(tick: PersonTick): void {
    if (!walk(tick, walkSpeed(tick.person))) {
      return;
    }

    const { mover } = tick.person;

    const isThere = Math.hypot(mover.goalX - mover.x, mover.goalZ - mover.z) <= WORKPLACE_TOLERANCE;

    this.#phase = isThere ? "work" : "abandoned";
  }
}
