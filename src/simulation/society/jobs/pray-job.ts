import type { Building } from "../buildings.ts";
import type { PersonTick } from "../society-context.ts";
import { MAXIMUM_FAITH } from "../tribe.ts";
import { Errand, headTo, type Job } from "./job.ts";

const PRAYER_SECONDS = 10;
const FAITH_PER_PRAYER = 0.6;
const PRAYER_SPREAD = 4;
const PRAYER_DISTANCE = 5;

export class PrayJob implements Job {
  readonly kind = "pray";
  readonly #errand: Errand;
  readonly #totemId: number;

  constructor(tick: PersonTick, totem: Building) {
    const { random } = tick.context;

    this.#totemId = totem.id;
    this.#errand = new Errand(PRAYER_SECONDS, "pray", totem);
    headTo(tick.person, { x: totem.x + random.signed() * PRAYER_SPREAD, z: totem.z + PRAYER_DISTANCE }, tick.context);
  }

  update(tick: PersonTick): Job | null {
    if (tick.context.buildings.find(this.#totemId) === null) {
      return null;
    }

    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    tick.tribe.faith = Math.min(MAXIMUM_FAITH, tick.tribe.faith + FAITH_PER_PRAYER);

    return null;
  }
}
