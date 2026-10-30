import { beforeAll, describe, expect, it } from "vitest";
import { isOnIsland } from "../world/coast.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { WorldGrid } from "../world/world-grid.ts";
import {
  COARSE_DIMENSIONS,
  coarseWorld,
  FULL_SIZE_TIMEOUT,
  fullSizeWorld,
  islandsAcrossSeeds,
} from "./testing/generated-worlds.ts";
import { surveyIsland } from "./testing/island-survey.ts";
import type { GeneratedWorld } from "./world-generator.ts";

function edgeSides(grid: WorldGrid): number[][] {
  const last = grid.cellsPerSide - 1;
  const positions = Array.from({ length: grid.cellsPerSide }, (_, position) => {
    return position;
  });

  return [
    positions.map((position) => {
      return grid.index(position, 0);
    }),
    positions.map((position) => {
      return grid.index(position, last);
    }),
    positions.map((position) => {
      return grid.index(0, position);
    }),
    positions.map((position) => {
      return grid.index(last, position);
    }),
  ];
}

function coastCells(terrain: TerrainData, grid: WorldGrid): number[] {
  return Array.from({ length: grid.cellCount }, (_, cell) => {
    return cell;
  }).filter((cell) => {
    return (
      isOnIsland(terrain.coastDistance, cell) &&
      grid.cellsInRadius(grid.cellCenterX(cell), grid.cellCenterZ(cell), grid.cellSize * 1.5).some((neighbor) => {
        return !isOnIsland(terrain.coastDistance, neighbor);
      })
    );
  });
}

function largestStepAlong(heights: Float32Array, cells: readonly number[]): number {
  let largest = 0;

  for (let position = 1; position < cells.length; position += 1) {
    largest = Math.max(largest, Math.abs(heights[cells[position]] - heights[cells[position - 1]]));
  }

  return largest;
}

describe("relief of a coarse island", () => {
  const grid = new WorldGrid(COARSE_DIMENSIONS);

  let world: GeneratedWorld;
  let squareWorld: GeneratedWorld;

  beforeAll(() => {
    world = coarseWorld(7);
    squareWorld = coarseWorld(7, "square");
  });

  it("builds mountains, lowlands and a lake basin", () => {
    let highest = Number.NEGATIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;

    for (const height of squareWorld.terrain.height) {
      highest = Math.max(highest, height);
      lowest = Math.min(lowest, height);
    }

    expect(highest).toBeGreaterThan(900);
    expect(lowest).toBeLessThan(200);
    expect(squareWorld.water.lakes.length).toBeGreaterThanOrEqual(3);
  });

  it("raises mountains and a lake on the round island too", () => {
    const heights = world.terrain.height.filter((_, cell) => {
      return isOnIsland(world.terrain.coastDistance, cell);
    });

    expect(Math.max(...heights)).toBeGreaterThan(900);
    expect(Math.min(...heights)).toBeLessThan(200);
    expect(world.water.lakes.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the square island whole to its edges", () => {
    expect(
      squareWorld.terrain.coastDistance.every((distance) => {
        return distance > 0;
      })
    ).toBe(true);
  });

  it("rounds the island off with a coast inside the square", () => {
    const last = grid.cellsPerSide - 1;
    const middle = Math.floor(grid.cellsPerSide / 2);

    for (const corner of [grid.index(0, 0), grid.index(last, 0), grid.index(0, last), grid.index(last, last)]) {
      expect(isOnIsland(world.terrain.coastDistance, corner)).toBe(false);
    }

    expect(isOnIsland(world.terrain.coastDistance, grid.index(middle, middle))).toBe(true);
  });

  it("keeps the square island rim at a moderate height", () => {
    const rim = edgeSides(grid).flatMap((side) => {
      return side.map((cell) => {
        return squareWorld.terrain.height[cell];
      });
    });

    expect(Math.min(...rim)).toBeGreaterThan(120);
    expect(Math.max(...rim)).toBeLessThan(400);
  });

  it("eases the round island down to a low shore", () => {
    const shore = coastCells(world.terrain, grid).map((cell) => {
      return world.terrain.height[cell];
    });

    expect(Math.min(...shore)).toBeGreaterThan(30);
    expect(Math.max(...shore)).toBeLessThan(300);
  });
});

describe("relief of a full-size island", () => {
  let round: GeneratedWorld;
  let square: GeneratedWorld;

  beforeAll(() => {
    round = fullSizeWorld(7);
    square = fullSizeWorld(1, "square");
  }, FULL_SIZE_TIMEOUT);

  it("meets the square cliff at a moderate height without steps that could open gaps", () => {
    const grid = new WorldGrid(square.dimensions);

    const { height } = square.terrain;

    for (const side of edgeSides(grid)) {
      const heights = side.map((cell) => {
        return height[cell];
      });

      expect(Math.min(...heights)).toBeGreaterThan(120);
      expect(Math.max(...heights)).toBeLessThan(400);
      expect(largestStepAlong(height, side)).toBeLessThan(15);
    }
  });

  it("meets the round coast at a moderate height", () => {
    const shore = coastCells(round.terrain, new WorldGrid(round.dimensions)).map((cell) => {
      return round.terrain.height[cell];
    });

    expect(Math.min(...shore)).toBeGreaterThan(100);
    expect(Math.max(...shore)).toBeLessThan(300);
  });
});

describe("relief across seeds", () => {
  let highGroundAngles: number[];

  beforeAll(() => {
    const { round, square } = islandsAcrossSeeds();

    highGroundAngles = [...round, ...square].map((generated) => {
      return surveyIsland(generated).highGroundAngle;
    });
  }, FULL_SIZE_TIMEOUT);

  it("turns the highest ground toward most points of the compass", () => {
    const octants = new Set(
      highGroundAngles.map((angle) => {
        return (Math.round(angle / (Math.PI / 4)) + 8) % 8;
      })
    );

    expect(octants.size).toBeGreaterThanOrEqual(6);
  });
});
