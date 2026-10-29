import { describe, expect, it } from "vitest";
import { pondEdgeReach, pondOutlineExtent, pondOutlineRadius, type Spring } from "./water.ts";

const SAMPLES = 128;

function pondWithSeed(seed: number): Spring {
  return { cells: [], directionX: 1, directionZ: 0, kind: "pond", level: 0, radius: 20, river: 0, seed, x: 5, z: -3 };
}

function outlineOf(pond: Spring): number[] {
  return Array.from({ length: SAMPLES }, (_, sample) => {
    return pondOutlineRadius(pond, (sample / SAMPLES) * Math.PI * 2);
  });
}

describe("pond outline", () => {
  it("draws the same shore for the same seed and different shores for other seeds", () => {
    expect(outlineOf(pondWithSeed(0.31))).toEqual(outlineOf(pondWithSeed(0.31)));
    expect(outlineOf(pondWithSeed(0.31))).not.toEqual(outlineOf(pondWithSeed(0.62)));
  });

  it("stretches and bends the shore well past a circle and keeps it inside its extent", () => {
    for (const seed of [0.05, 0.27, 0.48, 0.71, 0.93]) {
      const pond = pondWithSeed(seed);
      const outline = outlineOf(pond);

      expect(Math.max(...outline) / Math.min(...outline)).toBeGreaterThan(1.3);
      expect(Math.min(...outline)).toBeGreaterThan(0);
      expect(Math.max(...outline)).toBeLessThanOrEqual(pondOutlineExtent(pond));
    }
  });

  it("measures the reach to the shore along the outline", () => {
    const pond = pondWithSeed(0.4);
    const radius = pondOutlineRadius(pond, Math.PI / 3);

    const x = pond.x + Math.cos(Math.PI / 3) * (radius - 2);
    const z = pond.z + Math.sin(Math.PI / 3) * (radius - 2);

    expect(pondEdgeReach(pond, x, z)).toBeCloseTo(2, 5);
  });
});
