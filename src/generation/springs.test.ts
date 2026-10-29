import { describe, expect, it } from "vitest";
import { pondEdgeReach, type River, type RiverPoint, type Spring } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { NO_CELL } from "./hydrology.ts";
import { SOURCE_REACH } from "./river-spacing.ts";
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
const LONG_RIVER_START = -200;
const LONG_RIVER_STEP = 20;
const LONG_RIVER_POINTS = 21;
const HILLSIDE_FOOT = -110;
const HILLSIDE_SLOPE = 0.25;
const BIG_RIVER_FLOW = 16;
const TRIBUTARY_JOIN_X = -80;
const TRIBUTARY_REACH = 100;
const GENTLE_SLOPE = 0.1;
const FLAT_GROUND_GAIN = 1.1;
const SIZE_SEEDS = 12;

function point(x: number, z: number, flow: number): RiverPoint {
  return { depth: 1, flow, surface: 0, width: 4, x, z };
}

function riverThrough(points: readonly (readonly [number, number])[], flow = 1, id = 0): River {
  return {
    id,
    points: points.map(([x, z]) => {
      return point(x, z, flow);
    }),
    reachesEdge: false,
  };
}

function longRiver(offsetZ: number, flow = 1): River {
  return riverThrough(
    Array.from({ length: LONG_RIVER_POINTS }, (_, index) => {
      return [LONG_RIVER_START + index * LONG_RIVER_STEP, offsetZ];
    }),
    flow
  );
}

function sitingOn(heights: Float32Array, coastDistance = FAR_FROM_COAST, lakeIds = noLakes()) {
  return {
    coastDistance: new Float32Array(GRID.cellCount).fill(coastDistance),
    grid: GRID,
    heights,
    lakeIds,
    riverThreshold: 1,
  };
}

function flatGround(): Float32Array {
  return new Float32Array(GRID.cellCount);
}

function hillside(): Float32Array {
  return Float32Array.from({ length: GRID.cellCount }, (_, cell) => {
    return Math.max(0, HILLSIDE_FOOT - GRID.cellCenterX(cell)) * HILLSIDE_SLOPE;
  });
}

function gentleSlopeBehind(headX: number): Float32Array {
  return Float32Array.from({ length: GRID.cellCount }, (_, cell) => {
    return Math.max(0, headX - GRID.cellCenterX(cell)) * GENTLE_SLOPE;
  });
}

function springOf(river: River, heights = flatGround()): Spring {
  const [spring] = placeSprings(sitingOn(heights), [river]).springs;

  return spring;
}

function springKindOf(river: River, coastDistance: number, lakeIds: Int32Array): string {
  const [spring] = placeSprings(sitingOn(flatGround(), coastDistance, lakeIds), [river]).springs;

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
      [90, 40],
      [56, 40],
      [56, 0],
    ]);

    expect(springKindOf(loop, FAR_FROM_COAST, noLakes())).toBe("cave");
  });

  it("move down the river onto flatter ground and start the river at the pond", () => {
    const river = longRiver(0);

    const plan = placeSprings(sitingOn(hillside()), [river]);

    const [spring] = plan.springs;
    const [seated] = plan.rivers;
    const [head] = seated.points;

    expect(spring.kind).toBe("pond");
    expect(head.x).toBeGreaterThan(LONG_RIVER_START);
    expect(seated.points.at(-1)).toEqual(river.points.at(-1));
    expect(pondEdgeReach(spring, head.x, head.z)).toBeGreaterThan(0);
    expect(spring.radius).toBeGreaterThan(20);
  });

  it("stay far enough up the river from the first tributary that joins it", () => {
    const tributary = riverThrough(
      [
        [TRIBUTARY_JOIN_X, TRIBUTARY_REACH],
        [TRIBUTARY_JOIN_X, TRIBUTARY_REACH / 2],
        [TRIBUTARY_JOIN_X, 0],
      ],
      1,
      1
    );

    const plan = placeSprings(sitingOn(hillside()), [longRiver(0), tributary]);

    const [head] = plan.rivers[0].points;

    expect(Math.hypot(TRIBUTARY_JOIN_X - head.x, head.z)).toBeGreaterThanOrEqual(SOURCE_REACH);
  });

  it("draw larger ponds on flat ground than on a gentle slope", () => {
    const sizes = Array.from({ length: SIZE_SEEDS }, (_, index) => {
      const offsetZ = (index - SIZE_SEEDS / 2) * 3;
      const river = riverThrough(
        STRAIGHT_RIVER.points.map(({ x, z }) => {
          return [x, z + offsetZ];
        })
      );

      return springOf(river).radius / springOf(river, gentleSlopeBehind(river.points[0].x)).radius;
    });

    for (const size of sizes) {
      expect(size).toBeGreaterThan(FLAT_GROUND_GAIN);
    }
  });

  it("draw larger ponds for larger rivers", () => {
    const sizes = Array.from({ length: SIZE_SEEDS }, (_, index) => {
      const offsetZ = (index - SIZE_SEEDS / 2) * 3;

      return springOf(longRiver(offsetZ, BIG_RIVER_FLOW)).radius / springOf(longRiver(offsetZ)).radius;
    });

    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(1);
    }

    expect(Math.max(...sizes)).toBeGreaterThan(1.3);
  });
});
