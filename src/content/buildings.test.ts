import { describe, expect, it } from "vitest";
import { BUILDINGS, isLitCampfire, LIT_CAMPFIRE_FUEL } from "./buildings.ts";

describe("buildings", () => {
  it("take some work to build", () => {
    for (const building of Object.values(BUILDINGS)) {
      expect(building.work).toBeGreaterThan(0);
    }
  });

  it("light only a finished campfire with fuel left", () => {
    const fuel = LIT_CAMPFIRE_FUEL * 2;

    expect(isLitCampfire({ fuel, kind: "campfire", progress: 1 })).toBe(true);
    expect(isLitCampfire({ fuel, kind: "campfire", progress: 0.9 })).toBe(false);
    expect(isLitCampfire({ fuel: LIT_CAMPFIRE_FUEL, kind: "campfire", progress: 1 })).toBe(false);
    expect(isLitCampfire({ fuel, kind: "kiln", progress: 1 })).toBe(false);
  });
});
