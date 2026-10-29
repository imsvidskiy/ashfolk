import { describe, expect, it } from "vitest";
import { landEverywhere } from "../world/testing/terrain-fixtures.ts";
import { NO_WATER } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { buildClimate } from "./climate.ts";
import type { ClimateProfile } from "./island-layout.ts";
import type { WetlandInputs } from "./wetlands.ts";

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

describe("climate", () => {
  const inputs = coneInputs();
  const east = grid.index(FLANK_COLUMN, MIDDLE_ROW);
  const west = grid.index(grid.cellsPerSide - 1 - FLANK_COLUMN, MIDDLE_ROW);

  it("warms the flank that faces the warm side", () => {
    const climate = buildClimate(WARM_EAST, inputs);

    const warmSide = (2 * WARMTH * grid.cellCenterX(east)) / grid.halfSize;

    expect(inputs.heights[east]).toBe(inputs.heights[west]);
    expect(climate.baseTemperature[east] - climate.baseTemperature[west]).toBeCloseTo(warmSide, 4);
  });

  it("wets the slope that faces away from the warm side", () => {
    const warmEast = buildClimate(WARM_EAST, inputs);
    const warmWest = buildClimate(WARM_WEST, inputs);

    expect(warmEast.moisture[west]).toBeGreaterThan(warmWest.moisture[west] + 0.2);
    expect(warmWest.moisture[east]).toBeGreaterThan(warmEast.moisture[east] + 0.2);
  });

  it("chills the summit beyond the lapse rate", () => {
    const climate = buildClimate(WARM_EAST, inputs);

    const summit = grid.index(MIDDLE_ROW, MIDDLE_ROW);
    const warmSide = (WARMTH * grid.cellCenterX(summit)) / grid.halfSize;
    const lapsed = 9.6 - 0.0095 * (inputs.heights[summit] - 200) + warmSide;

    expect(climate.baseTemperature[summit]).toBeCloseTo(lapsed - 5.5, 4);
  });
});
