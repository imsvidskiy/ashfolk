import { describe, expect, it } from "vitest";
import { formIndexOf, jitterOf, pieceSeed } from "./monuments.ts";
import { PlantSpecies } from "./plants.ts";

describe("monument pieces", () => {
  it("read the form and the jitter back from a seed", () => {
    const seed = pieceSeed(PlantSpecies.Menhir, "broken", 0.3);

    expect(formIndexOf(PlantSpecies.Menhir, seed)).toBe(2);
    expect(jitterOf(PlantSpecies.Menhir, seed)).toBeCloseTo(0.3);
  });
});
