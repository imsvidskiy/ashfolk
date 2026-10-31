import { takeUpJob } from "../decisions.ts";
import { isChild } from "../person.ts";
import type { SocietyContext } from "../society-context.ts";
import { takeFood, totalFood } from "../stock.ts";
import type { Tribe } from "../tribe.ts";
import { campDistance } from "../tribe-places.ts";
import { EnvoyJob } from "./defense-jobs.ts";
import { FOOD_RESERVE } from "./provisions.ts";
import { rationsFor } from "./raids.ts";
import { type Relation, stanceFor } from "./relations.ts";
import { isBusy } from "./responses.ts";

const PEACE_WEARINESS = 30;
const WEARINESS_PER_PRESSURE = 40;
const LONG_FEUD_DAYS = 6;
const FEUD_DAYS_PER_PRESSURE = 12;
const PEACE_STANDING = 15;
const TRUCE_DAYS = 12;
const LINGERING_WEARINESS = 0.3;
const SMALLEST_GIFT = 6;
const LARGEST_GIFT = 16;
const GIFT_SHARE = 0.3;
const ENVOY_HEALTH = 0.6;

export function peacePressure(relation: Relation, feudDays: number): number {
  const weariness = Math.max(relation.first.weariness, relation.second.weariness);

  return (weariness - PEACE_WEARINESS) / WEARINESS_PER_PRESSURE + (feudDays - LONG_FEUD_DAYS) / FEUD_DAYS_PER_PRESSURE;
}

export function sendEnvoy(relation: Relation, seeker: Tribe, host: Tribe, context: SocietyContext): boolean {
  const surplus = totalFood(seeker.stock) - seeker.memberCount * FOOD_RESERVE;
  const giftAmount = Math.min(LARGEST_GIFT, surplus * GIFT_SHARE);

  const envoy = context.people.membersOf(seeker).find((person) => {
    return !(isChild(person) || isBusy(person)) && person.health > ENVOY_HEALTH;
  });

  if (envoy === undefined || giftAmount < SMALLEST_GIFT) {
    return false;
  }

  const rations = Math.floor(
    takeFood(seeker.stock, rationsFor(campDistance(seeker, host), context.rules.life.hungerRate))
  );

  relation.envoyId = envoy.id;
  takeUpJob(envoy, seeker, context, (tick) => {
    return new EnvoyJob(tick, host, giftAmount, rations);
  });

  return true;
}

export function isEnvoyOnTheWay(envoyId: number, context: SocietyContext): boolean {
  const envoy = context.people.findPerson(envoyId);

  return envoy?.isAlive === true && envoy.job instanceof EnvoyJob;
}

export function agreeTruce(relation: Relation, day: number): void {
  relation.standing = PEACE_STANDING;
  relation.truceUntilDay = day + TRUCE_DAYS;
  relation.feudStartDay = null;
  relation.envoyId = null;
  relation.stance = stanceFor(PEACE_STANDING, "neutral");

  for (const side of [relation.first, relation.second]) {
    side.grievance = 0;
    side.weariness *= LINGERING_WEARINESS;
  }
}
