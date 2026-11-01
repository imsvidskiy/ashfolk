import { beforeAll, describe, expect, it } from "vitest";
import { Biome } from "../content/biomes.ts";
import { Ground } from "../content/grounds.ts";
import { isOnIsland } from "../world/coast.ts";
import { slopeAt } from "../world/footing.ts";
import { landEverywhere } from "../world/testing/terrain-fixtures.ts";
import { hasWater, NO_WATER } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { bareRockSlope, buildClimate } from "./climate.ts";
import type { ClimateProfile } from "./island-layout.ts";
import { cellsAround, labelPatches, NO_PATCH } from "./testing/cell-patches.ts";
import { coarseWorld, FULL_SIZE_TIMEOUT, fullSizeWorld, islandsAcrossSeeds } from "./testing/generated-worlds.ts";
import { type IslandSurvey, surveyIsland } from "./testing/island-survey.ts";
import { meanOf } from "./testing/statistics.ts";
import { isRiverWater } from "./testing/water-checks.ts";
import type { WetlandInputs } from "./wetlands.ts";
import type { GeneratedWorld } from "./world-generator.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 96 });
const PEAK_HEIGHT = 1200;
const CONE_FALL = 1.5;
const WARMTH = 5;
const FLANK_COLUMN = 76;
const MIDDLE_ROW = 48;

const WARM_EAST: ClimateProfile = {
  desert: null,
  moistureOffset: 0,
  temperatureOffset: 0,
  warmthX: WARMTH,
  warmthZ: 0,
  wetlandShare: 0.03,
};
const WARM_WEST: ClimateProfile = { ...WARM_EAST, warmthX: -WARMTH };
const WELL_BELOW_TREE_LINE = 4.6;
const CLIFF_SLOPE = 0.86;
const STEEP_SLOPE = 0.9;

interface RockSurvey {
  readonly gentleLowRock: number;
  readonly rockShare: number;
  readonly steepLowCells: number;
  readonly steepLowRock: number;
}

function coneInputs(): WetlandInputs {
  const heights = Float32Array.from({ length: grid.cellCount }, (_, cell) => {
    return PEAK_HEIGHT - CONE_FALL * Math.hypot(grid.cellCenterX(cell), grid.cellCenterZ(cell));
  });

  return {
    coastDistance: landEverywhere(grid.cellCount),
    desert: new Float64Array(grid.cellCount),
    grid,
    heights,
    lakeIds: new Int32Array(grid.cellCount).fill(-1),
    riverStrength: new Uint8Array(grid.cellCount),
    rivers: [],
    seed: 3,
    waterSurface: new Float32Array(grid.cellCount).fill(NO_WATER),
  };
}

function surveyRock(generated: GeneratedWorld): RockSurvey {
  const { terrain } = generated;

  const islandGrid = new WorldGrid(generated.dimensions);

  let landCells = 0;
  let rockCells = 0;
  let gentleLowRock = 0;
  let steepLowCells = 0;
  let steepLowRock = 0;

  for (let cell = 0; cell < islandGrid.cellCount; cell += 1) {
    if (!isOnIsland(terrain.coastDistance, cell) || hasWater(terrain.waterSurface[cell], terrain.height[cell])) {
      continue;
    }

    const isRock = terrain.biome[cell] === Biome.Alpine;
    const isWellBelowTreeLine = terrain.baseTemperature[cell] > WELL_BELOW_TREE_LINE;
    const slope = slopeAt(terrain.height, islandGrid, cell);

    landCells += 1;
    rockCells += isRock ? 1 : 0;

    if (isWellBelowTreeLine && isRock && slope <= CLIFF_SLOPE) {
      gentleLowRock += 1;
    }

    if (isWellBelowTreeLine && slope > STEEP_SLOPE) {
      steepLowCells += 1;
      steepLowRock += isRock ? 1 : 0;
    }
  }

  return { gentleLowRock, rockShare: rockCells / landCells, steepLowCells, steepLowRock };
}

function lowRockMask(generated: GeneratedWorld): Uint8Array {
  const { terrain } = generated;

  return terrain.biome.map((biome, cell) => {
    return biome === Biome.Alpine && terrain.baseTemperature[cell] > WELL_BELOW_TREE_LINE ? 1 : 0;
  });
}

function largestPatch(islandGrid: WorldGrid, mask: Uint8Array): number {
  const labels = labelPatches(islandGrid, (cell) => {
    return mask[cell] === 1;
  });
  const sizes = new Int32Array(labels.length);

  for (const label of labels) {
    if (label !== NO_PATCH) {
      sizes[label] += 1;
    }
  }

  return sizes.reduce((largest, size) => {
    return Math.max(largest, size);
  }, 0);
}

describe("climate", () => {
  const inputs = coneInputs();
  const east = grid.index(FLANK_COLUMN, MIDDLE_ROW);
  const west = grid.index(grid.cellsPerSide - 1 - FLANK_COLUMN, MIDDLE_ROW);
  const rockStrength = new Float32Array(grid.cellCount);

  it("warms the flank that faces the warm side", () => {
    const climate = buildClimate(WARM_EAST, inputs, rockStrength);

    const warmSide = (2 * WARMTH * grid.cellCenterX(east)) / grid.halfSize;

    expect(inputs.heights[east]).toBe(inputs.heights[west]);
    expect(climate.baseTemperature[east] - climate.baseTemperature[west]).toBeCloseTo(warmSide, 4);
  });

  it("wets the slope that faces away from the warm side", () => {
    const warmEast = buildClimate(WARM_EAST, inputs, rockStrength);
    const warmWest = buildClimate(WARM_WEST, inputs, rockStrength);

    expect(warmEast.moisture[west]).toBeGreaterThan(warmWest.moisture[west] + 0.2);
    expect(warmWest.moisture[east]).toBeGreaterThan(warmEast.moisture[east] + 0.2);
  });

  it("chills the summit beyond the lapse rate", () => {
    const climate = buildClimate(WARM_EAST, inputs, rockStrength);

    const summit = grid.index(MIDDLE_ROW, MIDDLE_ROW);
    const warmSide = (WARMTH * grid.cellCenterX(summit)) / grid.halfSize;
    const lapsed = 9.6 - 0.0095 * (inputs.heights[summit] - 200) + warmSide;

    expect(climate.baseTemperature[summit]).toBeCloseTo(lapsed - 5.5, 4);
  });
});

describe("bare rock", () => {
  const strengths = [-1, -0.5, 0, 0.5, 1];

  it("needs a cliff below the tree line and only a steep slope above it", () => {
    for (const strength of strengths) {
      expect(bareRockSlope(9, strength, 0)).toBeGreaterThanOrEqual(0.86);
      expect(bareRockSlope(1, strength, 0)).toBeLessThanOrEqual(0.75);
    }
  });

  it("shows on strong rock first", () => {
    for (const temperature of [0, 3, 6, 9]) {
      const slopes = strengths.map((strength) => {
        return bareRockSlope(temperature, strength, 0);
      });

      expect(slopes).toEqual(
        [...slopes].sort((first, second) => {
          return second - first;
        })
      );
    }
  });

  it("keeps the mesa cliff fixed in the desert", () => {
    for (const temperature of [0, 3, 6, 9, 15]) {
      for (const strength of strengths) {
        expect(bareRockSlope(temperature, strength, 1)).toBe(0.9);
      }
    }
  });

  it("rises gradually toward the tree line", () => {
    const slopes = [8, 6, 5, 4, 3, 2, 1].map((temperature) => {
      return bareRockSlope(temperature, 0, 0);
    });

    for (const [index, slope] of slopes.slice(1).entries()) {
      expect(slope).toBeLessThanOrEqual(slopes[index]);
      expect(slopes[index] - slope).toBeLessThan(0.25);
    }
  });
});

describe("climate of a generated island", () => {
  let world: GeneratedWorld;

  beforeAll(() => {
    world = coarseWorld(7);
  });

  it("classifies water cells as water", () => {
    const { terrain } = world;

    const waterBiomes = terrain.biome.filter((_, cell) => {
      return hasWater(terrain.waterSurface[cell], terrain.height[cell]);
    });

    expect(waterBiomes.length).toBeGreaterThan(0);
    expect(new Set(waterBiomes)).toEqual(new Set([Biome.Water]));
  });

  it("keeps warm, low river banks outside wetlands open as beach on the ground of the land around them", () => {
    const { terrain } = world;

    const islandGrid = new WorldGrid(world.dimensions);
    const banks = new Set<number>();

    for (let cell = 0; cell < islandGrid.cellCount; cell += 1) {
      if (!isRiverWater(terrain, cell)) {
        continue;
      }

      for (const bank of cellsAround(islandGrid, cell, 1, islandGrid.cellSize * 1.5)) {
        const isLow = terrain.height[bank] < terrain.waterSurface[cell] + 1.5;
        const isGentle = slopeAt(terrain.height, islandGrid, bank) < 0.25;
        const isWarm = terrain.baseTemperature[bank] > 4;
        const isWetland = terrain.ground[bank] === Ground.Swamp || terrain.ground[bank] === Ground.Bog;

        if (isLow && isGentle && isWarm && !isWetland && !hasWater(terrain.waterSurface[bank], terrain.height[bank])) {
          banks.add(bank);
        }
      }
    }

    const beaches = [...banks].filter((bank) => {
      return terrain.biome[bank] === Biome.Beach;
    });
    const sandy = beaches.filter((bank) => {
      return terrain.ground[bank] === Ground.Sand;
    });

    expect(banks.size).toBeGreaterThan(30);
    expect(beaches.length / banks.size).toBeGreaterThan(0.8);
    expect(sandy.length / beaches.length).toBeLessThan(0.2);
  });
});

describe("climate of a full-size island", () => {
  let fullSize: GeneratedWorld;

  beforeAll(() => {
    fullSize = fullSizeWorld(7);
  }, FULL_SIZE_TIMEOUT);

  it("breaks rock well below the tree line into small outcrops", () => {
    const islandGrid = new WorldGrid(fullSize.dimensions);
    const mask = lowRockMask(fullSize);
    const rockCells = mask.reduce((total, value) => {
      return total + value;
    }, 0);

    expect(rockCells / islandGrid.cellCount).toBeLessThan(0.02);
    expect(largestPatch(islandGrid, mask)).toBeLessThan(4500);
  });
});

describe("climate across seeds", () => {
  let surveys: IslandSurvey[];
  let rocks: RockSurvey[];

  beforeAll(() => {
    const { round, square } = islandsAcrossSeeds();

    surveys = [...round, ...square].map(surveyIsland);
    rocks = round.map(surveyRock);
  }, FULL_SIZE_TIMEOUT);

  it("mixes the biomes differently, within bounds", () => {
    const forests = surveys.map((survey) => {
      return survey.shares.forest;
    });
    const colds = surveys.map((survey) => {
      return survey.shares.cold;
    });
    const deserts = surveys.map((survey) => {
      return survey.shares.desert;
    });

    expect(Math.max(...forests) - Math.min(...forests)).toBeGreaterThan(0.15);
    expect(Math.max(...colds) - Math.min(...colds)).toBeGreaterThan(0.03);
    expect(
      deserts.filter((share) => {
        return share < 0.005;
      }).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      deserts.filter((share) => {
        return share > 0.08;
      }).length
    ).toBeGreaterThanOrEqual(2);

    for (const { shares } of surveys) {
      expect(shares.forest).toBeGreaterThan(0.3);
      expect(shares.forest).toBeLessThan(0.85);
      expect(shares.desert).toBeLessThan(0.2);
      expect(shares.cold).toBeLessThan(0.25);
      expect(shares.swamp).toBeGreaterThan(0.001);
      expect(shares.swamp).toBeLessThan(0.07);
    }
  });

  it("bares rock well below the tree line only on cliffs", () => {
    for (const rock of rocks) {
      expect(rock.gentleLowRock).toBe(0);
    }
  });

  it("keeps most steep slopes below the tree line wooded, with rock in outcrops", () => {
    const steepCells = rocks.reduce((total, rock) => {
      return total + rock.steepLowCells;
    }, 0);
    const steepRock = rocks.reduce((total, rock) => {
      return total + rock.steepLowRock;
    }, 0);

    expect(steepRock / steepCells).toBeGreaterThan(0.05);
    expect(steepRock / steepCells).toBeLessThan(0.45);
  });

  it("keeps bare rock to a modest share of the land", () => {
    const shares = rocks.map((rock) => {
      return rock.rockShare;
    });
    const mean = meanOf(shares);

    expect(mean).toBeGreaterThan(0.03);
    expect(mean).toBeLessThan(0.08);
    expect(Math.max(...shares)).toBeLessThan(0.13);
  });
});
