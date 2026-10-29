import { describe, expect, it } from "vitest";
import {
  BASIN_SEPARATION,
  coneHeightAt,
  FARTHEST_BASIN,
  LAYOUT_ARCHETYPES,
  mountainMaskAt,
  planIslandLayout,
} from "./island-layout.ts";

const SEEDS = Array.from({ length: 30 }, (_, index) => {
  return index + 1;
});
const COAST_RADIUS = 0.95;
const COAST_SAMPLES = 360;

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

      for (let sample = 0; sample < COAST_SAMPLES; sample += 1) {
        const angle = (sample / COAST_SAMPLES) * 2 * Math.PI;
        const x = COAST_RADIUS * Math.cos(angle);
        const z = COAST_RADIUS * Math.sin(angle);

        expect(mountainMaskAt(layout, x, z)).toBeLessThan(0.7);
        expect(coneHeightAt(layout.cones, x, z)).toBeLessThan(1);
      }
    }
  });

  it("plans one or two lake basins apart from each other and near the center", () => {
    for (const seed of SEEDS) {
      const { basins } = planIslandLayout(seed);

      expect(basins.length).toBeGreaterThanOrEqual(1);
      expect(basins.length).toBeLessThanOrEqual(2);

      for (const [index, basin] of basins.entries()) {
        expect(Math.hypot(basin.x, basin.z)).toBeLessThanOrEqual(FARTHEST_BASIN);

        for (const other of basins.slice(index + 1)) {
          expect(Math.hypot(basin.x - other.x, basin.z - other.z)).toBeGreaterThanOrEqual(BASIN_SEPARATION);
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
