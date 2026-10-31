import { DEPOSITS, MINED_DEPOSIT_KINDS, type MinedDepositKind } from "../../content/deposits.ts";
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

      return findMineWork(tick, ore.kind);
    },
    weight: (tick) => {
      if (!isExpeditionSeason(tick.context.environment.season)) {
        return 0;
      }

      const ore = neediestOre(tick);

      if (ore === null) {
        return 0;
      }

      return 2.4 * ore.need;
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

const ORE_TARGETS: Readonly<Record<MinedDepositKind, number>> = { copper: 14, iron: 14, tin: 9 };
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

interface OreNeed {
  kind: MinedDepositKind;
  need: number;
}

function clayWanted(tick: PersonTick, construction: ResourceAmounts): number {
  const { tribe } = tick;

  const forPottery = tribe.stock.pottery < POTTERY_STOCK ? POTTERY_CLAY : 0;

  return amountOf(construction, "clay") + forPottery;
}

function hasCompleteMine(tick: PersonTick, kind: MinedDepositKind): boolean {
  const mine = mineFor(tick.tribe, tick.context, kind);

  return mine !== null && isComplete(mine);
}

function oreOnTheWay(tick: PersonTick): Record<MinedDepositKind, number> {
  const onTheWay: Record<MinedDepositKind, number> = { copper: 0, iron: 0, tin: 0 };

  for (const person of tick.context.people.membersOf(tick.tribe)) {
    for (const kind of MINED_DEPOSIT_KINDS) {
      const minerShare = person.job instanceof MineJob && person.job.ore === kind ? MINERS_SHARE : 0;

      onTheWay[kind] = onTheWay[kind] + carriedAmount(person, DEPOSITS[kind].resource) + minerShare;
    }
  }

  return onTheWay;
}

function neediestOre(tick: PersonTick): OreNeed | null {
  const mined = MINED_DEPOSIT_KINDS.filter((kind) => {
    return hasCompleteMine(tick, kind);
  });

  if (mined.length === 0) {
    return null;
  }

  const onTheWay = oreOnTheWay(tick);

  let neediest: OreNeed | null = null;

  for (const kind of mined) {
    const stocked = tick.tribe.stock[DEPOSITS[kind].resource] + onTheWay[kind];
    const need = Math.max(0, 1 - stocked / ORE_TARGETS[kind]);

    if (need > (neediest === null ? 0 : neediest.need)) {
      neediest = { kind, need };
    }
  }

  return neediest;
}
