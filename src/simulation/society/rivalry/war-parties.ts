import { FULL_TURN } from "../../../shared/math.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import type { Person } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { GOLDEN_ANGLE } from "../tribe-places.ts";
import { type Foe, personFoe } from "./foes.ts";
import { canFight } from "./raids.ts";

const FORMATION_SPACING = 2.6;
const PURSUIT_RADIUS = 40;

export function formationOffset(slot: number): Waypoint {
  if (slot === 0) {
    return { x: 0, z: 0 };
  }

  const angle = (slot * GOLDEN_ANGLE) % FULL_TURN;
  const distance = FORMATION_SPACING * Math.sqrt(slot);

  return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
}

export function offsetFrom(point: Waypoint, offset: Waypoint, scale: number): Waypoint {
  return { x: point.x + offset.x * scale, z: point.z + offset.z * scale };
}

function isStandingFighter(person: Person): boolean {
  if (!canFight(person)) {
    return false;
  }

  return person.job === null || person.job.kind !== "flee";
}

export function nearestFoeAmong(tick: PersonTick, candidates: readonly Person[], radius: number): Foe | null {
  const { mover } = tick.person;

  let nearest: Person | null = null;
  let nearestDistance = radius;

  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.mover.x - mover.x, candidate.mover.z - mover.z);

    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  if (nearest === null) {
    return null;
  }

  return personFoe(nearest);
}

export function nearbyFighters(tick: PersonTick, tribeId: number, radius: number): Person[] {
  const { mover } = tick.person;

  return tick.context.people.livingWithin(mover.x, mover.z, radius).filter((person) => {
    return person.tribeId === tribeId && isStandingFighter(person);
  });
}

export function assailantOf(tick: PersonTick, tribeId: number): Person | null {
  const { person } = tick;

  const assailantId = tick.context.rivalry.ledger.assailantOf(person.id);

  if (assailantId === null) {
    return null;
  }

  const attacker = tick.context.people.findPerson(assailantId);

  if (attacker === null || !attacker.isAlive || attacker.tribeId !== tribeId) {
    return null;
  }

  const distance = Math.hypot(attacker.mover.x - person.mover.x, attacker.mover.z - person.mover.z);

  return distance < PURSUIT_RADIUS ? attacker : null;
}
