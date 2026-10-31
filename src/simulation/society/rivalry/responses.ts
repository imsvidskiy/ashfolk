import { hashToUnit } from "../../../shared/math.ts";
import type { Job } from "../jobs/job.ts";
import type { Person } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { armForHunt, carriedWeapon } from "../weapons.ts";
import { DefendJob, FightJob, ShelterJob } from "./defense-jobs.ts";
import { animalFoe } from "./foes.ts";
import { canFight, isBusy, isFitToDefend, livingRaiders } from "./raids.ts";

const CALL_TO_ARMS_RADIUS = 180;
const GATES_RADIUS = 120;
const RAIDER_NOTICE_RADIUS = 90;
const RAIDER_FLIGHT_RADIUS = 60;
const BEAST_NOTICE_RADIUS = 60;
const BRAVE_SHARE = 0.7;
const BRAVERY_SALT = 3.1;

function answerRaid(tick: PersonTick): Job | null {
  const { context, person, tribe } = tick;

  const raid = context.rivalry.campaigns.raidAgainst(tribe.id);

  if (raid === null) {
    return null;
  }

  let nearest: Person | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const raider of livingRaiders(context.people, raid)) {
    const distance = Math.hypot(raider.mover.x - person.mover.x, raider.mover.z - person.mover.z);

    if (distance < nearestDistance) {
      nearest = raider;
      nearestDistance = distance;
    }
  }

  if (nearest === null) {
    return null;
  }

  const isAtTheGates = Math.hypot(nearest.mover.x - tribe.campX, nearest.mover.z - tribe.campZ) < GATES_RADIUS;

  if (!isAtTheGates && raid.phase !== "assault") {
    return null;
  }

  const isNearCamp = Math.hypot(tribe.campX - person.mover.x, tribe.campZ - person.mover.z) < CALL_TO_ARMS_RADIUS;

  const isBrave = hashToUnit(person.id, raid.id * BRAVERY_SALT) < BRAVE_SHARE;

  if (isFitToDefend(person) && isBrave && (isNearCamp || nearestDistance < RAIDER_NOTICE_RADIUS)) {
    if (isNearCamp) {
      armForHunt(person, tribe);
    }

    return new DefendJob(tick, raid, carriedWeapon(person));
  }

  if (nearestDistance < RAIDER_FLIGHT_RADIUS) {
    return new ShelterJob(tick, nearest.mover);
  }

  return null;
}

function answerBeast(tick: PersonTick): Job | null {
  const { context, person } = tick;

  const beast = context.fauna.menaceNear(person.mover.x, person.mover.z, BEAST_NOTICE_RADIUS);

  if (beast === null) {
    return null;
  }

  if (canFight(person)) {
    return new FightJob(tick, animalFoe(beast), carriedWeapon(person));
  }

  return new ShelterJob(tick, null);
}

export function respondToFoes(tick: PersonTick): Job | null {
  if (isBusy(tick.person)) {
    return null;
  }

  const defense = answerRaid(tick);

  if (defense !== null) {
    return defense;
  }

  return answerBeast(tick);
}
