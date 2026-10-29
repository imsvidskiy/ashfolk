import type { Waypoint } from "../../agents/navigation.ts";
import { carriedFood, type Person, putDown } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { takeFood, totalFood } from "../stock.ts";
import type { Tribe } from "../tribe.ts";
import { litCampfireOf } from "../tribe-places.ts";
import { Errand, headTo, type Job } from "./job.ts";

const MEAL_SECONDS = 2.5;
const MEAL_HUNGER_RELIEF = 0.55;
const COOKED_MEAL_BONUS = 0.2;

export function eatProvisions(person: Person, tribe: Tribe): void {
  eatMeal(person, tribe, false);
}

function eatMeal(person: Person, tribe: Tribe, isCooked: boolean): void {
  if (!takeFoodPortion(person, tribe)) {
    return;
  }

  const relief = MEAL_HUNGER_RELIEF + (isCooked ? COOKED_MEAL_BONUS : 0);

  person.hunger = Math.max(0, person.hunger - relief);
}

function takeFoodPortion(person: Person, tribe: Tribe): boolean {
  if (carriedFood(person) >= 1) {
    putDown(person, 1);

    return true;
  }

  if (totalFood(tribe.stock) < 1) {
    return false;
  }

  takeFood(tribe.stock, 1);

  return true;
}

export class EatJob implements Job {
  readonly kind = "eat";
  readonly #errand = new Errand(MEAL_SECONDS, "eat");

  constructor(tick: PersonTick, place: Waypoint) {
    headTo(tick.person, place, tick.context);
  }

  update(tick: PersonTick): Job | null {
    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    const isCooked = litCampfireOf(tick.tribe, tick.context.buildings) !== null;

    eatMeal(tick.person, tick.tribe, isCooked);

    return null;
  }
}
