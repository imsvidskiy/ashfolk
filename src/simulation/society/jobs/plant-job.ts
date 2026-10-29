import { emptySpot, plantSpot } from "../plots.ts";
import type { PersonTick } from "../society-context.ts";
import { learn, type PlotSpot } from "../tribe.ts";
import { Errand, headTo, type Job } from "./job.ts";

const PLANTING_SECONDS = 7;

export function findPlanting(tick: PersonTick): PlantJob | null {
  const spot = emptySpot(tick.tribe, tick.context.world);

  if (spot === null) {
    return null;
  }

  return new PlantJob(tick, spot);
}

class PlantJob implements Job {
  readonly kind = "plant";
  readonly #errand: Errand;
  readonly #spot: PlotSpot;

  constructor(tick: PersonTick, spot: PlotSpot) {
    this.#spot = spot;
    this.#errand = new Errand(PLANTING_SECONDS, "dig", spot);
    headTo(tick.person, { x: spot.x + 0.9, z: spot.z + 0.9 }, tick.context);
  }

  update(tick: PersonTick): Job | null {
    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    plantSpot(tick.tribe, this.#spot, tick.context);
    learn(tick.tribe, 0.4, tick.context.rules);

    return null;
  }
}
