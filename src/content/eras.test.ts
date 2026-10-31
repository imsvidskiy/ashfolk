import { describe, expect, it } from "vitest";
import { currentEra, ERAS, nextEra } from "./eras.ts";
import { TECHNOLOGIES, type TechnologyId } from "./technologies.ts";

describe("eras", () => {
  it("list eras in the order of their indices", () => {
    expect(
      ERAS.map((era) => {
        return era.index;
      })
    ).toEqual(
      ERAS.map((_era, position) => {
        return position;
      })
    );
  });

  it("name the era after the latest milestone", () => {
    expect(currentEra(new Set()).name).toBe("Wanderers");
    expect(currentEra(new Set<TechnologyId>(["fire", "spear"])).name).toBe("Stone Age");
    expect(currentEra(new Set<TechnologyId>(["fire", "farming", "copper", "bronze"])).name).toBe("Bronze Age");
  });

  it("lead to the following era until the last one", () => {
    expect(nextEra(currentEra(new Set()))?.name).toBe("Stone Age");
    expect(nextEra(currentEra(new Set<TechnologyId>(["fire", "farming", "copper", "bronze", "iron"])))).toBeNull();
  });

  it("climb a ladder of eras, each opened by a technology learned after the previous one", () => {
    const order = TECHNOLOGIES.map((technology) => {
      return technology.id;
    });
    const keys = ERAS.map((era) => {
      return era.unlockedBy;
    }).filter((technology) => {
      return technology !== null;
    });

    expect(
      keys.map((technology) => {
        return order.indexOf(technology);
      })
    ).toEqual(
      keys
        .map((technology) => {
          return order.indexOf(technology);
        })
        .sort((first, second) => {
          return first - second;
        })
    );
  });
});
