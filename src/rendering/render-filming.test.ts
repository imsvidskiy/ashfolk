import { describe, expect, it } from "vitest";
import { filmedQuality, type RenderFilming } from "./render-filming.ts";
import { RENDER_QUALITY } from "./render-quality.ts";

const NOT_FILMING: RenderFilming = {
  areMarkersHidden: false,
  hasFarPlants: false,
  hasFarShadows: false,
  hasFinestGround: false,
  hasSharpestShadows: false,
};

describe("filmed quality", () => {
  it("keeps the chosen quality while nothing is filmed", () => {
    expect(filmedQuality(RENDER_QUALITY.high, NOT_FILMING, 16_384)).toEqual(RENDER_QUALITY.high);
  });

  it("sharpens shadows up to what the adapter can hold", () => {
    const filming = { ...NOT_FILMING, hasSharpestShadows: true };

    expect(filmedQuality(RENDER_QUALITY.medium, filming, 16_384).shadowMapSize).toBe(8192);
    expect(filmedQuality(RENDER_QUALITY.medium, filming, 4096).shadowMapSize).toBe(4096);
    expect(filmedQuality(RENDER_QUALITY.high, filming, 0).shadowMapSize).toBe(RENDER_QUALITY.high.shadowMapSize);
  });

  it("draws the finest ground everywhere", () => {
    const quality = filmedQuality(RENDER_QUALITY.low, { ...NOT_FILMING, hasFinestGround: true }, 8192);

    expect(quality.terrainDetail).toBe(Number.POSITIVE_INFINITY);
    expect(quality.vegetationDetail).toBe(RENDER_QUALITY.low.vegetationDetail);
  });

  it("keeps detailed plants farther away", () => {
    const quality = filmedQuality(RENDER_QUALITY.high, { ...NOT_FILMING, hasFarPlants: true }, 8192);

    expect(quality.vegetationDetail).toBe(4);
    expect(quality.terrainDetail).toBe(RENDER_QUALITY.high.terrainDetail);
  });
});
