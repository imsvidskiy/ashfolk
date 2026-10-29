import { describe, expect, it } from "vitest";
import type { River, RiverPoint } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { NO_CELL } from "./hydrology.ts";
import { placeSprings } from "./springs.ts";

const GRID = new WorldGrid({ cellSize: 5, cellsPerSide: 96 });
const FAR_FROM_COAST = 1000;
const NEAR_COAST = 60;
const LAKE_EDGE_X = 15;
const STRAIGHT_RIVER = riverThrough([
  [60, 0],
  [90, 0],
  [120, 0],
]);

function point(x: number, z: number): RiverPoint {
  return { depth: 1, flow: 1, surface: 0, width: 4, x, z };
}

function riverThrough(points: readonly (readonly [number, number])[]): River {
  return {
    id: 0,
    points: points.map(([x, z]) => {
      return point(x, z);
    }),
    reachesEdge: false,
  };
}

function springKindOf(river: River, coastDistance: number, lakeIds: Int32Array): string {
  const siting = {
    coastDistance: new Float32Array(GRID.cellCount).fill(coastDistance),
    grid: GRID,
    heights: new Float32Array(GRID.cellCount),
    lakeIds,
    riverThreshold: 1,
  };

  const [spring] = placeSprings(siting, [river]).springs;

  return spring.kind;
}

function noLakes(): Int32Array {
  return new Int32Array(GRID.cellCount).fill(NO_CELL);
}

describe("spring ponds", () => {
  it("dig a pond at a gentle head far from the coast and lakes", () => {
    expect(springKindOf(STRAIGHT_RIVER, FAR_FROM_COAST, noLakes())).toBe("pond");
  });

  it("give way to a cave when the pond and its shore would reach the coast", () => {
    expect(springKindOf(STRAIGHT_RIVER, NEAR_COAST, noLakes())).toBe("cave");
  });

  it("give way to a cave when the pond would run into a lake", () => {
    const lakeIds = noLakes();

    for (let cell = 0; cell < GRID.cellCount; cell += 1) {
      if (GRID.cellCenterX(cell) < LAKE_EDGE_X) {
        lakeIds[cell] = 0;
      }
    }

    expect(springKindOf(STRAIGHT_RIVER, FAR_FROM_COAST, lakeIds)).toBe("cave");
  });

  it("give way to a cave when their own river bends back into the pond", () => {
    const loop = riverThrough([
      [60, 0],
      [90, 0],
      [120, 0],
      [120, 60],
      [60, 60],
      [56, 0],
    ]);

    expect(springKindOf(loop, FAR_FROM_COAST, noLakes())).toBe("cave");
  });
});
