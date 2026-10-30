import { describe, expect, it } from "vitest";
import { CROPS, hasHarvestPassed, isHarvestSeason, isSowingTime } from "./crops.ts";

describe("crops", () => {
  it("sow and harvest inside their windows, ends excluded", () => {
    const [sowingStart, sowingEnd] = CROPS.wheat.sowing;
    const [harvestStart, harvestEnd] = CROPS.wheat.harvest;

    expect(isSowingTime("wheat", sowingStart)).toBe(true);
    expect(isSowingTime("wheat", sowingEnd)).toBe(false);
    expect(isHarvestSeason("wheat", harvestStart)).toBe(true);
    expect(isHarvestSeason("wheat", harvestEnd)).toBe(false);
  });

  it("count the harvest as passed from the end of its window", () => {
    const [, harvestEnd] = CROPS.wheat.harvest;

    expect(hasHarvestPassed("wheat", harvestEnd - 0.01)).toBe(false);
    expect(hasHarvestPassed("wheat", harvestEnd)).toBe(true);
  });
});
