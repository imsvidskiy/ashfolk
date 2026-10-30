import { emptySpot, plantSpot } from "../plots.ts";
import type { PersonTick } from "../society-context.ts";
import { learn, type PlotSpot } from "../tribe.ts";
import { Errand, headTo, type Job } from "./job.ts";

const PLANTING_SECONDS = 7;

export function freeSpot(tick: PersonTick): PlotSpot | null {
  const taken = new Set<PlotSpot>();

  for (const person of tick.context.people.membersOf(tick.tribe)) {
    if (person !== tick.person && person.job instanceof PlantJob) {
      taken.add(person.job.spot);
    }
  }

  return emptySpot(tick.tribe, tick.context.world, taken);
}

export function findPlanting(tick: PersonTick): PlantJob | null {
  const spot = freeSpot(tick);

  if (spot === null) {
    return null;
  }

  return new PlantJob(tick, spot);
}

class PlantJob implements Job {
  readonly kind = "plant";
  readonly spot: PlotSpot;
  readonly #errand: Errand;

  constructor(tick: PersonTick, spot: PlotSpot) {
    this.spot = spot;
    this.#errand = new Errand(PLANTING_SECONDS, "dig", spot);
    headTo(tick.person, { x: spot.x + 0.9, z: spot.z + 0.9 }, tick.context);
  }

  update(tick: PersonTick): Job | null {
    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    if (plantSpot(tick.tribe, this.spot, tick.context)) {
      learn(tick.tribe, 0.4, tick.context.rules);
    }

    return null;
  }
}
