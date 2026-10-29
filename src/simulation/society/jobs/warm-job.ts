import { FULL_TURN } from "../../../shared/math.ts";
import { aroundPoint } from "../../agents/navigation.ts";
import type { PersonTick } from "../society-context.ts";
import type { WarmPlace } from "../warmth.ts";
import { Errand, headTo, type Job } from "./job.ts";

const WARMING_SECONDS = 18;
const WARM_ENOUGH = 0.95;

export class WarmJob implements Job {
  readonly kind = "warm";
  readonly #buildingId: number;
  readonly #errand: Errand;

  constructor(tick: PersonTick, place: WarmPlace) {
    const seat = aroundPoint(place.building, place.seat, tick.context.random.next() * FULL_TURN);

    this.#buildingId = place.building.id;
    this.#errand = new Errand(WARMING_SECONDS, "sit", place.building);
    headTo(tick.person, seat, tick.context);
  }

  update(tick: PersonTick): Job | null {
    if (tick.context.buildings.find(this.#buildingId) === null) {
      return null;
    }

    const progress = this.#errand.update(tick);

    if (progress === "finished" || progress === "abandoned" || tick.person.warmth > WARM_ENOUGH) {
      return null;
    }

    return this;
  }
}
