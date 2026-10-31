import { describe, expect, it } from "vitest";
import { Ground } from "../content/grounds.ts";
import { PlantSpecies } from "../content/plants.ts";
import {
  admitsWildPlant,
  canGrowWild,
  canStandOn,
  type FootingTerrain,
  hasRoomToGrow,
  isOpenGround,
  isWalkableGround,
  slopeAt,
} from "./footing.ts";
import { landEverywhere } from "./testing/terrain-fixtures.ts";
import { NO_WATER } from "./water.ts";
import { WorldGrid } from "./world-grid.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 8 });

function terrainOf(heightAt: (column: number, row: number) => number): FootingTerrain {
  const height = new Float32Array(grid.cellCount);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    height[cell] = heightAt(grid.columnOf(cell), grid.rowOf(cell));
  }

  return {
    coastDistance: landEverywhere(grid.cellCount),
    ground: new Uint8Array(grid.cellCount).fill(Ground.Meadow),
    height,
    waterSurface: new Float32Array(grid.cellCount).fill(NO_WATER),
  };
}

function woodlandOf(density: number) {
  return {
    ...terrainOf(() => {
      return 100;
    }),
    woodland: new Float32Array(grid.cellCount).fill(density),
  };
}

function admittedCells(density: number, species: number): number {
  const terrain = woodlandOf(density);

  let admitted = 0;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    admitted += admitsWildPlant(terrain, grid, cell, species) ? 1 : 0;
  }

  return admitted;
}

describe("footing", () => {
  it("measures slope as rise over run across a cell", () => {
    const terrain = terrainOf((column, row) => {
      return column * 6 + row * 8;
    });

    expect(slopeAt(terrain.height, grid, grid.index(3, 4))).toBeCloseTo(1);
  });

  it("takes the one-sided slope at the rim", () => {
    const terrain = terrainOf((column) => {
      return column * 5;
    });

    expect(slopeAt(terrain.height, grid, grid.index(0, 4))).toBeCloseTo(0.25);
  });

  it("keeps the rim and the cells beside water off limits", () => {
    const terrain = terrainOf(() => {
      return 100;
    });
    const pond = grid.index(4, 4);

    terrain.waterSurface[pond] = 102;

    expect(isOpenGround(terrain, grid, grid.index(0, 3))).toBe(false);
    expect(isOpenGround(terrain, grid, pond)).toBe(false);
    expect(isOpenGround(terrain, grid, grid.index(5, 5))).toBe(false);
    expect(isOpenGround(terrain, grid, grid.index(2, 2))).toBe(true);
    expect(isOpenGround(terrain, grid, -1)).toBe(false);
  });

  it("keeps everything off the void beyond the coast", () => {
    const terrain = terrainOf(() => {
      return 100;
    });
    const cliff = grid.index(3, 3);

    terrain.coastDistance[cliff] = -4;

    expect(isOpenGround(terrain, grid, cliff)).toBe(false);
    expect(canStandOn(terrain, grid, cliff, 5)).toBe(false);
  });

  it("keeps everything out of a bog pool", () => {
    const terrain = terrainOf(() => {
      return 100;
    });
    const pool = grid.index(3, 3);

    terrain.ground[pool] = Ground.Bog;

    expect(isOpenGround(terrain, grid, pool)).toBe(false);
    expect(isOpenGround(terrain, grid, grid.index(4, 3))).toBe(true);
    expect(canStandOn(terrain, grid, pool, 5)).toBe(false);
  });

  it("lets something stand only where the ground is no steeper than it allows", () => {
    const terrain = terrainOf((column) => {
      return column * column;
    });

    const gentle = grid.index(1, 3);
    const steep = grid.index(5, 3);

    expect(canStandOn(terrain, grid, gentle, 0.5)).toBe(true);
    expect(canStandOn(terrain, grid, steep, 0.5)).toBe(false);
    expect(canStandOn(terrain, grid, steep, 5)).toBe(true);
  });
});

describe("walkable ground", () => {
  it("takes walkers onto dry land below the walkable slope, right up to the water", () => {
    const terrain = terrainOf((column) => {
      return column * column;
    });
    const pond = grid.index(2, 3);
    const cliff = grid.index(3, 5);

    terrain.waterSurface[pond] = 50;
    terrain.coastDistance[cliff] = -2;

    expect(isWalkableGround(terrain, grid, grid.index(5, 3))).toBe(true);
    expect(isWalkableGround(terrain, grid, grid.index(6, 3))).toBe(false);
    expect(isWalkableGround(terrain, grid, grid.index(3, 3))).toBe(true);
    expect(isWalkableGround(terrain, grid, pond)).toBe(false);
    expect(isWalkableGround(terrain, grid, cliff)).toBe(false);
  });
});

describe("wild growth", () => {
  it("lets wild plants into full woodland and keeps trees out of a bare glade", () => {
    expect(admittedCells(1, PlantSpecies.Spruce)).toBe(grid.cellCount);
    expect(admittedCells(0, PlantSpecies.Spruce)).toBe(0);
    expect(admittedCells(0, PlantSpecies.Boulder)).toBe(grid.cellCount);
  });

  it("keeps more bushes than trees in a thin stand", () => {
    expect(admittedCells(0.3, PlantSpecies.Bush)).toBeGreaterThan(admittedCells(0.3, PlantSpecies.Oak));
    expect(admittedCells(0, PlantSpecies.Bush)).toBeGreaterThan(grid.cellCount * 0.3);
  });

  it("keeps wild plants clear of the coast and off the grid", () => {
    const terrain = woodlandOf(1);
    const x = grid.centerX(3);
    const z = grid.centerZ(3);

    const nearCoast = { ...terrain, coastDistance: new Float32Array(grid.cellCount).fill(3) };

    expect(hasRoomToGrow(terrain, grid, x, z, PlantSpecies.Oak)).toBe(true);
    expect(canGrowWild(nearCoast, grid, grid.cellAt(x, z), PlantSpecies.Oak)).toBe(true);
    expect(hasRoomToGrow(nearCoast, grid, x, z, PlantSpecies.Oak)).toBe(false);
    expect(hasRoomToGrow(terrain, grid, grid.halfSize + 5, z, PlantSpecies.Oak)).toBe(false);
  });

  it("asks the slope and the woodland together", () => {
    const terrain = woodlandOf(1);
    const cell = grid.index(3, 3);

    expect(canGrowWild(terrain, grid, cell, PlantSpecies.Oak)).toBe(true);
    expect(canGrowWild({ ...terrain, woodland: new Float32Array(grid.cellCount) }, grid, cell, PlantSpecies.Oak)).toBe(
      false
    );
  });
});
