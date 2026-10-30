import { describe, expect, it } from "vitest";
import { Biome } from "../content/biomes.ts";
import { Ground } from "../content/grounds.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { hasWater } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { coarseWorld } from "./testing/generated-worlds.ts";
import { meanOf } from "./testing/statistics.ts";

function isWooded(terrain: TerrainData, cell: number): boolean {
  return terrain.biome[cell] === Biome.Forest || terrain.biome[cell] === Biome.Taiga;
}

function nearWater(terrain: TerrainData, grid: WorldGrid, cell: number, radius: number): boolean {
  return grid.cellsInRadius(grid.cellCenterX(cell), grid.cellCenterZ(cell), radius).some((other) => {
    return hasWater(terrain.waterSurface[other], terrain.height[other]);
  });
}

describe("woodland of a generated island", () => {
  it("opens glades, sparse stands and riverside meadows in the forests", () => {
    const world = coarseWorld(7);
    const { terrain } = world;

    const grid = new WorldGrid(world.dimensions);
    const wooded = Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return isWooded(terrain, cell);
    });

    const densities = wooded.map((cell) => {
      return terrain.woodland[cell];
    });
    const mean = meanOf(densities);

    const bankMean = meanOf(
      wooded
        .filter((cell) => {
          return nearWater(terrain, grid, cell, 50);
        })
        .map((cell) => {
          return terrain.woodland[cell];
        })
    );

    expect(wooded.length).toBeGreaterThan(1000);
    expect(mean).toBeGreaterThan(0.5);
    expect(mean).toBeLessThan(0.85);
    expect(
      densities.filter((density) => {
        return density < 0.05;
      }).length / densities.length
    ).toBeGreaterThan(0.025);
    expect(
      densities.filter((density) => {
        return density > 0.85;
      }).length / densities.length
    ).toBeGreaterThan(0.2);
    expect(bankMean).toBeLessThan(mean * 0.7);

    for (const cell of wooded.filter((woodedCell) => {
      return terrain.woodland[woodedCell] < 0.3;
    })) {
      expect(terrain.ground[cell]).not.toBe(Ground.Forest);
    }
  });
});
