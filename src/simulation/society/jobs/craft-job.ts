import { BUILDINGS } from "../../../content/buildings.ts";
import { RECIPES, type ResourceAmounts } from "../../../content/recipes.ts";
import { TOOL_MATERIAL_DEFINITIONS } from "../../../content/weapons.ts";
import type { PersonTick, SocietyContext } from "../society-context.ts";
import { addResources, spendResources } from "../stock.ts";
import { workSeconds } from "../tools.ts";
import { learn, type Tribe } from "../tribe.ts";
import { nearCamp } from "../tribe-places.ts";
import { type CraftOrder, chooseCraft } from "../workshops.ts";
import { Errand, headTo, headToWork, type Job, type WorkTarget } from "./job.ts";

const WORKSHOP_SPEED = 1.6;
const CAMP_WORK_SPREAD = 5;
const STATION_REACH = 0.7;
const STATION_SHARE = 0.8;

export function findCraftWork(tick: PersonTick, construction: ResourceAmounts): CraftJob | null {
  const order = chooseCraft(tick.tribe, tick.context, construction);

  if (order === null) {
    return null;
  }

  return new CraftJob(tick, order);
}

function craftingSeconds(tribe: Tribe, order: CraftOrder): number {
  const seconds = workSeconds(tribe, RECIPES[order.recipe].seconds);

  if (order.station?.kind === "workshop") {
    return seconds / WORKSHOP_SPEED;
  }

  return seconds;
}

function finishOrder(tribe: Tribe, order: CraftOrder, context: SocietyContext): void {
  addResources(tribe.stock, order.outputs);
  learn(tribe, 1, context.rules);

  if (order.material === null) {
    return;
  }

  if (order.recipe !== "tools") {
    tribe.armory = order.material;

    return;
  }

  tribe.tools = order.material;
  context.chronicle.record({
    category: "discovery",
    text: `${tribe.name} made ${TOOL_MATERIAL_DEFINITIONS[order.material].name.toLowerCase()} tools`,
    tribeId: tribe.id,
    x: tribe.campX,
    z: tribe.campZ,
  });
}

export class CraftJob implements Job {
  readonly kind = "craft";
  readonly label: string;
  readonly #errand: Errand;
  readonly #order: CraftOrder;
  readonly #stationId: number | null;

  constructor(tick: PersonTick, order: CraftOrder) {
    const { station } = order;

    this.#order = order;
    this.#stationId = station === null ? null : station.id;
    this.label = RECIPES[order.recipe].label;
    spendResources(tick.tribe.stock, order.inputs);

    if (station === null) {
      this.#errand = new Errand(craftingSeconds(tick.tribe, order), "build");
      headTo(tick.person, nearCamp(tick.tribe, CAMP_WORK_SPREAD, tick.context.random), tick.context);

      return;
    }

    const target: WorkTarget = {
      radius: BUILDINGS[station.kind].footprint * STATION_SHARE,
      reach: STATION_REACH,
      x: station.x,
      z: station.z,
    };

    this.#errand = new Errand(craftingSeconds(tick.tribe, order), "build", target);
    headToWork(tick.person, target, tick.context);
  }

  update(tick: PersonTick): Job | null {
    if (this.#stationId !== null && tick.context.buildings.find(this.#stationId) === null) {
      addResources(tick.tribe.stock, this.#order.inputs);

      return null;
    }

    const progress = this.#errand.update(tick);

    if (progress === "abandoned") {
      addResources(tick.tribe.stock, this.#order.inputs);

      return null;
    }

    if (progress !== "finished") {
      return this;
    }

    finishOrder(tick.tribe, this.#order, tick.context);

    return null;
  }
}
