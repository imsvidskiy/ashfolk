import { describe, expect, it } from "vitest";
import { ANIMALS, animalsAt } from "./animals.ts";
import { Biome } from "./biomes.ts";

describe("animals", () => {
  it("run faster than they walk", () => {
    for (const animal of Object.values(ANIMALS)) {
      expect(animal.runSpeed).toBeGreaterThan(animal.walkSpeed);
    }
  });

  it("list the big game of a biome without the hares", () => {
    expect(animalsAt(Biome.Meadow)).toEqual(["deer"]);
    expect(animalsAt(Biome.Desert)).toEqual([]);
  });
});
