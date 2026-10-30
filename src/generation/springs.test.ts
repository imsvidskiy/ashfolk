import { beforeAll, describe, expect, it } from "vitest";
import { sampleHeight } from "../world/terrain-sampling.ts";
import {
  hasWater,
  pondEdgeReach,
  pondOutlineExtent,
  pondOutlineRadius,
  type River,
  type RiverPoint,
  SPRING_KINDS,
  type Spring,
} from "../world/water.ts";
import { NEIGHBOR_OFFSETS, WorldGrid } from "../world/world-grid.ts";
import { NO_CELL } from "./drainage.ts";
import { pondShoreReach } from "./ponds.ts";
import { SOURCE_REACH } from "./river-spacing.ts";
import { placeSprings } from "./springs.ts";
import { coarseWorld, FULL_SIZE_TIMEOUT, fullSizeWorld } from "./testing/generated-worlds.ts";
import { meanOf, median, quantile } from "./testing/statistics.ts";
import { isLakeWater, isRiverWater } from "./testing/water-checks.ts";
import type { GeneratedWorld } from "./world-generator.ts";

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
const OUTLINE_SAMPLES = 64;
const LEAST_MEAN_OUTLINE_SPREAD = 1.5;
const LEAST_MEDIAN_POND_ACROSS = 52;
const LEAST_UPPER_QUARTILE_POND_ACROSS = 65;
const SMALL_LAKE_ACROSS = 90;
const LEAST_SMALL_LAKE_SHARE = 0.12;
const LEAST_LARGEST_POND_ACROSS = 120;
const MOST_SMALLEST_POND_ACROSS = 45;
const POND_BANK_SLACK = 0.5;

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

function isFedByLake(generated: GeneratedWorld, grid: WorldGrid, river: River): boolean {
  const [head] = river.points;

  return grid.cellsInRadius(head.x, head.z, grid.cellSize * 2.5).some((cell) => {
    return isLakeWater(generated.terrain, cell);
  });
}

function pondsOf(generated: GeneratedWorld): Spring[] {
  return generated.water.springs.filter((spring) => {
    return spring.kind === "pond";
  });
}

function outlineSpread(pond: Spring): number {
  const radii = Array.from({ length: OUTLINE_SAMPLES }, (_, sample) => {
    return pondOutlineRadius(pond, (sample / OUTLINE_SAMPLES) * Math.PI * 2);
  });

  return Math.max(...radii) / Math.min(...radii);
}

function pondWaterCells(generated: GeneratedWorld, grid: WorldGrid, pond: Spring): number[] {
  const { terrain } = generated;

  return grid.cellsInRadius(pond.x, pond.z, pondOutlineExtent(pond)).filter((cell) => {
    return (
      hasWater(terrain.waterSurface[cell], terrain.height[cell]) &&
      terrain.riverStrength[cell] === 0 &&
      Math.abs(terrain.waterSurface[cell] - pond.level) < 0.05
    );
  });
}

function pondAcross(generated: GeneratedWorld, grid: WorldGrid, pond: Spring): number {
  return 2 * Math.sqrt((pondWaterCells(generated, grid, pond).length * grid.cellSize * grid.cellSize) / Math.PI);
}

function pondBankFaults(generated: GeneratedWorld, grid: WorldGrid, pond: Spring): string[] {
  const { terrain } = generated;

  const cells = pondWaterCells(generated, grid, pond);
  const faults: string[] = [];

  let hasOutlet = false;

  for (const cell of cells) {
    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0) {
        continue;
      }

      hasOutlet ||= isRiverWater(terrain, neighbor);

      const isLowBank =
        offset.distance === 1 &&
        !hasWater(terrain.waterSurface[neighbor], terrain.height[neighbor]) &&
        terrain.height[neighbor] < pond.level - POND_BANK_SLACK;

      if (isLowBank) {
        faults.push(`the pond of river ${pond.river} spills over a low bank at cell ${neighbor}`);
      }
    }
  }

  if (cells.length === 0) {
    faults.push(`the pond of river ${pond.river} holds no water`);
  }

  if (!hasOutlet) {
    faults.push(`the pond of river ${pond.river} has no river leaving it`);
  }

  return faults;
}

function ownRiverFaults(pond: Spring, river: River): string[] {
  const leaving = river.points.findIndex((riverPoint) => {
    return pondEdgeReach(pond, riverPoint.x, riverPoint.z) < -riverPoint.width / 2;
  });

  if (leaving < 0) {
    return [];
  }

  const turnsBack = river.points.slice(leaving).some((riverPoint) => {
    return pondEdgeReach(pond, riverPoint.x, riverPoint.z) > -riverPoint.width / 2;
  });

  return turnsBack ? [`river ${river.id} turns back into its own pond`] : [];
}

function pondShoreFaults(generated: GeneratedWorld, grid: WorldGrid, pond: Spring): string[] {
  const { terrain } = generated;

  const faults: string[] = [];

  if (sampleHeight(terrain.coastDistance, grid, pond.x, pond.z) < pondShoreReach(pond)) {
    faults.push(`the pond of river ${pond.river} reaches the coast`);
  }

  const isNearLake = grid.cellsInRadius(pond.x, pond.z, pondOutlineExtent(pond)).some((cell) => {
    return isLakeWater(terrain, cell) && Math.abs(terrain.waterSurface[cell] - pond.level) >= 0.05;
  });

  if (isNearLake) {
    faults.push(`the pond of river ${pond.river} runs into a lake`);
  }

  return faults;
}

function pondFaults(generated: GeneratedWorld): string[] {
  const grid = new WorldGrid(generated.dimensions);
  const ponds = pondsOf(generated);
  const faults: string[] = [];

  for (const pond of ponds) {
    const [head] = generated.water.rivers[pond.river].points;

    if (pondEdgeReach(pond, head.x, head.z) <= 0) {
      faults.push(`the pond of river ${pond.river} does not hold its river head`);
    }

    faults.push(...pondShoreFaults(generated, grid, pond));

    for (const river of generated.water.rivers) {
      if (river.id === pond.river) {
        faults.push(...ownRiverFaults(pond, river));

        continue;
      }

      const isInside = river.points.some((riverPoint) => {
        return pondEdgeReach(pond, riverPoint.x, riverPoint.z) > 0;
      });

      if (isInside) {
        faults.push(`the pond of river ${pond.river} swallows river ${river.id}`);
      }
    }

    for (const other of generated.water.springs) {
      if (other.kind !== "pond" && pondEdgeReach(pond, other.x, other.z) > -other.radius) {
        faults.push(`the pond of river ${pond.river} covers the cave of river ${other.river}`);
      }

      if (
        other.kind === "pond" &&
        other !== pond &&
        Math.hypot(other.x - pond.x, other.z - pond.z) < pondShoreReach(pond) + pondShoreReach(other)
      ) {
        faults.push(`the ponds of rivers ${pond.river} and ${other.river} run together`);
      }
    }
  }

  return faults;
}

function headFaults(generated: GeneratedWorld): string[] {
  const grid = new WorldGrid(generated.dimensions);
  const faults: string[] = [];

  for (const river of generated.water.rivers) {
    const spring = generated.water.springs.find((candidate) => {
      return candidate.river === river.id;
    });
    const [head] = river.points;
    const ahead = river.points.find((riverPoint) => {
      return Math.hypot(riverPoint.x - head.x, riverPoint.z - head.z) >= 25;
    });

    if (spring === undefined) {
      if (!isFedByLake(generated, grid, river)) {
        faults.push(`river ${river.id} starts from nothing at ${head.x.toFixed(0)}, ${head.z.toFixed(0)}`);
      }

      continue;
    }

    if (ahead === undefined) {
      continue;
    }

    const facing =
      (spring.directionX * (ahead.x - head.x) + spring.directionZ * (ahead.z - head.z)) /
      Math.hypot(ahead.x - head.x, ahead.z - head.z);
    const behind = spring.directionX * (head.x - spring.x) + spring.directionZ * (head.z - spring.z);

    if (facing < 0.95 || behind < 0) {
      faults.push(`the ${spring.kind} of river ${river.id} does not face down the river`);
    }
  }

  return faults;
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

describe("springs of coarse islands", () => {
  let world: GeneratedWorld;

  beforeAll(() => {
    world = coarseWorld(7);
  });

  it("starts every river at a pond or a cave facing down the river", () => {
    for (const generated of [world, coarseWorld(7, "square"), coarseWorld(11), coarseWorld(19, "square")]) {
      expect(generated.water.springs.length).toBeGreaterThan(0);
      expect(headFaults(generated)).toEqual([]);
    }
  });

  it("digs ponds as still water at the level of the river head", () => {
    const grid = new WorldGrid(world.dimensions);
    const ponds = pondsOf(world);

    expect(ponds.length).toBeGreaterThan(0);

    for (const pond of ponds) {
      const cell = grid.cellAt(pond.x, pond.z);

      expect(hasWater(world.terrain.waterSurface[cell], world.terrain.height[cell])).toBe(true);
      expect(world.terrain.waterSurface[cell]).toBeCloseTo(pond.level, 1);
      expect(world.terrain.riverStrength[cell]).toBe(0);
    }
  });
});

describe("springs of full-size islands", () => {
  let worlds: GeneratedWorld[];

  beforeAll(() => {
    worlds = [fullSizeWorld(7), fullSizeWorld(1, "square")];
  }, FULL_SIZE_TIMEOUT);

  it("starts every full-size river at a pond or a cave on both shapes", () => {
    for (const generated of worlds) {
      const kinds = new Set(
        generated.water.springs.map((spring) => {
          return spring.kind;
        })
      );

      expect(headFaults(generated)).toEqual([]);
      expect([...kinds].sort()).toEqual([...SPRING_KINDS].sort());
    }
  });

  it("digs spring ponds of many sizes, some of them small lakes, on both shapes", () => {
    const acrosses = worlds.flatMap((generated) => {
      const grid = new WorldGrid(generated.dimensions);

      return pondsOf(generated).map((pond) => {
        return pondAcross(generated, grid, pond);
      });
    });

    const smallLakes = acrosses.filter((across) => {
      return across >= SMALL_LAKE_ACROSS;
    });

    expect(acrosses.length).toBeGreaterThan(20);
    expect(median(acrosses)).toBeGreaterThan(LEAST_MEDIAN_POND_ACROSS);
    expect(quantile(acrosses, 0.75)).toBeGreaterThan(LEAST_UPPER_QUARTILE_POND_ACROSS);
    expect(smallLakes.length / acrosses.length).toBeGreaterThan(LEAST_SMALL_LAKE_SHARE);
    expect(Math.max(...acrosses)).toBeGreaterThan(LEAST_LARGEST_POND_ACROSS);
    expect(Math.min(...acrosses)).toBeLessThan(MOST_SMALLEST_POND_ACROSS);
  });

  it("gives spring ponds varied shapes on both shapes", () => {
    for (const generated of worlds) {
      const ponds = pondsOf(generated);

      expect(ponds.length).toBeGreaterThan(5);
      expect(meanOf(ponds.map(outlineSpread))).toBeGreaterThan(LEAST_MEAN_OUTLINE_SPREAD);
      expect(
        new Set(
          ponds.map((pond) => {
            return outlineSpread(pond).toFixed(2);
          })
        ).size
      ).toBeGreaterThan(ponds.length / 2);
    }
  });

  it("fills each spring pond flat to banks that hold it and lets its river leave it on both shapes", () => {
    for (const generated of worlds) {
      const grid = new WorldGrid(generated.dimensions);

      expect(
        pondsOf(generated).flatMap((pond) => {
          return pondBankFaults(generated, grid, pond);
        })
      ).toEqual([]);
    }
  });

  it("keeps each spring pond at its river head, inland and clear of rivers, caves and other ponds", () => {
    for (const generated of worlds) {
      expect(pondFaults(generated)).toEqual([]);
    }
  });
});
