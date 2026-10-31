import { carriedFood, pickUp } from "../person.ts";
import { nearestShore, type ShoreSpot } from "../resources.ts";
import type { PersonTick } from "../society-context.ts";
import { learn, markScarce } from "../tribe.ts";
import { campPoint } from "../tribe-places.ts";
import { DeliverJob } from "./deliver-job.ts";
import { Errand, headToBank, type Job } from "./job.ts";

const FISHING_SECONDS = 11;
const CATCH_CHANCE = 0.7;
const FISH_PER_CATCH = 3;
const SEARCH_RADIUS = 320;
const KNOWLEDGE_PER_CAST = 0.5;

export function findFishingSpot(tick: PersonTick): FishJob | null {
  const { person, tribe } = tick;
  const { navigation, random, world } = tick.context;

  const spot = nearestShore(world, campPoint(tribe), SEARCH_RADIUS, random, (shore) => {
    return navigation.isWithinWalk(person.mover, shore);
  });

  if (spot === null) {
    markScarce(tribe, "fish", tick.context.environment.day);

    return null;
  }

  return new FishJob(tick, spot);
}

class FishJob implements Job {
  readonly kind = "fish";
  readonly #errand: Errand;

  constructor(tick: PersonTick, spot: ShoreSpot) {
    this.#errand = new Errand(FISHING_SECONDS, "fish", { x: spot.waterX, z: spot.waterZ });
    headToBank(tick.person, spot, tick.context);
  }

  update(tick: PersonTick): Job | null {
    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    if (tick.context.random.chance(CATCH_CHANCE)) {
      pickUp(tick.person, "fish", FISH_PER_CATCH, "fish");
    }

    learn(tick.tribe, KNOWLEDGE_PER_CAST, tick.context.rules);

    if (carriedFood(tick.person) >= FISH_PER_CATCH) {
      return new DeliverJob(tick);
    }

    this.#errand.restartWork();

    return this;
  }
}
