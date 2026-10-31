import { BUILDINGS } from "../../../content/buildings.ts";
import { type Building, isComplete } from "../buildings.ts";
import { completeConstruction } from "../construction.ts";
import type { PersonTick } from "../society-context.ts";
import { workSpeed } from "../tools.ts";
import type { Tribe } from "../tribe.ts";
import { Errand, headTo, type Job } from "./job.ts";

const EXPEDITION_DISTANCE = 220;
const FIRST_SEASON_FOR_EXPEDITIONS = 0.3;
const LAST_SEASON_FOR_EXPEDITIONS = 2.4;
const BUILDER_SPREAD = 3;
const NEAREST_BUILDER_STANDOFF = 4;
const FARTHEST_BUILDER_STANDOFF = 6;

export function isFarSite(tribe: Tribe, site: Building): boolean {
  return Math.hypot(site.x - tribe.campX, site.z - tribe.campZ) > EXPEDITION_DISTANCE;
}

export function isExpeditionSeason(season: number): boolean {
  return season >= FIRST_SEASON_FOR_EXPEDITIONS && season < LAST_SEASON_FOR_EXPEDITIONS;
}

export class BuildJob implements Job {
  readonly isExpedition: boolean;
  readonly kind = "build";
  readonly #errand: Errand;
  readonly #siteId: number;

  constructor(tick: PersonTick, site: Building) {
    const { random } = tick.context;

    const standing = {
      x: site.x + random.signed() * BUILDER_SPREAD,
      z: site.z + random.between(NEAREST_BUILDER_STANDOFF, FARTHEST_BUILDER_STANDOFF),
    };

    this.isExpedition = isFarSite(tick.tribe, site);
    this.#errand = new Errand(Number.POSITIVE_INFINITY, "build", site);
    this.#siteId = site.id;
    headTo(tick.person, standing, tick.context);
  }

  update(tick: PersonTick): Job | null {
    const site = tick.context.buildings.find(this.#siteId);

    if (site === null || isComplete(site)) {
      return null;
    }

    const progress = this.#errand.update(tick);

    if (progress !== "working") {
      return progress === "abandoned" ? null : this;
    }

    site.progress = Math.min(1, site.progress + (tick.seconds * workSpeed(tick.tribe)) / BUILDINGS[site.kind].work);

    if (!isComplete(site)) {
      return this;
    }

    completeConstruction(tick.tribe, site, tick.context);

    return null;
  }
}
