import { beforeAll, describe, expect, it } from "vitest";
import { DEPOSIT_KINDS, DEPOSITS } from "../content/deposits.ts";
import { Ground } from "../content/grounds.ts";
import { isTreeSpecies } from "../content/plants.ts";
import type { Deposit } from "../world/deposits.ts";
import { slopeAt } from "../world/footing.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { isWaterCell } from "../world/terrain-sampling.ts";
import { createTerrainData, shapeTerrain } from "../world/testing/terrain-fixtures.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { planDeposits } from "./deposits.ts";
import { type GeneratedWorld, generateWorld } from "./world-generator.ts";

const DIMENSIONS = { cellSize: 10, cellsPerSide: 384 };
const HILLSIDE_DIMENSIONS = { cellSize: 10, cellsPerSide: 128 };
const OPEN_EDGE = -250;
const FOREST_VEIN_CELLS = 6;

function forestedHillside(grid: WorldGrid, isOpen: (x: number, z: number) => boolean): TerrainData {
  const terrain = createTerrainData(HILLSIDE_DIMENSIONS);

  terrain.height = shapeTerrain(grid, (_, z) => {
    return 400 + 0.3 * z;
  });
  terrain.ground = Uint8Array.from({ length: grid.cellCount }, (_, cell) => {
    return isOpen(grid.cellCenterX(cell), grid.cellCenterZ(cell)) ? Ground.Meadow : Ground.Forest;
  });

  return terrain;
}

function oresOf(deposits: readonly Deposit[]): Deposit[] {
  return deposits.filter((deposit) => {
    return deposit.kind !== "clay";
  });
}

describe("ore and clay deposits", () => {
  const grid = new WorldGrid(DIMENSIONS);

  let world: GeneratedWorld;

  beforeAll(() => {
    world = generateWorld(7, { dimensions: DIMENSIONS, erosionStrength: 1, shape: "round" });
  }, 60_000);

  it("include every kind of ore and clay", () => {
    const kinds = new Set(
      world.deposits.map((deposit) => {
        return deposit.kind;
      })
    );

    expect([...kinds].sort()).toEqual([...DEPOSIT_KINDS].sort());
  });

  it("tint their veins on dry land with the ground of their ore", () => {
    for (const deposit of world.deposits) {
      expect(deposit.cells.length).toBeGreaterThan(3);

      for (const cell of deposit.cells) {
        expect(world.terrain.ground[cell]).toBe(DEPOSITS[deposit.kind].ground);
        expect(isWaterCell(world.terrain, cell)).toBe(false);
      }
    }
  });

  it("put ore veins on hillsides and clay on gentle ground", () => {
    const { height } = world.terrain;

    function steepestOf(deposit: Deposit): number {
      return Math.max(
        ...deposit.cells.map((cell) => {
          return slopeAt(height, grid, cell);
        })
      );
    }

    for (const clay of world.deposits.filter((deposit) => {
      return deposit.kind === "clay";
    })) {
      expect(steepestOf(clay)).toBeLessThanOrEqual(0.25);
    }

    for (const ore of world.deposits.filter((deposit) => {
      return deposit.kind !== "clay";
    })) {
      expect(steepestOf(ore)).toBeLessThanOrEqual(0.72);
    }
  });

  it("keep their veins off springs", () => {
    const springGround = new Set(
      world.water.springs.flatMap((spring) => {
        return spring.cells;
      })
    );

    expect(springGround.size).toBeGreaterThan(0);

    for (const deposit of world.deposits) {
      for (const cell of deposit.cells) {
        expect(springGround.has(cell)).toBe(false);
      }
    }
  });

  it("leave no trees standing on the veins", () => {
    const veins = new Set(
      world.deposits.flatMap((deposit) => {
        return deposit.cells;
      })
    );
    const { vegetation } = world;

    const trees = Array.from({ length: vegetation.count }, (_, plant) => {
      return plant;
    }).filter((plant) => {
      return vegetation.isAlive(plant) && isTreeSpecies(vegetation.species[plant]);
    });

    for (const tree of trees) {
      expect(veins.has(grid.cellAt(vegetation.x[tree], vegetation.z[tree]))).toBe(false);
    }
  });
});

describe("ore deposits in forest", () => {
  const grid = new WorldGrid(HILLSIDE_DIMENSIONS);

  it("keep only a few forest cells in each vein", () => {
    const terrain = forestedHillside(grid, () => {
      return false;
    });

    const ores = oresOf(planDeposits(grid, terrain, 7, new Uint8Array(grid.cellCount)));

    expect(ores.length).toBeGreaterThan(0);

    for (const ore of ores) {
      const forested = ore.cells.filter((cell) => {
        return terrain.ground[cell] === Ground.Forest;
      });

      expect(forested.length).toBeLessThanOrEqual(FOREST_VEIN_CELLS);
    }
  });

  it("center their veins on open ground when the hills have enough of it", () => {
    const terrain = forestedHillside(grid, (x, z) => {
      return x < OPEN_EDGE && z > 0;
    });

    const ores = oresOf(planDeposits(grid, terrain, 7, new Uint8Array(grid.cellCount)));

    expect(ores.length).toBeGreaterThan(0);

    for (const ore of ores) {
      expect(terrain.ground[grid.cellAt(ore.x, ore.z)]).toBe(Ground.Meadow);
    }
  });
});
