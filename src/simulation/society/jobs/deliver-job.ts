import type { Waypoint } from "../../agents/navigation.ts";
import { dropCarrying, walkSpeed } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { completedBuilding, nearCamp } from "../tribe-places.ts";
import { headTo, type Job, walk } from "./job.ts";

const HEAVY_LOAD = 3;
const HEAVY_LOAD_SPEED = 0.85;
const DROP_SPREAD = 3;

function deliveryPoint(tick: PersonTick): Waypoint {
  const { random } = tick.context;

  const storehouse = completedBuilding(tick.context.buildings, tick.tribe.buildings.storehouseId);

  if (storehouse === null) {
    return nearCamp(tick.tribe, DROP_SPREAD, random);
  }

  return { x: storehouse.x + random.signed() * DROP_SPREAD, z: storehouse.z + random.signed() * DROP_SPREAD };
}

function storeCarrying(tick: PersonTick): void {
  const { amount, resource } = tick.person.carrying;

  if (resource !== null) {
    tick.tribe.stock[resource] += amount;
  }

  dropCarrying(tick.person);
}

export class DeliverJob implements Job {
  readonly kind = "deliver";

  constructor(tick: PersonTick) {
    headTo(tick.person, deliveryPoint(tick), tick.context);
  }

  update(tick: PersonTick): Job | null {
    const { carrying } = tick.person;

    const isHeavy = carrying.item !== "berries" && carrying.amount > HEAVY_LOAD;

    if (!walk(tick, walkSpeed(tick.person) * (isHeavy ? HEAVY_LOAD_SPEED : 1))) {
      return this;
    }

    storeCarrying(tick);

    return null;
  }
}
