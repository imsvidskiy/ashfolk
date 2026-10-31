import { describe, expect, it } from "vitest";
import type { FoodKind } from "../../content/resources.ts";
import { emptyStock, type Storage, shareFood, spoilFood, takeFood } from "./stock.ts";

const OPEN_STORAGE: Storage = { foodCapacity: 100, hasGranary: false, hasStorehouse: false, pottery: 0 };

function spoiled(kind: FoodKind, storage: Partial<Storage>): number {
  const stock = emptyStock();

  stock[kind] = 10;
  spoilFood(stock, 1, { ...OPEN_STORAGE, ...storage });

  return 10 - stock[kind];
}

describe("eating from the stock", () => {
  it("eats fish and meat before the food that keeps", () => {
    const stock = emptyStock();

    stock.berries = 5;
    stock.fish = 1;
    stock.grain = 10;
    stock.meat = 1;

    expect(takeFood(stock, 3)).toBe(3);
    expect(stock).toMatchObject({ berries: 4, fish: 0, grain: 10, meat: 0 });
  });

  it("takes no more than there is", () => {
    const stock = emptyStock();

    stock.fruit = 1.5;
    stock.vegetables = 0.5;

    expect(takeFood(stock, 5)).toBe(2);
    expect(stock).toMatchObject({ fruit: 0, vegetables: 0 });
  });
});

describe("sharing food", () => {
  it("hands over a whole share of each food and no materials", () => {
    const stock = emptyStock();

    stock.berries = 10;
    stock.grain = 7;
    stock.wood = 5;

    const portion = shareFood(stock, 0.4);

    expect(portion).toMatchObject({ berries: 4, grain: 2, wood: 0 });
    expect(stock).toMatchObject({ berries: 6, grain: 5, wood: 5 });
  });
});

describe("spoiling food", () => {
  it("spoils slower in a storehouse and in pots, and faster when the stores overflow", () => {
    const open = spoiled("berries", {});

    expect(spoiled("berries", { hasStorehouse: true })).toBeLessThan(open);
    expect(spoiled("berries", { pottery: 10 })).toBeLessThan(open);
    expect(spoiled("berries", { pottery: 20 })).toBeCloseTo(spoiled("berries", { pottery: 10 }));
    expect(spoiled("berries", { foodCapacity: 5 })).toBeGreaterThan(open);
  });

  it("keeps only granary food better in a granary", () => {
    expect(spoiled("grain", { hasGranary: true })).toBeLessThan(spoiled("grain", {}));
    expect(spoiled("berries", { hasGranary: true })).toBeCloseTo(spoiled("berries", {}));
  });
});
