import { describe, expect, it } from "vitest";
import { NO_WATER } from "../../world/water.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { BANK_SINK } from "./shore-field.ts";
import { sampleWaterSurface, waterVertexLevel } from "./water-surface.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 8 });
const RIVER_ROW = 3;
const LEVEL = 100;
const STEP_UP = 6;

function createTerrain(bankHeight: number) {
  const height = new Float32Array(grid.cellCount).fill(bankHeight);
  const waterSurface = new Float32Array(grid.cellCount).fill(NO_WATER);

  for (let column = 0; column < grid.cellsPerSide; column += 1) {
    height[grid.index(column, RIVER_ROW)] = LEVEL - 1.5;
    waterSurface[grid.index(column, RIVER_ROW)] = LEVEL;
  }

  return { height, waterSurface };
}

describe("waterVertexLevel", () => {
  it("keeps a wet cell at its own level and sinks a bank cell below its ground", () => {
    const terrain = createTerrain(LEVEL + 0.1);

    expect(waterVertexLevel(terrain, grid, 2, RIVER_ROW)).toBe(LEVEL);
    expect(waterVertexLevel(terrain, grid, 2, RIVER_ROW + 1)).toBeCloseTo(LEVEL + 0.1 - BANK_SINK);
    expect(waterVertexLevel(terrain, grid, 2, RIVER_ROW + 2)).toBe(NO_WATER);
  });

  it("keeps a bank above the river at the river level", () => {
    const terrain = createTerrain(LEVEL + 3);

    expect(waterVertexLevel(terrain, grid, 2, RIVER_ROW - 1)).toBe(LEVEL);
  });

  it("keeps a bank between two steps of a river at the lower step instead of lifting it up the slope", () => {
    const terrain = createTerrain(LEVEL + 12);
    const upstream = grid.index(1, RIVER_ROW - 1);

    terrain.height[upstream] = LEVEL + STEP_UP - 1;
    terrain.waterSurface[upstream] = LEVEL + STEP_UP;

    expect(waterVertexLevel(terrain, grid, 2, RIVER_ROW - 1)).toBe(LEVEL);
    expect(sampleWaterSurface(terrain, grid, grid.centerX(2), grid.centerZ(RIVER_ROW) - 5)).toBeCloseTo(LEVEL);
  });

  it("keeps a bank touched only at its corners by two steps of a river at the lower step", () => {
    const terrain = createTerrain(LEVEL + 12);
    const upper = grid.index(1, RIVER_ROW + 1);
    const lower = grid.index(3, RIVER_ROW + 3);

    terrain.height[upper] = LEVEL + STEP_UP - 1;
    terrain.waterSurface[upper] = LEVEL + STEP_UP;
    terrain.height[lower] = LEVEL - 1;
    terrain.waterSurface[lower] = LEVEL;

    expect(waterVertexLevel(terrain, grid, 2, RIVER_ROW + 2)).toBe(LEVEL);
  });
});

describe("sampleWaterSurface", () => {
  it("follows the water mesh from the river into the bank and stops where no water reaches", () => {
    const terrain = createTerrain(LEVEL + 0.1);

    const centerZ = grid.centerZ(RIVER_ROW);
    const towardBank = sampleWaterSurface(terrain, grid, 20, centerZ + 5);

    expect(sampleWaterSurface(terrain, grid, 20, centerZ)).toBeCloseTo(LEVEL);
    expect(towardBank).toBeLessThan(LEVEL);
    expect(towardBank).toBeGreaterThan(LEVEL + 0.1 - BANK_SINK);
    expect(sampleWaterSurface(terrain, grid, 20, centerZ + 15)).toBe(NO_WATER);
  });
});
