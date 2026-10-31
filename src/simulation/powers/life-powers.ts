import { plantSpeciesDefinition } from "../../content/plants.ts";
import type { PowerParameters } from "../../content/powers.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { MAXIMUM_FAITH, upcomingTechnology } from "../society/tribe.ts";
import { cellsInArea } from "../world/terrain-editing.ts";
import {
  APPLIED,
  type PowerHandler,
  type PowerOutcome,
  type PowerServices,
  type PowerTarget,
  percent,
  refused,
} from "./power-handler.ts";

const ABUNDANCE_REACH = 250;
const ABUNDANCE_FOOD = 15;
const ABUNDANCE_FAITH = 8;
const DEFAULT_ABUNDANCE = 0.6;
const INSPIRATION_REACH = 600;
const INSPIRATION_FAITH = 5;
const HEALING_FAITH = 1;
const HEALED_HUNGER = 0.2;

export function tribePower(
  target: PowerTarget,
  parameters: PowerParameters<"tribe">,
  services: PowerServices
): PowerOutcome {
  const tribe = services.people.spawnTribe({
    canSettleRoughGround: true,
    context: services,
    people: parameters.people,
    x: target.x,
    z: target.z,
  });

  if (tribe === null) {
    return refused("People need flat, dry land away from fire to settle here.");
  }

  return APPLIED;
}

function herdPower<Id extends "deer" | "hare" | "ibex" | "mammoth" | "wolf">(
  kind: Id,
  refusal: string
): PowerHandler<Id> {
  return (target, parameters, services) => {
    const herd = services.fauna.spawnHerd(kind, target.x, target.z, parameters.herdSize, services.random);

    if (herd === null) {
      return refused(refusal);
    }

    return APPLIED;
  };
}

export const deerPower = herdPower("deer", "Deer need flat, dry land.");
export const mammothPower = herdPower("mammoth", "Mammoths need flat, dry land.");
export const ibexPower = herdPower("ibex", "Ibex need dry land they can stand on.");
export const harePower = herdPower("hare", "Hares need dry land away from water.");
export const wolfPower = herdPower("wolf", "Wolves need flat, dry land.");

function ripenBushes(services: PowerServices, x: number, z: number, radius: number): boolean {
  const { vegetation } = services.world;

  let hasBushes = false;

  for (const { cell } of cellsInArea(services.world, { radius, x, z })) {
    for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
      if (vegetation.isAlive(plant) && plantSpeciesDefinition(vegetation.species[plant]).givesBerries) {
        vegetation.setFruit(plant, 1);
        hasBushes = true;
      }
    }
  }

  return hasBushes;
}

export function abundancePower(
  target: PowerTarget,
  parameters: PowerParameters<"abundance">,
  services: PowerServices
): PowerOutcome {
  const hasBushes = ripenBushes(services, target.x, target.z, parameters.radius);
  const tribe = services.people.nearestTribe(target.x, target.z, parameters.radius + ABUNDANCE_REACH);

  if (!hasBushes && tribe === null) {
    return refused("There is nothing nearby to bless.");
  }

  services.effects.add({ kind: "blessing", radius: parameters.radius, style: "abundance", x: target.x, z: target.z });

  if (tribe === null) {
    return APPLIED;
  }

  tribe.stock.berries += ABUNDANCE_FOOD * (percent(parameters.strength) / DEFAULT_ABUNDANCE);
  tribe.faith = Math.min(MAXIMUM_FAITH, tribe.faith + ABUNDANCE_FAITH);
  services.chronicle.record({
    category: "gift",
    text: `${tribe.name} received a gift of abundance`,
    tribeId: tribe.id,
    x: target.x,
    z: target.z,
  });

  return APPLIED;
}

export function inspirationPower(
  target: PowerTarget,
  parameters: PowerParameters<"inspiration">,
  services: PowerServices
): PowerOutcome {
  const tribe = services.people.nearestTribe(target.x, target.z, INSPIRATION_REACH);

  if (tribe === null) {
    return refused("There is no tribe nearby to inspire.");
  }

  const upcoming = upcomingTechnology(tribe);

  if (upcoming === undefined) {
    return refused(`${tribe.name} already knows everything there is to know.`);
  }

  tribe.knowledge += upcoming.cost * percent(parameters.strength);
  tribe.faith = Math.min(MAXIMUM_FAITH, tribe.faith + INSPIRATION_FAITH);
  services.effects.add({ kind: "blessing", radius: 40, style: "inspiration", x: tribe.campX, z: tribe.campZ });
  services.chronicle.record({
    category: "gift",
    text: `${tribe.name} were struck by sudden insight`,
    tribeId: tribe.id,
    x: tribe.campX,
    z: tribe.campZ,
  });

  return APPLIED;
}

export function healingPower(
  target: PowerTarget,
  parameters: PowerParameters<"healing">,
  services: PowerServices
): PowerOutcome {
  const people = services.people.livingWithin(target.x, target.z, parameters.radius);

  if (people.length === 0) {
    return refused("There is nobody inside the circle to heal.");
  }

  for (const person of people) {
    const tribe = services.people.findTribe(person.tribeId);

    person.health = 1;
    person.hunger = Math.min(person.hunger, HEALED_HUNGER);
    person.warmth = 1;

    if (tribe !== null) {
      tribe.faith = Math.min(MAXIMUM_FAITH, tribe.faith + HEALING_FAITH);
    }
  }

  services.effects.add({ kind: "blessing", radius: parameters.radius, style: "healing", x: target.x, z: target.z });

  return APPLIED;
}
