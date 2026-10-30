import { BUILDINGS } from "../../../content/buildings.ts";
import { DEPOSITS, type DepositKind } from "../../../content/deposits.ts";
import { type Building, isComplete } from "../buildings.ts";
import { mineFor } from "../camp-plan.ts";
import { pickUp } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { workSeconds } from "../tools.ts";
import { learn } from "../tribe.ts";
import { DeliverJob } from "./deliver-job.ts";
import { Errand, headToWork, type Job, type WorkTarget } from "./job.ts";

const MINING_SECONDS = 30;
const ORE_PER_TRIP = 12;
const PICK_REACH = 0.6;
const ENTRANCE_SHARE = 0.55;

export function findMineWork(tick: PersonTick, kind: DepositKind): MineJob | null {
  const mine = mineFor(tick.tribe, tick.context, kind);

  if (mine === null || !isComplete(mine)) {
    return null;
  }

  return new MineJob(tick, mine, kind);
}

export class MineJob implements Job {
  readonly isExpedition = true;
  readonly kind = "mine";
  readonly ore: DepositKind;
  readonly #errand: Errand;
  readonly #mineId: number;

  constructor(tick: PersonTick, mine: Building, ore: DepositKind) {
    const target: WorkTarget = {
      radius: BUILDINGS.mine.footprint * ENTRANCE_SHARE,
      reach: PICK_REACH,
      x: mine.x,
      z: mine.z,
    };

    this.#mineId = mine.id;
    this.ore = ore;
    this.#errand = new Errand(workSeconds(tick.tribe, MINING_SECONDS), "mine", target);
    headToWork(tick.person, target, tick.context);
  }

  update(tick: PersonTick): Job | null {
    if (tick.context.buildings.find(this.#mineId) === null) {
      return null;
    }

    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    pickUp(tick.person, DEPOSITS[this.ore].resource, ORE_PER_TRIP, "ore");
    learn(tick.tribe, 0.5, tick.context.rules);

    return new DeliverJob(tick);
  }
}
