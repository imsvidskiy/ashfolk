import { isRockSpecies } from "../../../content/plants.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import { pickUp } from "../person.ts";
import { nearestPlant, nearestQuarry } from "../resources.ts";
import type { PersonTick } from "../society-context.ts";
import { workSeconds } from "../tools.ts";
import { learn, markScarce } from "../tribe.ts";
import { DeliverJob } from "./deliver-job.ts";
import { canWorkAtPlant, Errand, headToWork, isFreePlant, type Job, plantTarget, type WorkTarget } from "./job.ts";

const QUARRYING_SECONDS = 9;
const STONE_PER_TRIP = 5;
const BOULDER_SEARCH_RADIUS = 420;
const CLIFF_SEARCH_RADIUS = 520;
const TRIPS_PER_BOULDER = 3;
const PICK_REACH = 0.6;
const CLIFF_FACE_RADIUS = 0.5;
const KNOWLEDGE_PER_TRIP = 0.4;

export function findStone(tick: PersonTick): Job | null {
  const { person, tribe } = tick;
  const { world } = tick.context;

  const boulder = nearestPlant(world, {
    accepts: (plant) => {
      return (
        isRockSpecies(world.vegetation.species[plant]) &&
        isFreePlant(tick, plant) &&
        canWorkAtPlant(tick, plant, PICK_REACH)
      );
    },
    radius: BOULDER_SEARCH_RADIUS,
    x: person.mover.x,
    z: person.mover.z,
  });

  if (boulder !== null) {
    return new BoulderJob(tick, boulder);
  }

  const cliff = nearestQuarry(world, tribe.campX, tribe.campZ, CLIFF_SEARCH_RADIUS);

  if (cliff === null) {
    markScarce(tribe, "stone", tick.context.environment.day);

    return null;
  }

  return new QuarryJob(tick, cliff);
}

function startQuarrying(tick: PersonTick, target: WorkTarget): Errand {
  const errand = new Errand(workSeconds(tick.tribe, QUARRYING_SECONDS), "mine", target);

  headToWork(tick.person, target, tick.context);

  return errand;
}

function collectStone(tick: PersonTick): Job {
  pickUp(tick.person, "stone", STONE_PER_TRIP, "stone");
  learn(tick.tribe, KNOWLEDGE_PER_TRIP, tick.context.rules);

  return new DeliverJob(tick);
}

class BoulderJob implements Job {
  readonly claimedPlant: number;
  readonly kind = "quarry";
  readonly #errand: Errand;

  constructor(tick: PersonTick, boulder: number) {
    this.claimedPlant = boulder;
    tick.tribe.claimedPlants.add(boulder);
    this.#errand = startQuarrying(tick, plantTarget(tick.context.world.vegetation, boulder, PICK_REACH));
  }

  update(tick: PersonTick): Job | null {
    const { world } = tick.context;

    const boulder = this.claimedPlant;

    if (!world.vegetation.isAlive(boulder)) {
      return null;
    }

    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    const wear = world.vegetation.wearDown(boulder);

    if (wear >= TRIPS_PER_BOULDER) {
      world.removePlant(boulder);
    }

    return collectStone(tick);
  }
}

class QuarryJob implements Job {
  readonly kind = "quarry";
  readonly #errand: Errand;

  constructor(tick: PersonTick, cliff: Waypoint) {
    this.#errand = startQuarrying(tick, { radius: CLIFF_FACE_RADIUS, reach: PICK_REACH, x: cliff.x, z: cliff.z });
  }

  update(tick: PersonTick): Job | null {
    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    return collectStone(tick);
  }
}
