import type { Waypoint } from "../../agents/navigation.ts";
import { dropCarrying, walkSpeed } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { campPoint, completedBuilding, nearPoint } from "../tribe-places.ts";
import { headTo, type Job, walk } from "./job.ts";

const HEAVY_LOAD = 3;
const HEAVY_LOAD_SPEED = 0.85;
const DROP_SPREAD = 3;

function deliveryPoint(tick: PersonTick): Waypoint {
  const { buildings, random } = tick.context;

  const storehouse = completedBuilding(buildings, tick.tribe.buildings.storehouseId);

  return nearPoint(storehouse === null ? campPoint(tick.tribe) : storehouse, DROP_SPREAD, random);
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
