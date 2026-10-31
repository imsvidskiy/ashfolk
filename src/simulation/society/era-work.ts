import { DEPOSITS, type DepositKind, MINED_DEPOSIT_KINDS } from "../../content/deposits.ts";
import type { RecipeId, ResourceAmounts } from "../../content/recipes.ts";
import { isWinter } from "../../content/seasons.ts";
import { isComplete } from "./buildings.ts";
import { mineFor } from "./camp-plan.ts";
import { isExpeditionSeason } from "./jobs/build-job.ts";
import { findClay } from "./jobs/clay-job.ts";
import { findCraftWork } from "./jobs/craft-job.ts";
import { findFruit } from "./jobs/gather-job.ts";
import { findMineWork, MineJob } from "./jobs/mine-job.ts";
import { findPlanting, freeSpot } from "./jobs/plant-job.ts";
import { carriedAmount } from "./person.ts";
import { ripestFruitTree } from "./plots.ts";
import type { PersonTick } from "./society-context.ts";
import { amountOf } from "./stock.ts";
import { knows } from "./tribe.ts";
import { foodNeed, isWorthIt, type WorkOption } from "./work-needs.ts";
import { chooseCraft } from "./workshops.ts";

export const ERA_WORK_OPTIONS: readonly WorkOption[] = [
  {
    kind: "clay",
    start: findClay,
    weight: (tick, construction) => {
      const { season } = tick.context.environment;

      const wanted = clayWanted(tick, construction);

      if (!knows(tick.tribe, "pottery") || wanted <= 0 || !isWorthIt(tick, "clay") || !isExpeditionSeason(season)) {
        return 0;
      }

      return 2.2 * Math.max(0, 1 - tick.tribe.stock.clay / wanted);
    },
  },
  {
    kind: "mine",
    start: (tick) => {
      const ore = neediestOre(tick);

      if (ore === null) {
        return null;
      }

      return findMineWork(tick, ore);
    },
    weight: (tick) => {
      const ore = neediestOre(tick);

      if (ore === null || !isExpeditionSeason(tick.context.environment.season)) {
        return 0;
      }

      return 2.4 * oreNeed(tick, ore);
    },
  },
  {
    kind: "craft",
    start: findCraftWork,
    weight: (tick, construction) => {
      const order = chooseCraft(tick.tribe, tick.context, construction);

      if (order === null) {
        return 0;
      }

      return CRAFT_WEIGHTS[order.recipe];
    },
  },
  {
    kind: "plant",
    start: findPlanting,
    weight: (tick) => {
      if (isWinter(tick.context.environment.season) || freeSpot(tick) === null) {
        return 0;
      }

      return 1.3;
    },
  },
  {
    kind: "pick",
    start: findFruit,
    weight: (tick) => {
      if (ripestFruitTree(tick.tribe, tick.context.world) === null) {
        return 0;
      }

      return 3 * foodNeed(tick) + 0.6;
    },
  },
];

const ORE_TARGETS: Readonly<Record<DepositKind, number>> = { clay: 0, copper: 14, iron: 14, tin: 9 };
const POTTERY_CLAY = 6;
const POTTERY_STOCK = 12;
const MINERS_SHARE = 8;
const CRAFT_WEIGHTS: Readonly<Record<RecipeId, number>> = {
  arrows: 0.8,
  bows: 0.8,
  bronze: 2.4,
  copper: 2.4,
  iron: 2.4,
  pottery: 2,
  spears: 1,
  tools: 2.6,
};

function clayWanted(tick: PersonTick, construction: ResourceAmounts): number {
  const { tribe } = tick;

  const forPottery = tribe.stock.pottery < POTTERY_STOCK ? POTTERY_CLAY : 0;

  return amountOf(construction, "clay") + forPottery;
}

function oreOnTheWay(tick: PersonTick, kind: DepositKind): number {
  const { resource } = DEPOSITS[kind];

  return tick.context.people.membersOf(tick.tribe).reduce((total, person) => {
    const minerShare = person.job instanceof MineJob && person.job.ore === kind ? MINERS_SHARE : 0;

    return total + carriedAmount(person, resource) + minerShare;
  }, 0);
}

function oreNeed(tick: PersonTick, kind: DepositKind): number {
  const mine = mineFor(tick.tribe, tick.context, kind);

  if (mine === null || !isComplete(mine)) {
    return 0;
  }

  const stocked = tick.tribe.stock[DEPOSITS[kind].resource] + oreOnTheWay(tick, kind);

  return Math.max(0, 1 - stocked / ORE_TARGETS[kind]);
}

function neediestOre(tick: PersonTick): DepositKind | null {
  let neediest: DepositKind | null = null;
  let neediestNeed = 0;

  for (const kind of MINED_DEPOSIT_KINDS) {
    const need = oreNeed(tick, kind);

    if (need > neediestNeed) {
      neediest = kind;
      neediestNeed = need;
    }
  }

  return neediest;
}
