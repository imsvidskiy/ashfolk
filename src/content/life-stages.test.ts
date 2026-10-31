import { describe, expect, it } from "vitest";
import { ADULT_AGE, ageGroupOf, ELDER_AGE } from "./life-stages.ts";

describe("life stages", () => {
  it("count people as adults from the adult age up to the elder age", () => {
    expect(ageGroupOf(ADULT_AGE - 0.5)).toBe("child");
    expect(ageGroupOf(ADULT_AGE)).toBe("adult");
    expect(ageGroupOf(ELDER_AGE)).toBe("adult");
    expect(ageGroupOf(ELDER_AGE + 0.5)).toBe("elder");
  });
});
