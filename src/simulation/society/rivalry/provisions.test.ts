import { describe, expect, it } from "vitest";
import { emptyStock, totalFood } from "../stock.ts";
import { packFood, plunderSurplus, totalGoods, unpack } from "./provisions.ts";

describe("provisions", () => {
  it("pack food one kind after another until the amount is met", () => {
    const stores = { ...emptyStock(), berries: 3, fish: 10, meat: 4 };

    const pack = packFood(stores, 9);

    expect(pack).toMatchObject({ berries: 3, fish: 2, meat: 4 });
    expect(stores).toMatchObject({ berries: 0, fish: 8, meat: 0 });
  });

  it("plunder a share of the food above the reserve and of every other good", () => {
    const stores = { ...emptyStock(), copper: 3, meat: 60, wood: 30 };

    const loot = plunderSurplus(stores, 0.1, 20);

    expect(totalFood(loot)).toBeCloseTo(4);
    expect(loot).toMatchObject({ copper: 0, wood: 3 });
    expect(stores).toMatchObject({ copper: 3, wood: 27 });
    expect(totalFood(plunderSurplus({ ...emptyStock(), meat: 15 }, 0.5, 20))).toBe(0);
  });

  it("empty a pack into the stores", () => {
    const stores = { ...emptyStock(), wood: 5 };
    const pack = { ...emptyStock(), meat: 2, wood: 3 };

    unpack(stores, pack);

    expect(stores).toMatchObject({ meat: 2, wood: 8 });
    expect(totalGoods(pack)).toBe(0);
    expect(totalGoods(stores)).toBe(10);
  });
});
