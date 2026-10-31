import { DEPOSITS } from "../../../content/deposits.ts";
import { nearestDeposit } from "../camp-plan.ts";
import { pickUp } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { workSeconds } from "../tools.ts";
import { learn, markScarce } from "../tribe.ts";
import { campPoint } from "../tribe-places.ts";
import { DeliverJob } from "./deliver-job.ts";
import { Errand, headTo, type Job } from "./job.ts";

const DIGGING_SECONDS = 8;
const CLAY_PER_TRIP = 6;
const KNOWLEDGE_PER_TRIP = 0.3;

export function findClay(tick: PersonTick): ClayJob | null {
  const { context, tribe } = tick;

  const deposit = nearestDeposit(context.world, "clay", campPoint(tribe), DEPOSITS.clay.reach);

  if (deposit === null || !context.navigation.isWithinWalk(campPoint(tribe), deposit)) {
    markScarce(tribe, "clay", context.environment.day);

    return null;
  }

  const cell = context.random.pick(deposit.cells);

  return new ClayJob(tick, cell);
}

class ClayJob implements Job {
  readonly isExpedition = true;
  readonly kind = "clay";
  readonly #errand: Errand;

  constructor(tick: PersonTick, cell: number) {
    const { grid } = tick.context.world;

    this.#errand = new Errand(workSeconds(tick.tribe, DIGGING_SECONDS), "dig");
    headTo(tick.person, { x: grid.cellCenterX(cell), z: grid.cellCenterZ(cell) }, tick.context);
  }

  update(tick: PersonTick): Job | null {
    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    pickUp(tick.person, "clay", CLAY_PER_TRIP, "clay");
    learn(tick.tribe, KNOWLEDGE_PER_TRIP, tick.context.rules);

    return new DeliverJob(tick);
  }
}
