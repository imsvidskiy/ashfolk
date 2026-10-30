import { describe, expect, it } from "vitest";
import { Ground } from "../../content/grounds.ts";
import { createRandom } from "../../shared/random.ts";
import { createTestWorld } from "../testing/test-world.ts";
import {
  brushFalloff,
  carveCrater,
  cellsInArea,
  flattenTerrain,
  raiseTerrain,
  shakeTerrain,
  smoothTerrain,
} from "./terrain-editing.ts";
import type { WorldState } from "./world-state.ts";

const BRUSH = { radius: 60, x: 5, z: 5 };

function heightAtCellCenter(world: WorldState, x: number, z: number): number {
  return world.terrain.height[world.grid.cellAt(x, z)];
}

describe("brush areas", () => {
  it("collects the cells inside the circle", () => {
    const world = createTestWorld();

    const cells = cellsInArea(world, { radius: 15, x: 5, z: 5 });

    expect(cells.length).toBeGreaterThan(5);
    expect(
      cells.every((areaCell) => {
        return areaCell.distance <= 15;
      })
    ).toBe(true);
  });

  it("fades from full strength at the center to nothing at the edge", () => {
    expect(brushFalloff(0, 10)).toBe(1);
    expect(brushFalloff(5, 10)).toBeCloseTo(0.5);
    expect(brushFalloff(10, 10)).toBeCloseTo(0);
  });
});

describe("terrain editing", () => {
  it("raises the center the most and leaves the outside alone", () => {
    const world = createTestWorld();

    raiseTerrain(world, BRUSH, 10);

    expect(heightAtCellCenter(world, 5, 5)).toBeCloseTo(110);
    expect(heightAtCellCenter(world, 45, 5)).toBeGreaterThan(100);
    expect(heightAtCellCenter(world, 45, 5)).toBeLessThan(110);
    expect(heightAtCellCenter(world, 105, 5)).toBe(100);
    expect(world.heightVersion).toBe(1);
  });

  it("never edits the rim of the island", () => {
    const world = createTestWorld();

    const edge = -world.grid.halfSize + 5;

    raiseTerrain(world, { radius: 40, x: edge, z: edge }, 10);

    expect(world.terrain.height[0]).toBe(100);
    expect(world.terrain.height[world.grid.index(2, 2)]).toBeGreaterThan(100);
  });

  it("leaves the land alone when the brush misses the map", () => {
    const world = createTestWorld();

    const outside = { radius: 60, x: world.grid.worldSize * 2, z: 0 };

    raiseTerrain(world, outside, 10);
    flattenTerrain(world, outside, 50, 1);
    smoothTerrain(world, outside, 1);
    carveCrater(world, outside, 12);
    shakeTerrain(world, outside, 1, createRandom(4));

    expect(world.heightVersion).toBe(0);
    expect(world.takeSuddenHeightEdit()).toBe(false);
  });

  it("flattens towards the target height", () => {
    const world = createTestWorld({
      heightAt: (x) => {
        return 100 + x;
      },
    });

    for (let stroke = 0; stroke < 20; stroke += 1) {
      flattenTerrain(world, BRUSH, 105, 0.5);
    }

    expect(heightAtCellCenter(world, 25, 5)).toBeCloseTo(105, 0);
  });

  it("smooths a spike into its surroundings", () => {
    const world = createTestWorld();

    const spike = world.grid.cellAt(5, 5);

    world.terrain.height[spike] = 180;
    smoothTerrain(world, BRUSH, 1);

    expect(world.terrain.height[spike]).toBeCloseTo(100);
  });

  it("digs a bowl with a raised rim", () => {
    const world = createTestWorld();

    carveCrater(world, { radius: 50, x: 5, z: 5 }, 12);

    expect(heightAtCellCenter(world, 5, 5)).toBeCloseTo(88);
    expect(heightAtCellCenter(world, 55, 5)).toBeGreaterThan(100);
  });

  it("bares the steep walls of a deep crater as rock", () => {
    const world = createTestWorld();

    carveCrater(world, { radius: 140, x: 5, z: 5 }, 52);

    expect(world.terrain.ground[world.grid.cellAt(125, 5)]).toBe(Ground.Rock);
    expect(world.terrain.ground[world.grid.cellAt(5, 5)]).toBe(Ground.Meadow);
  });

  it("shakes the ground unevenly", () => {
    const world = createTestWorld();

    shakeTerrain(world, BRUSH, 1, createRandom(4));

    const heights = cellsInArea(world, BRUSH).map((areaCell) => {
      return world.terrain.height[areaCell.cell];
    });

    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(1);
  });
});
