import type { Waypoint } from "../../agents/navigation.ts";
import type { Person } from "../person.ts";
import { lossShare, type Raid, type RaidPhase } from "./raids.ts";

export const RALLY_DISTANCE = 12;

const MUSTERED_DISTANCE = RALLY_DISTANCE + 6;
const MUSTER_SECONDS = 45;
const ALARM_DISTANCE = 140;
const ASSAULT_DISTANCE = 60;
const LONGEST_MARCH_SECONDS = 700;
const LONGEST_ASSAULT_SECONDS = 95;
const LONGEST_RETREAT_SECONDS = 300;
const ROUT_SHARE = 0.4;

function distanceFrom(person: Person, point: Waypoint): number {
  return Math.hypot(person.mover.x - point.x, person.mover.z - point.z);
}

export function enterPhase(raid: Raid, phase: RaidPhase): void {
  raid.phase = phase;
  raid.phaseSeconds = 0;
}

function advanceMuster(raid: Raid, raiders: readonly Person[]): void {
  const gathered = raiders.filter((raider) => {
    return distanceFrom(raider, raid.rally) < MUSTERED_DISTANCE;
  }).length;

  if (gathered >= raiders.length || raid.phaseSeconds > MUSTER_SECONDS) {
    enterPhase(raid, "march");
  }
}

function advanceMarch(raid: Raid, raiders: readonly Person[]): void {
  const closest = Math.min(
    ...raiders.map((raider) => {
      return distanceFrom(raider, raid.target);
    })
  );

  if (closest < ALARM_DISTANCE) {
    raid.isAlarmRaised = true;
  }

  if (closest < ASSAULT_DISTANCE) {
    enterPhase(raid, "assault");
  }

  if (raid.phaseSeconds > LONGEST_MARCH_SECONDS) {
    enterPhase(raid, "retreat");
  }
}

function advanceAssault(raid: Raid, raiders: readonly Person[]): void {
  const isSpent = raiders.every((raider) => {
    return raid.struckIds.has(raider.id) || raid.routedIds.has(raider.id);
  });

  if (isSpent || lossShare(raid) >= ROUT_SHARE || raid.phaseSeconds > LONGEST_ASSAULT_SECONDS) {
    enterPhase(raid, "retreat");
  }
}

export function advancePhase(raid: Raid, raiders: readonly Person[]): boolean {
  if (raid.phase === "muster") {
    advanceMuster(raid, raiders);

    return false;
  }

  if (raid.phase === "march") {
    advanceMarch(raid, raiders);

    return false;
  }

  if (raid.phase === "assault") {
    advanceAssault(raid, raiders);

    return false;
  }

  return raid.phaseSeconds > LONGEST_RETREAT_SECONDS;
}
