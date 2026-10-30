import { beforeAll, describe, expect, it, it as test } from "vitest";
import { ISLAND_SHAPES } from "../world/island-shape.ts";
import { islandDimensions } from "../world/island-size.ts";
import { DEFAULT_GENERATION_OPTIONS, type GenerationProgress, type IslandSketch } from "./generation-options.ts";
import { COARSE_DIMENSIONS, coarseWorld, FULL_SIZE_TIMEOUT, islandsAcrossSeeds } from "./testing/generated-worlds.ts";
import { type IslandSurvey, surveyIsland } from "./testing/island-survey.ts";
import { endsAwayFromWater, mouthFaults, riverFaults } from "./testing/water-checks.ts";
import { type GeneratedWorld, generateWorld } from "./world-generator.ts";

const DETERMINISM_DIMENSIONS = { cellSize: 20, cellsPerSide: 128 };
const DETERMINISM_SEEDS = [7, 11, 13];

describe("world generation", () => {
  const stages = new Set<string>();
  const sketches = new Map<string, IslandSketch | null>();

  let world: GeneratedWorld;

  beforeAll(() => {
    world = generateWorld(
      7,
      { dimensions: COARSE_DIMENSIONS, erosionStrength: 1, shape: "round" },
      (progress: GenerationProgress) => {
        stages.add(progress.stage);
        sketches.set(progress.stage, progress.island);
      }
    );
  });

  it("reports every stage", () => {
    expect([...stages].sort()).toEqual(["climate", "erosion", "relief", "vegetation", "water"]);
  });

  it("sketches the island as it forms", () => {
    expect(sketches.get("relief")).toBeNull();
    expect(sketches.get("erosion")).toMatchObject({ ground: null, waterSurface: null });
    expect(sketches.get("climate")).toMatchObject({ ground: null, waterSurface: expect.any(Float32Array) });
    expect(sketches.get("vegetation")).toMatchObject({
      ground: expect.any(Uint8Array),
      waterSurface: expect.any(Float32Array),
    });
  });

  it("differs between seeds", () => {
    expect(coarseWorld(8).terrain.height).not.toEqual(world.terrain.height);
  });

  it("produces many biomes and a living vegetation cover", () => {
    expect(new Set(world.terrain.biome).size).toBeGreaterThanOrEqual(8);
    expect(world.vegetation.aliveCount).toBeGreaterThan(1000);
  });
});

describe.each(ISLAND_SHAPES)("a %s world generated twice from one seed", (shape) => {
  test("comes out the same in every stage", () => {
    const options = { dimensions: DETERMINISM_DIMENSIONS, erosionStrength: 1, shape };

    const firsts = DETERMINISM_SEEDS.map((seed) => {
      return generateWorld(seed, options);
    });

    expect(
      firsts.some((first) => {
        return first.crossings.length > 0;
      })
    ).toBe(true);
    expect(
      firsts.some((first) => {
        return first.deposits.length > 0;
      })
    ).toBe(true);
    expect(
      firsts.some((first) => {
        return first.monuments.length > 0;
      })
    ).toBe(true);

    for (const [index, seed] of DETERMINISM_SEEDS.entries()) {
      const again = generateWorld(seed, options);

      expect(again).toEqual(firsts[index]);
      expect(again.vegetation.exportBuffers()).toEqual(firsts[index].vegetation.exportBuffers());
    }
  });
});

describe("islands across seeds", () => {
  let surveys: IslandSurvey[];

  beforeAll(() => {
    const { round, square } = islandsAcrossSeeds();

    surveys = [...round, ...square].map(surveyIsland);
  }, FULL_SIZE_TIMEOUT);

  it("leaves every island enough flat land, rivers and a lake", () => {
    for (const survey of surveys) {
      expect(survey.flatShare).toBeGreaterThan(0.06);
      expect(survey.rivers).toBeGreaterThanOrEqual(15);
      expect(survey.lakes).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("small and large islands", () => {
  let small: GeneratedWorld;
  let large: GeneratedWorld;
  let largeSquare: GeneratedWorld;

  beforeAll(() => {
    small = generateWorld(7, { ...DEFAULT_GENERATION_OPTIONS, dimensions: islandDimensions("small") });
    large = generateWorld(1, { ...DEFAULT_GENERATION_OPTIONS, dimensions: islandDimensions("large") });
    largeSquare = generateWorld(2, {
      ...DEFAULT_GENERATION_OPTIONS,
      dimensions: islandDimensions("large"),
      shape: "square",
    });
  }, FULL_SIZE_TIMEOUT);

  it("grows each island on its own grid", () => {
    expect(small.dimensions).toEqual(islandDimensions("small"));
    expect(small.terrain.height).toHaveLength(512 * 512);
    expect(large.terrain.height).toHaveLength(768 * 768);
  });

  it("ends every river in water and keeps it falling to its mouth", () => {
    for (const generated of [small, large, largeSquare]) {
      expect(endsAwayFromWater(generated)).toEqual([]);
      expect(riverFaults(generated)).toEqual([]);
      expect(mouthFaults(generated)).toEqual([]);
    }
  });

  it("leaves flat land, rivers and lakes, more of them on the larger island", () => {
    const smallSurvey = surveyIsland(small);
    const largeSurvey = surveyIsland(large);

    for (const survey of [smallSurvey, largeSurvey, surveyIsland(largeSquare)]) {
      expect(survey.flatShare).toBeGreaterThan(0.06);
      expect(survey.lakes).toBeGreaterThanOrEqual(1);
      expect(survey.rivers).toBeGreaterThanOrEqual(8);
    }

    expect(largeSurvey.rivers).toBeGreaterThan(smallSurvey.rivers);
  });

  it("plants as densely on the large island as on the small one", () => {
    const densities = [small, large].map((generated) => {
      const landCells = generated.terrain.coastDistance.filter((distance) => {
        return distance > 0;
      }).length;

      return generated.vegetation.count / landCells;
    });

    const [smallDensity = 0, largeDensity = 0] = densities;

    expect(largeDensity / smallDensity).toBeGreaterThan(0.75);
    expect(largeDensity / smallDensity).toBeLessThan(1.33);
    expect(large.vegetation.count).toBeGreaterThan(small.vegetation.count);
  });
});
