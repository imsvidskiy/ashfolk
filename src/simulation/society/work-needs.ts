import type { ResourceAmounts } from "../../content/resources.ts";
import type { Job, JobKind } from "./jobs/job.ts";
import type { PersonTick } from "./society-context.ts";
import { totalFood } from "./stock.ts";
import { isWorthLookingFor, type ScarceResource } from "./tribe.ts";

const PRE_WINTER_SEASON = 1.6;
const DAYS_OF_FOOD = 4;
const DAYS_OF_FOOD_BEFORE_WINTER = 7;
const SPARE_FOOD = 6;
const SMALLEST_FOOD_NEED = 0.15;
const SEARCH_PATIENCE_DAYS: Readonly<Record<ScarceResource, number>> = {
  berries: 0.3,
  clay: 1,
  fish: 0.5,
  game: 0.4,
  stone: 0.5,
  wood: 0.4,
};

export interface WorkOption {
  kind: JobKind;
  start: (tick: PersonTick, construction: ResourceAmounts) => Job | null;
  weight: (tick: PersonTick, construction: ResourceAmounts) => number;
}

export function foodNeed(tick: PersonTick): number {
  const { season } = tick.context.environment;
  const { tribe } = tick;

  const daysOfFood = season >= PRE_WINTER_SEASON ? DAYS_OF_FOOD_BEFORE_WINTER : DAYS_OF_FOOD;
  const target = tribe.memberCount * daysOfFood + SPARE_FOOD;

  return Math.max(SMALLEST_FOOD_NEED, 1 - totalFood(tribe.stock) / target);
}

export function isWorthIt(tick: PersonTick, resource: ScarceResource): boolean {
  return isWorthLookingFor(tick.tribe, resource, tick.context.environment.day, SEARCH_PATIENCE_DAYS[resource]);
}
