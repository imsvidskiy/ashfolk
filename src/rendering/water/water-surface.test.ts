import { describe, expect, it } from "vitest";
import { NO_WATER } from "../../world/water.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { BANK_SINK, RIVER_BANK_LIFT } from "./shore-field.ts";
import { sampleWaterSurface, waterVertexLevel } from "./water-surface.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 8 });
const WATER_ROW = 3;
const LEVEL = 100;
const STEP_UP = 6;
const RIVER_CODE = 60;

function createTerrain(bankHeight: number, waterStrength = RIVER_CODE) {
  const height = new Float32Array(grid.cellCount).fill(bankHeight);
  const waterSurface = new Float32Array(grid.cellCount).fill(NO_WATER);
  const riverStrength = new Uint8Array(grid.cellCount);

  for (let column = 0; column < grid.cellsPerSide; column += 1) {
    height[grid.index(column, WATER_ROW)] = LEVEL - 1.5;
    waterSurface[grid.index(column, WATER_ROW)] = LEVEL;
    riverStrength[grid.index(column, WATER_ROW)] = waterStrength;
  }

  return { height, riverStrength, waterSurface };
}

describe("waterVertexLevel", () => {
  it("keeps a wet cell at its own level and leaves cells two away from water dry", () => {
    const terrain = createTerrain(LEVEL + 0.1);

    expect(waterVertexLevel(terrain, grid, 2, WATER_ROW)).toBe(LEVEL);
    expect(waterVertexLevel(terrain, grid, 2, WATER_ROW + 2)).toBe(NO_WATER);
  });

  it("lifts a river bank just above its ground, so the drawn edge of the river is never under the land", () => {
    const low = createTerrain(LEVEL - 0.5);
    const high = createTerrain(LEVEL + 3);

    expect(waterVertexLevel(low, grid, 2, WATER_ROW + 1)).toBe(LEVEL);
    expect(waterVertexLevel(high, grid, 2, WATER_ROW + 1)).toBeCloseTo(LEVEL + 3 + RIVER_BANK_LIFT);
  });

  it("sinks the shore of standing water below its ground, so a lake ends where its shore rises", () => {
    const terrain = createTerrain(LEVEL + 0.1, 0);

    expect(waterVertexLevel(terrain, grid, 2, WATER_ROW + 1)).toBeCloseTo(LEVEL + 0.1 - BANK_SINK);
  });

  it("puts a river bank between two steps of a river at the average of the water beside it", () => {
    const terrain = createTerrain(LEVEL - 2);
    const upstream = grid.index(1, WATER_ROW - 1);

    terrain.height[upstream] = LEVEL + STEP_UP - 1;
    terrain.waterSurface[upstream] = LEVEL + STEP_UP;
    terrain.riverStrength[upstream] = RIVER_CODE;

    expect(waterVertexLevel(terrain, grid, 1, WATER_ROW - 2)).toBe(LEVEL + STEP_UP);
    expect(waterVertexLevel(terrain, grid, 2, WATER_ROW - 1)).toBe(LEVEL + STEP_UP / 2);
  });
});

describe("sampleWaterSurface", () => {
  it("follows the water mesh from a lake into its shore and stops where no water reaches", () => {
    const terrain = createTerrain(LEVEL + 0.1, 0);

    const centerZ = grid.centerZ(WATER_ROW);
    const towardBank = sampleWaterSurface(terrain, grid, 20, centerZ + 5);

    expect(sampleWaterSurface(terrain, grid, 20, centerZ)).toBeCloseTo(LEVEL);
    expect(towardBank).toBeLessThan(LEVEL);
    expect(towardBank).toBeGreaterThan(LEVEL + 0.1 - BANK_SINK);
    expect(sampleWaterSurface(terrain, grid, 20, centerZ + 15)).toBe(NO_WATER);
  });
});
