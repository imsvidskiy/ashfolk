import { FOOD_KINDS, RESOURCE_KINDS, RESOURCES } from "../../../content/resources.ts";
import { emptyStock, type Stock, totalFood } from "../stock.ts";

export const FOOD_RESERVE = 4;

export function packFood(stock: Stock, amount: number): Stock {
  const pack = emptyStock();

  let remaining = amount;

  for (const kind of FOOD_KINDS) {
    const taken = Math.min(remaining, stock[kind]);

    pack[kind] = taken;
    stock[kind] -= taken;
    remaining -= taken;

    if (remaining <= 0) {
      break;
    }
  }

  return pack;
}

export function plunderSurplus(stock: Stock, share: number, foodReserve: number): Stock {
  const loot = packFood(stock, Math.max(0, totalFood(stock) - foodReserve) * share);

  for (const kind of RESOURCE_KINDS) {
    if (RESOURCES[kind].group === "food") {
      continue;
    }

    const taken = Math.min(stock[kind], Math.round(stock[kind] * share));

    loot[kind] = taken;
    stock[kind] -= taken;
  }

  return loot;
}

export function unpack(stock: Stock, pack: Stock): void {
  for (const kind of RESOURCE_KINDS) {
    stock[kind] += pack[kind];
    pack[kind] = 0;
  }
}

export function totalGoods(stock: Stock): number {
  return RESOURCE_KINDS.reduce((total, kind) => {
    return total + stock[kind];
  }, 0);
}

export function goodsPhrases(stock: Stock): string[] {
  const phrases: string[] = [];

  const food = totalFood(stock);

  if (food >= 1) {
    phrases.push(`${Math.round(food)} food`);
  }

  for (const kind of RESOURCE_KINDS) {
    if (RESOURCES[kind].group !== "food" && stock[kind] >= 1) {
      phrases.push(`${Math.round(stock[kind])} ${RESOURCES[kind].name.toLowerCase()}`);
    }
  }

  return phrases;
}
