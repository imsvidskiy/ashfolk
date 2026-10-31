import { isTreeSpecies, plantSpeciesDefinition } from "../../../content/plants.ts";
import { pickUp } from "../person.ts";
import { isProtectedPlant } from "../plots.ts";
import { nearestPlant } from "../resources.ts";
import type { PersonTick } from "../society-context.ts";
import { workSeconds } from "../tools.ts";
import { learn, markScarce } from "../tribe.ts";
import { DeliverJob } from "./deliver-job.ts";
import { canWorkAtPlant, Errand, headToWork, isFreePlant, type Job, plantTarget } from "./job.ts";

const CHOPPING_SECONDS = 7;
const FELLING_YIELD = 2;
const AXE_REACH = 0.75;
const SEARCH_RADIUS = 320;
const KNOWLEDGE_PER_TREE = 0.4;

export function findTree(tick: PersonTick): ChopJob | null {
  const { person, tribe } = tick;
  const { world } = tick.context;
  const { vegetation } = world;
  const { day } = tick.context.environment;

  const tree = nearestPlant(world, {
    accepts: (plant) => {
      return (
        isFreePlant(tick, plant) &&
        isTreeSpecies(vegetation.species[plant]) &&
        !isProtectedPlant(tribe, world, plant, day) &&
        canWorkAtPlant(tick, plant, AXE_REACH)
      );
    },
    radius: SEARCH_RADIUS,
    x: (tribe.campX + person.mover.x) / 2,
    z: (tribe.campZ + person.mover.z) / 2,
  });

  if (tree === null) {
    markScarce(tribe, "wood", day);

    return null;
  }

  return new ChopJob(tick, tree);
}

class ChopJob implements Job {
  readonly claimedPlant: number;
  readonly kind = "chop";
  readonly #errand: Errand;

  constructor(tick: PersonTick, tree: number) {
    const target = plantTarget(tick.context.world.vegetation, tree, AXE_REACH);

    this.claimedPlant = tree;
    this.#errand = new Errand(workSeconds(tick.tribe, CHOPPING_SECONDS), "chop", target);
    tick.tribe.claimedPlants.add(tree);
    headToWork(tick.person, target, tick.context);
  }

  update(tick: PersonTick): Job | null {
    const { world } = tick.context;

    const tree = this.claimedPlant;

    if (!world.vegetation.isAlive(tree)) {
      return null;
    }

    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    pickUp(tick.person, "wood", plantSpeciesDefinition(world.vegetation.species[tree]).wood * FELLING_YIELD, "wood");
    world.removePlant(tree);
    learn(tick.tribe, KNOWLEDGE_PER_TREE, tick.context.rules);

    return new DeliverJob(tick);
  }
}
