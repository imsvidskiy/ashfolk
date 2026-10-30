import { describe, expect, it } from "vitest";
import { isWinter, seasonName, seasonTemperatureOffset } from "./seasons.ts";

describe("seasons", () => {
  it("names seasons in order", () => {
    expect([0, 1, 2, 3, 4.5].map(seasonName)).toEqual(["Spring", "Summer", "Autumn", "Winter", "Spring"]);
  });

  it("starts winter with the fourth season", () => {
    expect(isWinter(2.99)).toBe(false);
    expect(isWinter(3)).toBe(true);
  });

  it("is warmest in mid summer and coldest in mid winter", () => {
    expect(seasonTemperatureOffset(1.5)).toBeCloseTo(10);
    expect(seasonTemperatureOffset(3.5)).toBeCloseTo(-10);
  });
});
