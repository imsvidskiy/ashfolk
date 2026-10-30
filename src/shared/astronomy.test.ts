import { describe, expect, it } from "vitest";
import { moonDirection, sunDirection } from "./astronomy.ts";

const SUMMER_SOLSTICE = 1;
const WINTER_SOLSTICE = 3;

describe("sun direction", () => {
  it("returns a unit vector", () => {
    const { x, y, z } = sunDirection(9.5, 0.4);

    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
  });

  it("stands high at a summer noon and below the horizon at midnight", () => {
    expect(sunDirection(12, SUMMER_SOLSTICE).y).toBeGreaterThan(0.9);
    expect(sunDirection(0, SUMMER_SOLSTICE).y).toBeLessThan(0);
  });

  it("stays lower in winter than in summer", () => {
    expect(sunDirection(12, WINTER_SOLSTICE).y).toBeLessThan(sunDirection(12, SUMMER_SOLSTICE).y);
  });

  it("rises in the east and sets in the west", () => {
    expect(sunDirection(8, SUMMER_SOLSTICE).x).toBeGreaterThan(0.3);
    expect(sunDirection(16, SUMMER_SOLSTICE).x).toBeLessThan(-0.3);
  });

  it("shines from the south at noon", () => {
    expect(sunDirection(12, WINTER_SOLSTICE).z).toBeGreaterThan(0.5);
  });
});

describe("moon direction", () => {
  it("is up at midnight and down at noon", () => {
    expect(moonDirection(0).y).toBeGreaterThan(0.5);
    expect(moonDirection(12).y).toBeLessThan(-0.5);
  });
});
