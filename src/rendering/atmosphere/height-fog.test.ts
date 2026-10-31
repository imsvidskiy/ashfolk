import { describe, expect, it } from "vitest";
import { fogShapeFor } from "./height-fog.ts";

const CLEAR_NOON = { mist: 0, precipitation: 0, snowfall: 0, sunHeight: 0.9 };

describe("fog shape", () => {
  it("adds haze while the sun stays low, but not at noon or at night", () => {
    const noon = fogShapeFor(CLEAR_NOON);
    const morning = fogShapeFor({ ...CLEAR_NOON, sunHeight: 0.1 });
    const night = fogShapeFor({ ...CLEAR_NOON, sunHeight: -0.5 });

    expect(morning.density).toBeGreaterThan(noon.density);
    expect(night.density).toBe(noon.density);
  });

  it("thickens and lowers the layer in mist", () => {
    const clear = fogShapeFor(CLEAR_NOON);
    const misty = fogShapeFor({ ...CLEAR_NOON, mist: 1 });

    expect(misty.density).toBeGreaterThan(clear.density * 20);
    expect(misty.falloff).toBeGreaterThan(clear.falloff);
  });

  it("thickens in rain", () => {
    const clear = fogShapeFor(CLEAR_NOON);
    const rainy = fogShapeFor({ ...CLEAR_NOON, precipitation: 1 });

    expect(rainy.density).toBeGreaterThan(clear.density);
    expect(rainy.veil).toBeGreaterThan(clear.veil);
  });

  it("hangs a thicker veil in snowfall than in rain", () => {
    const rainy = fogShapeFor({ ...CLEAR_NOON, precipitation: 1 });
    const snowy = fogShapeFor({ ...CLEAR_NOON, precipitation: 1, snowfall: 1 });

    expect(snowy.veil).toBeGreaterThan(rainy.veil);
  });
});
