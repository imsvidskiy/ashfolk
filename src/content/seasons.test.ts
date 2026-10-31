import { describe, expect, it } from "vitest";
import { isGrowingSeason, isWinter, seasonName, seasonTemperatureOffset } from "./seasons.ts";

describe("seasons", () => {
  it("names seasons in order", () => {
    expect([0, 1, 2, 3, 4.5].map(seasonName)).toEqual(["Spring", "Summer", "Autumn", "Winter", "Spring"]);
  });

  it("starts winter with the fourth season", () => {
    expect(isWinter(2.99)).toBe(false);
    expect(isWinter(3)).toBe(true);
  });

  it("lets plants grow from early spring until mid autumn", () => {
    expect([0.19, 0.2, 2.59, 2.6, 3.5].map(isGrowingSeason)).toEqual([false, true, true, false, false]);
  });

  it("is warmest in mid summer and coldest in mid winter", () => {
    expect(seasonTemperatureOffset(1.5)).toBeCloseTo(10);
    expect(seasonTemperatureOffset(3.5)).toBeCloseTo(-10);
  });
});
