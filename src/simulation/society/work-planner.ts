import type { ResourceAmounts } from "../../content/recipes.ts";
import { isWinter } from "../../content/seasons.ts";
import type { Building } from "./buildings.ts";
import { constructionNeeds } from "./construction.ts";
import { ERA_WORK_OPTIONS } from "./era-work.ts";
import { type FieldTask, fieldTask, neediestField } from "./farming.ts";
import { BuildJob, isExpeditionSeason, isFarSite } from "./jobs/build-job.ts";
import { findTree } from "./jobs/chop-job.ts";
import { FarmJob } from "./jobs/farm-job.ts";
import { findFishingSpot } from "./jobs/fish-job.ts";
import { findBerries } from "./jobs/gather-job.ts";
import { findGame } from "./jobs/hunt-job.ts";
import type { Job, JobKind } from "./jobs/job.ts";
import { PrayJob } from "./jobs/pray-job.ts";
import { findStone } from "./jobs/quarry-job.ts";
import { TendJob } from "./jobs/tend-job.ts";
import { isElder } from "./person.ts";
import type { PersonTick } from "./society-context.ts";
import { amountOf, totalFood } from "./stock.ts";
import { knows } from "./tribe.ts";
import { completedBuilding } from "./tribe-places.ts";
import { hasWeaponsToHunt } from "./weapons.ts";
import { foodNeed, isWorthIt, type WorkOption } from "./work-needs.ts";

const BUILD_WEIGHT = 6;
const LOW_CAMPFIRE_FUEL = 0.45;
const ELDER_HEAVY_WORK = 0.25;
const HEAVY_WORK: ReadonlySet<JobKind> = new Set(["chop", "hunt", "mine", "quarry"]);
const BASE_WOOD = 6;
const CRAFTING_WOOD = 8;
const SMALLEST_WOOD_NEED = 0.1;
const FIELD_TASK_WEIGHTS: Readonly<Record<FieldTask, number>> = { harvest: 3.6, sow: 2.6, tend: 1 };
const BASE_STONE = 4;
const MASONRY_STONE = 24;
const SPARE_STONE = 2;
const FIRE_WOOD = 4;
const LARGEST_BUILDING_PARTY = 4;
const EXPEDITION_MEALS_PER_PERSON = 2;
const COLD_SEASON_FIRE_WOOD = 12;
const AUTUMN = 2;

const WORK_OPTIONS: readonly WorkOption[] = [
  {
    kind: "build",
    start: (tick) => {
      const site = constructionSite(tick);

      if (site === null) {
        return null;
      }

      return new BuildJob(tick, site);
    },
    weight: (tick) => {
      const site = constructionSite(tick);

      if (site === null) {
        return 0;
      }

      if (!isFarSite(tick.tribe, site)) {
        return BUILD_WEIGHT;
      }

      const isUnprovisioned = totalFood(tick.tribe.stock) < tick.tribe.memberCount * EXPEDITION_MEALS_PER_PERSON;

      if (
        !isExpeditionSeason(tick.context.environment.season) ||
        expeditionBuilders(tick) >= LARGEST_BUILDING_PARTY ||
        isUnprovisioned
      ) {
        return 0;
      }

      return BUILD_WEIGHT;
    },
  },
  {
    kind: "tend",
    start: (tick) => {
      const campfire = completedBuilding(tick.context.buildings, tick.tribe.buildings.campfireId);

      if (campfire === null) {
        return null;
      }

      return new TendJob(tick, campfire);
    },
    weight: (tick) => {
      const campfire = completedBuilding(tick.context.buildings, tick.tribe.buildings.campfireId);

      if (campfire === null || campfire.fuel >= LOW_CAMPFIRE_FUEL || tick.tribe.stock.wood < 1) {
        return 0;
      }

      return 9;
    },
  },
  {
    kind: "gather",
    start: findBerries,
    weight: (tick) => {
      if (isWinter(tick.context.environment.season) || !isWorthIt(tick, "berries")) {
        return 0;
      }

      return 4 * foodNeed(tick);
    },
  },
  {
    kind: "hunt",
    start: findGame,
    weight: (tick) => {
      const isArmed = tick.person.weapon !== null || hasWeaponsToHunt(tick.tribe);

      if (!(knows(tick.tribe, "spear") && isArmed && isWorthIt(tick, "game"))) {
        return 0;
      }

      return 3.2 * foodNeed(tick) + (isWinter(tick.context.environment.season) ? 1.5 : 0);
    },
  },
  {
    kind: "fish",
    start: findFishingSpot,
    weight: (tick) => {
      if (!(knows(tick.tribe, "fishing") && isWorthIt(tick, "fish"))) {
        return 0;
      }

      return 2.6 * foodNeed(tick);
    },
  },
  {
    kind: "farm",
    start: (tick) => {
      const field = neediestField(tick.tribe, tick.context.environment.season);

      if (field === null) {
        return null;
      }

      return new FarmJob(tick, field);
    },
    weight: (tick) => {
      const { season } = tick.context.environment;

      const field = neediestField(tick.tribe, season);
      const task = field === null ? null : fieldTask(tick.tribe, field, season);

      return task === null ? 0 : FIELD_TASK_WEIGHTS[task];
    },
  },
  {
    kind: "chop",
    start: findTree,
    weight: (tick, construction) => {
      if (!isWorthIt(tick, "wood")) {
        return 0;
      }

      return 3.4 * woodNeed(tick, construction);
    },
  },
  {
    kind: "quarry",
    start: findStone,
    weight: (tick, construction) => {
      const wanted = stoneWanted(tick, construction);

      if (!(knows(tick.tribe, "huts") && isWorthIt(tick, "stone")) || tick.tribe.stock.stone >= wanted) {
        return 0;
      }

      return 2.2 * (1 - tick.tribe.stock.stone / wanted);
    },
  },
  {
    kind: "pray",
    start: (tick) => {
      const totem = completedBuilding(tick.context.buildings, tick.tribe.buildings.totemId);

      if (totem === null) {
        return null;
      }

      return new PrayJob(tick, totem);
    },
    weight: (tick) => {
      if (completedBuilding(tick.context.buildings, tick.tribe.buildings.totemId) === null) {
        return 0;
      }

      return isElder(tick.person) ? 2 : 0.4;
    },
  },
  ...ERA_WORK_OPTIONS,
];

function expeditionBuilders(tick: PersonTick): number {
  return tick.context.people.membersOf(tick.tribe).filter((member) => {
    return member.job?.kind === "build" && member.job.isExpedition === true;
  }).length;
}

function constructionSite(tick: PersonTick): Building | null {
  return tick.context.buildings.find(tick.tribe.buildings.constructionSiteId);
}

function fireWoodReserve(season: number): number {
  if (season >= AUTUMN) {
    return COLD_SEASON_FIRE_WOOD;
  }

  return FIRE_WOOD;
}

function woodNeed(tick: PersonTick, construction: ResourceAmounts): number {
  const { tribe } = tick;

  const fireWood = knows(tribe, "fire") ? fireWoodReserve(tick.context.environment.season) : 0;
  const craftWood = knows(tribe, "pottery") ? CRAFTING_WOOD : 0;

  const wanted = BASE_WOOD + amountOf(construction, "wood") + fireWood + craftWood;

  return Math.max(SMALLEST_WOOD_NEED, 1 - tribe.stock.wood / wanted);
}

function stoneWanted(tick: PersonTick, construction: ResourceAmounts): number {
  const { tribe } = tick;

  const reserve = knows(tribe, "masonry") ? MASONRY_STONE : BASE_STONE;

  return amountOf(construction, "stone") + reserve + SPARE_STONE;
}

function adjustedWeight(option: WorkOption, tick: PersonTick, construction: ResourceAmounts): number {
  const weight = option.weight(tick, construction);

  if (isElder(tick.person) && HEAVY_WORK.has(option.kind)) {
    return weight * ELDER_HEAVY_WORK;
  }

  return weight;
}

export function chooseWork(tick: PersonTick): Job | null {
  const construction = constructionNeeds(tick.tribe, tick.context);

  const candidates = WORK_OPTIONS.map((option) => {
    return { option, weight: adjustedWeight(option, tick, construction) };
  });
  const weighted = candidates.filter((candidate) => {
    return candidate.weight > 0;
  });
  const totalWeight = weighted.reduce((total, candidate) => {
    return total + candidate.weight;
  }, 0);

  if (totalWeight <= 0) {
    return null;
  }

  let remaining = tick.context.random.next() * totalWeight;

  for (const candidate of weighted) {
    remaining -= candidate.weight;

    if (remaining <= 0) {
      return candidate.option.start(tick, construction);
    }
  }

  return null;
}
