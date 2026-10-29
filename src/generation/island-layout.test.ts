import { describe, expect, it } from "vitest";
import { LAYOUT_ARCHETYPES, mountainMaskAt, planIslandLayout } from "./island-layout.ts";

const SEEDS = Array.from({ length: 30 }, (_, index) => {
  return index + 1;
});

describe("island layout", () => {
  it("comes out the same for one seed", () => {
    for (const seed of [1, 7, 23]) {
      expect(planIslandLayout(seed)).toEqual(planIslandLayout(seed));
    }
  });

  it("picks most archetypes across thirty seeds", () => {
    const archetypes = new Set(
      SEEDS.map((seed) => {
        return planIslandLayout(seed).archetype;
      })
    );

    expect(archetypes.size).toBeGreaterThanOrEqual(LAYOUT_ARCHETYPES.length - 1);
  });

  it("raises mountains somewhere on every island and keeps the coast clear of crests", () => {
    for (const seed of SEEDS) {
      const layout = planIslandLayout(seed);

      const highest = Math.max(
        ...Array.from({ length: 41 * 41 }, (_, index) => {
          return mountainMaskAt(layout, (index % 41) / 20 - 1, Math.floor(index / 41) / 20 - 1);
        })
      );

      expect(highest).toBeGreaterThan(0.45);

      for (const range of layout.ranges) {
        for (const [x, z] of range.points) {
          expect(Math.hypot(x, z)).toBeLessThanOrEqual(0.75);
        }
      }
    }
  });

  it("varies the climate, leaving some islands without a desert", () => {
    const climates = SEEDS.map((seed) => {
      return planIslandLayout(seed).climate;
    });
    const deserts = climates.filter((climate) => {
      return climate.desert !== null;
    });
    const temperatures = climates.map((climate) => {
      return climate.temperatureOffset;
    });

    expect(deserts.length).toBeGreaterThan(SEEDS.length / 2);
    expect(deserts.length).toBeLessThan(SEEDS.length);
    expect(Math.max(...temperatures) - Math.min(...temperatures)).toBeGreaterThan(3);

    for (const climate of climates) {
      expect(climate.wetlandShare).toBeGreaterThan(0.015);
      expect(climate.wetlandShare).toBeLessThan(0.06);
    }
  });
});
