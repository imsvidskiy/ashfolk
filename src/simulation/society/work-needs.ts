import type { ResourceAmounts } from "../../content/resources.ts";
import type { Job, JobKind } from "./jobs/job.ts";
import type { PersonTick } from "./society-context.ts";
import { totalFood } from "./stock.ts";
import { isWorthLookingFor, type ScarceResource } from "./tribe.ts";

const PRE_WINTER_SEASON = 1.6;

export interface WorkOption {
  kind: JobKind;
  start: (tick: PersonTick, construction: ResourceAmounts) => Job | null;
  weight: (tick: PersonTick, construction: ResourceAmounts) => number;
}

export function foodNeed(tick: PersonTick): number {
  const { season } = tick.context.environment;
  const { tribe } = tick;

  const daysOfFood = season >= PRE_WINTER_SEASON ? 7 : 4;
  const target = tribe.memberCount * daysOfFood + 6;

  return Math.max(0.15, 1 - totalFood(tribe.stock) / target);
}

export function isWorthIt(tick: PersonTick, resource: ScarceResource, patience: number): boolean {
  return isWorthLookingFor(tick.tribe, resource, tick.context.environment.day, patience);
}
