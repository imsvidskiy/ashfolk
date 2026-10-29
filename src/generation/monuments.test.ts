import { beforeAll, describe, expect, it as test } from "vitest";
import { Biome } from "../content/biomes.ts";
import { MONUMENT_KINDS, MONUMENT_SLOPE, MONUMENTS } from "../content/monuments.ts";
import { isMonumentSpecies, plantSpeciesDefinition } from "../content/plants.ts";
import { canStandOn } from "../world/footing.ts";
import type { IslandShapeKind } from "../world/island-shape.ts";
import { islandDimensions } from "../world/island-size.ts";
import { isWaterCell } from "../world/terrain-sampling.ts";
import { createTerrainData } from "../world/testing/terrain-fixtures.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { planMonuments } from "./monuments.ts";
import { cellMask, type GeneratedWorld, generateWorld } from "./world-generator.ts";

const TEST_DIMENSIONS = { cellSize: 40, cellsPerSide: 128 };
const DRY_REACH = 30;

const worlds = new Map<IslandShapeKind, GeneratedWorld>();

function generate(seed: number, shape: IslandShapeKind): GeneratedWorld {
  return generateWorld(seed, { dimensions: TEST_DIMENSIONS, erosionStrength: 1, shape });
}

function worldOf(shape: IslandShapeKind): GeneratedWorld {
  const generated = worlds.get(shape);

  if (generated === undefined) {
    throw new Error(`No ${shape} world was generated`);
  }

  return generated;
}

beforeAll(() => {
  worlds.set("round", generate(7, "round"));
  worlds.set("square", generate(3, "square"));
});

describe.each(["round", "square"] as const)("monuments on a %s island", (shape) => {
  test("raises a handful of them, of several kinds", () => {
    const { monuments } = worldOf(shape);

    expect(monuments.length).toBeGreaterThanOrEqual(4);
    expect(monuments.length).toBeLessThanOrEqual(8);
    expect(
      new Set(
        monuments.map((monument) => {
          return monument.kind;
        })
      ).size
    ).toBeGreaterThanOrEqual(4);
  });

  test("sets them on dry, level ground away from water and the coast", () => {
    const { monuments, terrain } = worldOf(shape);

    const grid = new WorldGrid(TEST_DIMENSIONS);

    for (const monument of monuments) {
      const cells = [...monument.cells, ...grid.cellsInRadius(monument.x, monument.z, DRY_REACH)];

      expect(
        monument.cells.every((cell) => {
          return canStandOn(terrain, grid, cell, MONUMENT_SLOPE);
        }),
        monument.name
      ).toBe(true);
      expect(
        cells.some((cell) => {
          return isWaterCell(terrain, cell);
        }),
        monument.name
      ).toBe(false);
    }
  });

  test("gives each a name of its kind, and no name twice", () => {
    const { monuments } = worldOf(shape);

    const names = monuments.map((monument) => {
      return monument.name;
    });

    expect(new Set(names).size).toBe(names.length);

    for (const monument of monuments) {
      expect(MONUMENTS[monument.kind].names).toContain(monument.name);
    }
  });

  test("grows nothing on monument ground but the monument itself", () => {
    const { monuments, vegetation } = worldOf(shape);

    const grid = new WorldGrid(TEST_DIMENSIONS);
    const ground = cellMask(grid.cellCount, monuments);

    let stones = 0;

    for (let plant = 0; plant < vegetation.count; plant += 1) {
      const cell = grid.cellAt(vegetation.x[plant], vegetation.z[plant]);
      const isMonument = isMonumentSpecies(vegetation.species[plant]);

      expect(ground[cell] === 1, plantSpeciesDefinition(vegetation.species[plant]).name).toBe(isMonument);

      stones += isMonument ? 1 : 0;
    }

    expect(stones).toBeGreaterThanOrEqual(monuments.length);
  });
});

describe.each([
  ["small", 1],
  ["normal", 2],
  ["large", 3],
] as const)("monuments on a %s island", (size, extras) => {
  test("raises extra monuments in step with the island area", () => {
    const dimensions = islandDimensions(size);
    const terrain = createTerrainData(dimensions);

    terrain.height.fill(50);
    terrain.biome.fill(Biome.Steppe);

    const { monuments } = planMonuments(new WorldGrid(dimensions), terrain, 3);

    expect(monuments.length - MONUMENT_KINDS.length).toBe(extras);
  });
});
