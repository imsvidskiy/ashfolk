import { beforeAll, describe, expect, it } from "vitest";
import { Ground, isPoolGround } from "../content/grounds.ts";
import { isTreeSpecies, plantSpeciesDefinition, TREE_SPACING } from "../content/plants.ts";
import { isOnIsland } from "../world/coast.ts";
import { admitsWildPlant, slopeAt } from "../world/footing.ts";
import { sampleHeight } from "../world/terrain-sampling.ts";
import { hasWater } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { coarseWorld, FULL_SIZE_TIMEOUT, fullSizeWorld } from "./testing/generated-worlds.ts";
import type { GeneratedWorld } from "./world-generator.ts";

const COAST_CLEARANCE = 6;
const FLOAT_SLACK = 1e-3;

function misplacedPlants(generated: GeneratedWorld): string[] {
  const { terrain, vegetation } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const misplaced: string[] = [];

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    const { name, steepestSlope } = plantSpeciesDefinition(vegetation.species[plant]);

    const cell = grid.cellAt(vegetation.x[plant], vegetation.z[plant]);
    const slope = slopeAt(terrain.height, grid, cell);

    if (slope > steepestSlope) {
      misplaced.push(`${name} on slope ${slope.toFixed(2)}`);
    }

    if (hasWater(terrain.waterSurface[cell], terrain.height[cell])) {
      misplaced.push(`${name} in water`);
    }

    if (isPoolGround(terrain.ground[cell])) {
      misplaced.push(`${name} in a bog pool`);
    }
  }

  return misplaced;
}

function closestTreeGap(generated: GeneratedWorld): number {
  const { vegetation } = generated;

  const grid = new WorldGrid(generated.dimensions);
  const treesByCell = new Map<number, number[]>();
  let closest = Number.POSITIVE_INFINITY;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    if (!isTreeSpecies(vegetation.species[plant])) {
      continue;
    }

    const x = vegetation.x[plant];
    const z = vegetation.z[plant];
    const column = grid.columnAt(x);
    const row = grid.rowAt(z);

    for (let nearRow = row - 1; nearRow <= row + 1; nearRow += 1) {
      for (let nearColumn = column - 1; nearColumn <= column + 1; nearColumn += 1) {
        const near = grid.contains(nearColumn, nearRow) ? treesByCell.get(grid.index(nearColumn, nearRow)) : undefined;

        for (const other of near === undefined ? [] : near) {
          closest = Math.min(closest, Math.hypot(vegetation.x[other] - x, vegetation.z[other] - z));
        }
      }
    }

    const cell = grid.index(column, row);
    const trees = treesByCell.get(cell);

    if (trees === undefined) {
      treesByCell.set(cell, [plant]);
    } else {
      trees.push(plant);
    }
  }

  return closest;
}

function plantCells(generated: GeneratedWorld): number[] {
  const { vegetation } = generated;

  const grid = new WorldGrid(generated.dimensions);

  return Array.from({ length: vegetation.count }, (_, plant) => {
    return grid.cellAt(vegetation.x[plant], vegetation.z[plant]);
  });
}

describe("vegetation of a coarse island", () => {
  let world: GeneratedWorld;

  beforeAll(() => {
    world = coarseWorld(7);
  });

  it("keeps every plant on the island and clear of the coast so none hangs over the edge", () => {
    const { terrain, vegetation } = world;

    const grid = new WorldGrid(world.dimensions);

    for (const [plant, cell] of plantCells(world).entries()) {
      const coastDistance = sampleHeight(terrain.coastDistance, grid, vegetation.x[plant], vegetation.z[plant]);

      expect(isOnIsland(terrain.coastDistance, cell)).toBe(true);
      expect(coastDistance).toBeGreaterThan(COAST_CLEARANCE);
    }
  });

  it("keeps plants off every spring", () => {
    const springGround = new Set(
      world.water.springs.flatMap((spring) => {
        return spring.cells;
      })
    );

    expect(springGround.size).toBeGreaterThan(0);

    for (const cell of plantCells(world)) {
      expect(springGround.has(cell)).toBe(false);
    }
  });

  it("keeps trees off sand", () => {
    const { terrain, vegetation } = world;

    const treeCells = plantCells(world).filter((_, plant) => {
      return isTreeSpecies(vegetation.species[plant]);
    });

    expect(treeCells.length).toBeGreaterThan(0);

    for (const cell of treeCells) {
      expect(terrain.ground[cell]).not.toBe(Ground.Sand);
    }
  });

  it("grows no wild plant where the woodland turns it away", () => {
    const { terrain, vegetation } = world;

    const grid = new WorldGrid(world.dimensions);

    for (const [plant, cell] of plantCells(world).entries()) {
      expect(admitsWildPlant(terrain, grid, cell, vegetation.species[plant])).toBe(true);
    }
  });
});

describe("vegetation of full-size islands", () => {
  let worlds: GeneratedWorld[];

  beforeAll(() => {
    worlds = [fullSizeWorld(7), fullSizeWorld(1, "square")];
  }, FULL_SIZE_TIMEOUT);

  it("plants nothing in water, in a bog pool or on ground too steep for its species", () => {
    for (const generated of [coarseWorld(7), ...worlds]) {
      expect(misplacedPlants(generated)).toEqual([]);
    }
  });

  it("keeps the trees of the full island apart", () => {
    for (const generated of worlds) {
      expect(closestTreeGap(generated)).toBeGreaterThanOrEqual(TREE_SPACING - FLOAT_SLACK);
    }
  });
});
