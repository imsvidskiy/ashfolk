import {
  FOOD_KINDS,
  type FoodKind,
  RESOURCE_KINDS,
  RESOURCES,
  type ResourceAmounts,
  type ResourceKind,
} from "../../content/resources.ts";

const EATING_ORDER: readonly FoodKind[] = ["fish", "meat", "berries", "fruit", "vegetables", "grain"];
const STOREHOUSE_SPOILAGE = 0.35;
const GRANARY_SPOILAGE = 0.4;
const POTTERY_SPOILAGE = 0.75;
const POTTERY_FOR_FULL_EFFECT = 10;
const OVERFLOW_SPOILAGE = 4;

export type Stock = Record<ResourceKind, number>;

export interface Storage {
  foodCapacity: number;
  hasGranary: boolean;
  hasStorehouse: boolean;
  pottery: number;
}

export function emptyStock(): Stock {
  return {
    arrows: 0,
    berries: 0,
    bows: 0,
    bronze: 0,
    clay: 0,
    copper: 0,
    copperOre: 0,
    fish: 0,
    fruit: 0,
    grain: 0,
    iron: 0,
    ironOre: 0,
    linen: 0,
    meat: 0,
    pottery: 0,
    spears: 0,
    stone: 0,
    tinOre: 0,
    vegetables: 0,
    wood: 0,
  };
}

export function totalFood(stock: Stock): number {
  return FOOD_KINDS.reduce((total, kind) => {
    return total + stock[kind];
  }, 0);
}

export function takeFood(stock: Stock, amount: number): number {
  let remaining = amount;

  for (const kind of EATING_ORDER) {
    const taken = Math.min(remaining, stock[kind]);

    stock[kind] -= taken;
    remaining -= taken;

    if (remaining <= 0) {
      break;
    }
  }

  return amount - remaining;
}

export function shareFood(stock: Stock, share: number): Stock {
  const portion = emptyStock();

  for (const kind of FOOD_KINDS) {
    const amount = Math.floor(stock[kind] * share);

    portion[kind] = amount;
    stock[kind] -= amount;
  }

  return portion;
}

export function amountOf(amounts: ResourceAmounts, kind: ResourceKind): number {
  const amount = amounts[kind];

  if (amount === undefined) {
    return 0;
  }

  return amount;
}

export function hasResources(stock: Stock, amounts: ResourceAmounts): boolean {
  return RESOURCE_KINDS.every((kind) => {
    return stock[kind] >= amountOf(amounts, kind);
  });
}

export function spendResources(stock: Stock, amounts: ResourceAmounts): void {
  for (const kind of RESOURCE_KINDS) {
    stock[kind] -= amountOf(amounts, kind);
  }
}

export function addResources(stock: Stock, amounts: ResourceAmounts): void {
  for (const kind of RESOURCE_KINDS) {
    stock[kind] += amountOf(amounts, kind);
  }
}

function spoilageFactor(kind: FoodKind, storage: Storage): number {
  let factor = 1;

  if (storage.hasStorehouse) {
    factor *= STOREHOUSE_SPOILAGE;
  }

  if (storage.hasGranary && RESOURCES[kind].isKeptInGranary) {
    factor *= GRANARY_SPOILAGE;
  }

  const potteryShare = Math.min(1, storage.pottery / POTTERY_FOR_FULL_EFFECT);

  return factor * (1 - (1 - POTTERY_SPOILAGE) * potteryShare);
}

export function spoilFood(stock: Stock, days: number, storage: Storage): void {
  const food = totalFood(stock);

  const overflow = food > storage.foodCapacity ? OVERFLOW_SPOILAGE : 1;

  for (const kind of FOOD_KINDS) {
    const rate = RESOURCES[kind].spoilagePerDay * spoilageFactor(kind, storage) * overflow;

    stock[kind] = Math.max(0, stock[kind] - stock[kind] * rate * days);
  }
}
