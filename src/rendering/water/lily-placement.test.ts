import { describe, expect, it } from "vitest";
import { Biome } from "../../content/biomes.ts";
import { isPoolGround } from "../../content/grounds.ts";
import { coarseWorld } from "../../generation/testing/generated-worlds.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import {
  DEEPEST_LILY_WATER,
  type LilyWorld,
  lilyCells,
  MARSH_REACH_CELLS,
  placeLilies,
  SHALLOWEST_LILY_WATER,
} from "./lily-placement.ts";

const FLOATS_PER_LILY = 4;

function openLake(): LilyWorld {
  const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 32 });
  const { cellCount } = grid;

  return {
    grid,
    terrain: {
      baseTemperature: new Float32Array(cellCount).fill(18),
      biome: new Uint8Array(cellCount).fill(Biome.Water),
      coastDistance: new Float32Array(cellCount).fill(500),
      ground: new Uint8Array(cellCount),
      height: new Float32Array(cellCount).fill(40),
      moisture: new Float32Array(cellCount).fill(0.9),
      riverStrength: new Uint8Array(cellCount),
      waterSurface: new Float32Array(cellCount).fill(41),
    },
  };
}

function marshDistance(world: LilyWorld, cell: number): number {
  const { grid, terrain } = world;

  let nearest = Number.POSITIVE_INFINITY;

  for (let other = 0; other < grid.cellCount; other += 1) {
    if (terrain.biome[other] === Biome.Swamp) {
      const across = Math.abs(grid.columnOf(other) - grid.columnOf(cell));
      const along = Math.abs(grid.rowOf(other) - grid.rowOf(cell));

      nearest = Math.min(nearest, Math.max(across, along));
    }
  }

  return nearest;
}

describe("lily placement", () => {
  it("leaves open lake water without a marsh bare", () => {
    expect(placeLilies(openLake()).pads).toEqual([]);
  });

  it("grows lilies only along a marsh shore", () => {
    const world = openLake();

    for (let row = 0; row < world.grid.cellsPerSide; row += 1) {
      world.terrain.biome[world.grid.index(0, row)] = Biome.Swamp;
    }

    const cells = lilyCells(world);

    expect(cells.length).toBeGreaterThan(0);

    for (const { cell } of cells) {
      expect(world.grid.columnOf(cell)).toBeLessThanOrEqual(MARSH_REACH_CELLS);
    }
  });

  it("keeps out of rivers", () => {
    const world = openLake();

    world.terrain.biome.fill(Biome.Swamp);
    world.terrain.riverStrength.fill(1);

    expect(placeLilies(world).pads).toEqual([]);
  });

  it("puts no lily outside marsh pools and shallow still water by a marsh on a generated island", () => {
    const { dimensions, terrain } = coarseWorld(7);
    const world = { grid: new WorldGrid(dimensions), terrain };

    const cells = lilyCells(world);
    const strays = cells.filter(({ cell, isPool }) => {
      if (isPool) {
        return !isPoolGround(terrain.ground[cell]);
      }

      const depth = terrain.waterSurface[cell] - terrain.height[cell];

      return (
        terrain.riverStrength[cell] !== 0 ||
        depth < SHALLOWEST_LILY_WATER ||
        depth > DEEPEST_LILY_WATER ||
        marshDistance(world, cell) > MARSH_REACH_CELLS
      );
    });

    expect(
      cells.filter(({ isPool }) => {
        return !isPool;
      }).length
    ).toBeGreaterThan(0);
    expect(strays).toEqual([]);
    expect(placeLilies(world).pads.length).toBeGreaterThan(cells.length * FLOATS_PER_LILY);
  });
});
