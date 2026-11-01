import { beforeAll, describe, expect, it } from "vitest";
import { isOnIsland } from "../world/coast.ts";
import { slopeAt } from "../world/footing.ts";
import { ISLAND_SHAPES } from "../world/island-shape.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { drawnRiverHalfWidth, hasWater, type River } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { cellsAround } from "./testing/cell-patches.ts";
import { coarseWorld, FULL_SIZE_TIMEOUT, fullSizeWorld } from "./testing/generated-worlds.ts";
import { median, quantile, shareAbove } from "./testing/statistics.ts";
import { isLakeWater, isRiverWater, riverFaults } from "./testing/water-checks.ts";
import type { GeneratedWorld } from "./world-generator.ts";

const INLAND_REACH = 60;
const HANGING_SLACK = 0.3;
const HANGING_SHARE = 0.006;
const SHALLOWEST_BED = 0.3;
const SHALLOW_SIDEHILL_SHARE = 0.3;
const GENTLE_REACH_DROP = 0.05;
const SIDEHILL_CROSS_SLOPE = 0.12;
const NEIGHBOR_CELLS = 1.5;
const WATER_LEVEL_CELLS = 2.5;
const DRAWN_EDGE_CELLS = 1.25;

function highestSurfaceWithinCell(river: River, index: number, cellSize: number): number {
  const point = river.points[index];

  let highest = point.surface;

  for (let upstream = index - 1; upstream >= 0; upstream -= 1) {
    const near = river.points[upstream];

    if (Math.hypot(near.x - point.x, near.z - point.z) > cellSize / 2) {
      break;
    }

    highest = Math.max(highest, near.surface);
  }

  return highest;
}

function riverSurfacesUnderDrawnEdges(generated: GeneratedWorld): Map<number, number> {
  const grid = new WorldGrid(generated.dimensions);
  const nearest = new Map<number, { distance: number; surface: number }>();

  for (const river of generated.water.rivers) {
    for (const [index, point] of river.points.entries()) {
      const reach = drawnRiverHalfWidth(point.width / 2) + grid.cellSize * DRAWN_EDGE_CELLS;
      const surface = highestSurfaceWithinCell(river, index, grid.cellSize);

      for (const cell of grid.cellsInRadius(point.x, point.z, reach)) {
        const distance = Math.hypot(grid.cellCenterX(cell) - point.x, grid.cellCenterZ(cell) - point.z);
        const known = nearest.get(cell);

        if (known === undefined || distance < known.distance) {
          nearest.set(cell, { distance, surface });
        }
      }
    }
  }

  return new Map(
    [...nearest].map(([cell, { surface }]) => {
      return [cell, surface];
    })
  );
}

function bankRises(generated: GeneratedWorld): number[] {
  const { terrain } = generated;

  const rises: number[] = [];

  for (const [cell, surface] of riverSurfacesUnderDrawnEdges(generated)) {
    const isDryLand =
      terrain.coastDistance[cell] >= INLAND_REACH && !hasWater(terrain.waterSurface[cell], terrain.height[cell]);

    if (isDryLand) {
      rises.push(terrain.height[cell] - surface);
    }
  }

  return rises;
}

function lowestRiverWaterNear(terrain: TerrainData, grid: WorldGrid, cell: number): number {
  const waters = cellsAround(grid, cell, 1, grid.cellSize * WATER_LEVEL_CELLS)
    .filter((near) => {
      return isRiverWater(terrain, near);
    })
    .map((near) => {
      return terrain.waterSurface[near];
    });

  return Math.min(...waters);
}

function hangingRiverEdges(generated: GeneratedWorld): { edges: number; hanging: number } {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  let edges = 0;
  let hanging = 0;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (hasWater(terrain.waterSurface[cell], terrain.height[cell]) || terrain.coastDistance[cell] < INLAND_REACH) {
      continue;
    }

    const neighbors = cellsAround(grid, cell, 1, grid.cellSize * NEIGHBOR_CELLS);

    const touchesLake = neighbors.some((near) => {
      return isLakeWater(terrain, near);
    });
    const touchesRiver = neighbors.some((near) => {
      return isRiverWater(terrain, near);
    });

    if (touchesLake || !touchesRiver) {
      continue;
    }

    edges += 1;

    if (terrain.height[cell] < lowestRiverWaterNear(terrain, grid, cell) - HANGING_SLACK) {
      hanging += 1;
    }
  }

  return { edges, hanging };
}

function bedDepthsBelowBanks(generated: GeneratedWorld): { all: number[]; sidehill: number[] } {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const all: number[] = [];
  const sidehill: number[] = [];

  for (const river of generated.water.rivers) {
    for (let index = 2; index < river.points.length - 2; index += 1) {
      const point = river.points[index];
      const before = river.points[index - 2];
      const after = river.points[index + 2];
      const length = Math.max(1e-6, Math.hypot(after.x - before.x, after.z - before.z));
      const cell = grid.cellAt(point.x, point.z);

      const upstream = grid.cellAt(before.x, before.z);
      const downstream = grid.cellAt(after.x, after.z);
      const drop = terrain.waterSurface[upstream] - terrain.waterSurface[downstream];
      const isGentle =
        isRiverWater(terrain, upstream) && isRiverWater(terrain, downstream) && drop / length <= GENTLE_REACH_DROP;
      const isInland = terrain.coastDistance[cell] >= INLAND_REACH;

      if (!(isGentle && isInland && isRiverWater(terrain, cell))) {
        continue;
      }

      const offset = point.width / 2 + grid.cellSize;
      const banks = [-1, 1].map((side) => {
        return grid.cellAt(
          point.x - ((after.z - before.z) / length) * offset * side,
          point.z + ((after.x - before.x) / length) * offset * side
        );
      });

      const isDryLand = banks.every((bank) => {
        return isOnIsland(terrain.coastDistance, bank) && !hasWater(terrain.waterSurface[bank], terrain.height[bank]);
      });

      if (!isDryLand) {
        continue;
      }

      const depth = Math.min(terrain.height[banks[0]], terrain.height[banks[1]]) - terrain.height[cell];
      const uncarvedRise = Math.abs(
        terrain.height[banks[0]] + terrain.carving[banks[0]] - terrain.height[banks[1]] - terrain.carving[banks[1]]
      );

      all.push(depth);

      if (uncarvedRise / (2 * offset) > SIDEHILL_CROSS_SLOPE) {
        sidehill.push(depth);
      }
    }
  }

  return { all, sidehill };
}

function slopesAddedByCarving(generated: GeneratedWorld): number[] {
  const { terrain } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const uncarved = terrain.height.map((height, cell) => {
    return height + terrain.carving[cell];
  });
  const added: number[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const isCarvedLand =
      terrain.carving[cell] > 1 &&
      terrain.coastDistance[cell] >= INLAND_REACH &&
      !hasWater(terrain.waterSurface[cell], terrain.height[cell]);

    if (isCarvedLand && !grid.isOnEdge(cell)) {
      added.push(slopeAt(terrain.height, grid, cell) - slopeAt(uncarved, grid, cell));
    }
  }

  return added;
}

describe("river channels of coarse islands", () => {
  it("keeps the water of every river falling from its source to its mouth on several seeds and both shapes", () => {
    for (const seed of [3, 7, 11, 19]) {
      for (const shape of ISLAND_SHAPES) {
        const generated = coarseWorld(seed, shape);

        expect(generated.water.rivers.length).toBeGreaterThan(0);
        expect(riverFaults(generated)).toEqual([]);
      }
    }
  });
});

describe("river banks of full-size islands", () => {
  let worlds: GeneratedWorld[];

  beforeAll(() => {
    worlds = [fullSizeWorld(7), fullSizeWorld(1, "square")];
  }, FULL_SIZE_TIMEOUT);

  it("keeps the land under and just past the drawn edge of rivers just above the water on both shapes", () => {
    for (const generated of worlds) {
      const rises = bankRises(generated);

      expect(rises.length).toBeGreaterThan(800);
      expect(median(rises)).toBeLessThan(0.3);
      expect(quantile(rises, 0.9)).toBeLessThan(0.5);
    }
  });
});

describe("river beds of full-size islands", () => {
  let worlds: GeneratedWorld[];

  beforeAll(() => {
    worlds = [fullSizeWorld(10), fullSizeWorld(12), fullSizeWorld(3, "square"), fullSizeWorld(8, "square")];
  }, FULL_SIZE_TIMEOUT);

  it("keeps the land beside every river at least as high as its water on several seeds and both shapes", () => {
    for (const generated of worlds) {
      const { edges, hanging } = hangingRiverEdges(generated);

      expect(edges).toBeGreaterThan(3000);
      expect(hanging / edges).toBeLessThan(HANGING_SHARE);
    }
  });

  it("sinks river beds below both banks, across hillsides too", () => {
    for (const generated of worlds) {
      const { all, sidehill } = bedDepthsBelowBanks(generated);

      expect(all.length).toBeGreaterThan(500);
      expect(sidehill.length).toBeGreaterThan(50);
      expect(1 - shareAbove(all, SHALLOWEST_BED)).toBeLessThan(0.08);
      expect(1 - shareAbove(sidehill, SHALLOWEST_BED)).toBeLessThan(SHALLOW_SIDEHILL_SHARE);
      expect(median(sidehill)).toBeGreaterThan(0.8);
    }
  });

  it("blends cut banks gently into the land around them", () => {
    for (const generated of worlds) {
      const added = slopesAddedByCarving(generated);

      expect(quantile(added, 0.9)).toBeLessThan(0.25);
      expect(quantile(added, 0.99)).toBeLessThan(0.65);
    }
  });
});
