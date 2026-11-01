import { beforeAll, describe, expect, it, it as test } from "vitest";
import { HOP_WIDTH, isBrookCell } from "../world/brooks.ts";
import { type Crossing, crossingLength, crossingMiddle, crossingPointOf, isOnCrossing } from "../world/crossings.ts";
import type { IslandShapeKind } from "../world/island-shape.ts";
import { isWaterCell } from "../world/terrain-sampling.ts";
import { createTerrainData } from "../world/testing/terrain-fixtures.ts";
import { NO_WATER, type River } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { planCrossings, refreshCrossings } from "./crossings.ts";
import { DEFAULT_GENERATION_OPTIONS } from "./generation-options.ts";
import { computeHydrology } from "./hydrology.ts";
import { type GeneratedWorld, generateWorld } from "./world-generator.ts";

const LONG_WIDE_STRETCH = 1000;
const WATERFALL_CLEARANCE = 100;
const LAKE_CLEARANCE = 25;
const COAST_CLEARANCE = 45;
const ON_RIVER = 18;
const SPACING_ALONG = 500;
const WIDEST_GAP = 900;
const WIDTH_MARGIN = 0.4;
const FALL_REACH = 15;
const FORD_STEEPEST_FALL = 0.06;
const STEEP_FALL = 0.2;

const worlds = new Map<IslandShapeKind, GeneratedWorld>();

function worldOf(shape: IslandShapeKind): GeneratedWorld {
  const generated = worlds.get(shape);

  if (generated === undefined) {
    throw new Error(`No ${shape} world was generated`);
  }

  return generated;
}

function wideStretch(river: River): number {
  return river.points.slice(1).reduce((sum, point, index) => {
    const previous = river.points[index];

    return point.width > HOP_WIDTH ? sum + Math.hypot(point.x - previous.x, point.z - previous.z) : sum;
  }, 0);
}

function positionsAlong(river: River, crossings: readonly Crossing[]): number[] {
  const positions: number[] = [];

  for (const crossing of crossings) {
    const middle = crossingMiddle(crossing);

    let traveled = 0;
    let nearest = { along: 0, distance: Number.POSITIVE_INFINITY };

    for (const [index, point] of river.points.entries()) {
      if (index > 0) {
        traveled += Math.hypot(point.x - river.points[index - 1].x, point.z - river.points[index - 1].z);
      }

      const distance = Math.hypot(point.x - middle.x, point.z - middle.z);

      if (distance < nearest.distance) {
        nearest = { along: traveled, distance };
      }
    }

    if (nearest.distance < ON_RIVER) {
      positions.push(nearest.along);
    }
  }

  return positions.sort((first, second) => {
    return first - second;
  });
}

function fallAround(river: River, point: { x: number; z: number }): { distance: number; fall: number } {
  const lengths = [0];

  let length = 0;

  for (let index = 1; index < river.points.length; index += 1) {
    const previous = river.points[index - 1];
    const current = river.points[index];

    length += Math.hypot(current.x - previous.x, current.z - previous.z);
    lengths.push(length);
  }

  function surfaceAt(along: number): number {
    const clamped = Math.min(Math.max(along, 0), length);
    const index = Math.max(
      0,
      lengths.findLastIndex((start) => {
        return start <= clamped;
      })
    );
    const next = Math.min(index + 1, lengths.length - 1);
    const span = lengths[next] - lengths[index];
    const amount = span > 0 ? (clamped - lengths[index]) / span : 0;

    return river.points[index].surface + (river.points[next].surface - river.points[index].surface) * amount;
  }

  const nearest = river.points.reduce(
    (best, candidate, index) => {
      const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);

      return distance < best.distance ? { along: lengths[index], distance } : best;
    },
    { along: 0, distance: Number.POSITIVE_INFINITY }
  );
  const before = Math.max(0, nearest.along - FALL_REACH);
  const after = Math.min(length, nearest.along + FALL_REACH);

  return {
    distance: nearest.distance,
    fall: after > before ? Math.abs(surfaceAt(before) - surfaceAt(after)) / (after - before) : 0,
  };
}

function samplesAlong(crossing: Crossing): { x: number; z: number }[] {
  const length = crossingLength(crossing);

  return Array.from({ length: Math.ceil(length) + 1 }, (_, step) => {
    const amount = Math.min(0.999, Math.max(0.001, step / length));

    return {
      x: crossing.startX + (crossing.endX - crossing.startX) * amount,
      z: crossing.startZ + (crossing.endZ - crossing.startZ) * amount,
    };
  });
}

beforeAll(() => {
  worlds.set("round", generateWorld(7));
  worlds.set("square", generateWorld(4, { ...DEFAULT_GENERATION_OPTIONS, shape: "square" }));
}, 120_000);

describe.each(["round", "square"] as const)("crossings on a %s island", (shape) => {
  test("give most rivers that run too wide to hop for a long way a ford or a fallen log", () => {
    const { crossings, water } = worldOf(shape);

    const longRivers = water.rivers.filter((river) => {
      return wideStretch(river) > LONG_WIDE_STRETCH;
    });
    const crossed = longRivers.filter((river) => {
      return positionsAlong(river, crossings).length > 0;
    });

    expect(longRivers.length).toBeGreaterThan(0);
    expect(crossed.length / longRivers.length).toBeGreaterThan(0.8);
    expect(
      crossings.some((crossing) => {
        return crossing.kind === "ford";
      })
    ).toBe(true);
    expect(
      crossings.some((crossing) => {
        return crossing.kind === "log";
      })
    ).toBe(true);
  });

  test("leave brooks to be hopped and treat only rivers no wider than a hop as brooks", () => {
    const { crossings, dimensions, terrain, water } = worldOf(shape);
    const grid = new WorldGrid(dimensions);

    function cellOf(point: { x: number; z: number }): number {
      return grid.cellAt(point.x, point.z);
    }

    const pondCells = new Set(
      water.springs.flatMap((spring) => {
        return spring.cells;
      })
    );
    const points = water.rivers
      .flatMap((river) => {
        return river.points;
      })
      .filter((point) => {
        return !pondCells.has(cellOf(point));
      });

    const narrow = points.filter((point) => {
      return point.width <= HOP_WIDTH - WIDTH_MARGIN && isWaterCell(terrain, cellOf(point));
    });
    const wide = points.filter((point) => {
      return point.width >= HOP_WIDTH + WIDTH_MARGIN && isWaterCell(terrain, cellOf(point));
    });

    expect(
      narrow.filter((point) => {
        return isBrookCell(terrain, cellOf(point));
      }).length / narrow.length
    ).toBeGreaterThan(0.9);
    expect(
      wide.some((point) => {
        return isBrookCell(terrain, cellOf(point));
      })
    ).toBe(false);
    expect(
      crossings.some((crossing) => {
        return isBrookCell(terrain, cellOf(crossingMiddle(crossing)));
      })
    ).toBe(false);
  });

  test("space them five to eight hundred meters apart along a river", () => {
    const { crossings, water } = worldOf(shape);

    const gaps = water.rivers.flatMap((river) => {
      const positions = positionsAlong(river, crossings);

      return positions.slice(1).map((position, index) => {
        return position - positions[index];
      });
    });

    const sorted = [...gaps].sort((first, second) => {
      return first - second;
    });

    expect(sorted.length).toBeGreaterThan(0);
    expect(sorted[0]).toBeGreaterThan(SPACING_ALONG * 0.9);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(WIDEST_GAP);
  });

  test("span river water between two dry, gentle banks", () => {
    const { crossings, dimensions, terrain } = worldOf(shape);
    const grid = new WorldGrid(dimensions);

    for (const crossing of crossings) {
      const cells = samplesAlong(crossing).map((point) => {
        return grid.cellAt(point.x, point.z);
      });

      const wet = cells.filter((cell) => {
        return isWaterCell(terrain, cell);
      });
      const ends = [grid.cellAt(crossing.startX, crossing.startZ), grid.cellAt(crossing.endX, crossing.endZ)];

      expect(wet.length, `crossing ${crossing.id}`).toBeGreaterThan(0);
      expect(
        wet.every((cell) => {
          return terrain.riverStrength[cell] > 0;
        }),
        `crossing ${crossing.id}`
      ).toBe(true);
      expect(
        ends.some((cell) => {
          return isWaterCell(terrain, cell);
        }),
        `crossing ${crossing.id}`
      ).toBe(false);
    }
  });

  test("keep away from waterfalls, lakes and the coast", () => {
    const { crossings, dimensions, terrain, water } = worldOf(shape);
    const grid = new WorldGrid(dimensions);

    function isStillWater(cell: number): boolean {
      return isWaterCell(terrain, cell) && terrain.riverStrength[cell] === 0;
    }

    for (const crossing of crossings) {
      const middle = crossingMiddle(crossing);

      for (const waterfall of water.waterfalls) {
        expect(Math.hypot(waterfall.x - middle.x, waterfall.z - middle.z)).toBeGreaterThan(WATERFALL_CLEARANCE);
      }

      expect(grid.cellsInRadius(middle.x, middle.z, LAKE_CLEARANCE).some(isStillWater), `crossing ${crossing.id}`).toBe(
        false
      );

      for (const point of samplesAlong(crossing)) {
        expect(terrain.coastDistance[grid.cellAt(point.x, point.z)]).toBeGreaterThan(COAST_CLEARANCE);
      }
    }
  });

  test("lay fallen logs over narrow water and stepping stones over wider, shallow water", () => {
    const { crossings, dimensions, terrain } = worldOf(shape);
    const grid = new WorldGrid(dimensions);

    function wetPointsOf(crossing: Crossing): { x: number; z: number }[] {
      return samplesAlong(crossing).filter((point) => {
        return isWaterCell(terrain, grid.cellAt(point.x, point.z));
      });
    }

    for (const log of crossings.filter((crossing) => {
      return crossing.kind === "log";
    })) {
      const alongs = wetPointsOf(log).map((point) => {
        return crossingPointOf(log, point.x, point.z).along;
      });
      const span = Math.max(...alongs) - Math.min(...alongs);

      expect(span, `log ${log.id}`).toBeLessThan(23);
    }

    for (const ford of crossings.filter((crossing) => {
      return crossing.kind !== "log";
    })) {
      const deepest = Math.max(
        ...wetPointsOf(ford).map((point) => {
          const cell = grid.cellAt(point.x, point.z);

          return terrain.waterSurface[cell] - terrain.height[cell];
        })
      );

      expect(deepest, `ford ${ford.id}`).toBeLessThan(4.05);
    }
  });

  test("keep fords to calm reaches of a river", () => {
    const { crossings, water } = worldOf(shape);

    for (const ford of crossings.filter((crossing) => {
      return crossing.kind === "ford";
    })) {
      const nearest = water.rivers
        .map((river) => {
          return fallAround(river, crossingMiddle(ford));
        })
        .reduce((best, candidate) => {
          return candidate.distance < best.distance ? candidate : best;
        });

      expect(nearest.fall, `ford ${ford.id}`).toBeLessThan(FORD_STEEPEST_FALL * 1.25);
    }
  });

  test("can be walked along from end to end", () => {
    for (const crossing of worldOf(shape).crossings) {
      expect(
        samplesAlong(crossing).every((point) => {
          return isOnCrossing(crossing, point.x, point.z);
        })
      ).toBe(true);
    }
  });

  test("keep every crossing that still spans its river when the water is worked out again", { timeout: 60_000 }, () => {
    const generated = worldOf(shape);
    const grid = new WorldGrid(generated.dimensions);
    const terrain = { ...generated.terrain, height: Float32Array.from(generated.terrain.height) };

    const hydrology = computeHydrology(Float32Array.from(terrain.height), grid, terrain.dryness, terrain.coastDistance);

    const refreshed = refreshCrossings(
      {
        grid,
        isBlocked: () => {
          return false;
        },
        lakeIds: hydrology.lakeIds,
        terrain,
        water: generated.water,
      },
      generated.crossings
    );

    const kept = refreshed.filter((crossing) => {
      return generated.crossings.some((original) => {
        return original.id === crossing.id;
      });
    });

    expect(kept.length).toBeGreaterThan(generated.crossings.length * 0.8);
  });
});

function landCutInTwo(fall: number): Parameters<typeof planCrossings>[0] {
  const dimensions = { cellSize: 10, cellsPerSide: 48 };
  const grid = new WorldGrid(dimensions);
  const terrain = createTerrainData(dimensions);

  terrain.waterSurface.fill(NO_WATER);
  terrain.height.fill(100);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (Math.abs(grid.cellCenterX(cell)) < 10) {
      terrain.height[cell] = 99.4;
      terrain.waterSurface[cell] = 99.9;
      terrain.riverStrength[cell] = 120;
    }
  }

  const points = Array.from({ length: 21 }, (_, index) => {
    return {
      depth: 0.5,
      flow: 1,
      surface: 99.9 - (index - 10) * 10 * fall,
      width: 8,
      x: 0,
      z: -100 + index * 10,
    };
  });

  return {
    grid,
    isBlocked: () => {
      return false;
    },
    lakeIds: new Int32Array(grid.cellCount).fill(-1),
    terrain,
    water: { lakes: [], rivers: [{ id: 0, points, reachesEdge: false }], springs: [], waterfalls: [] },
  };
}

function kindsOf(crossings: readonly Crossing[]): string[] {
  return crossings.map((crossing) => {
    return crossing.kind;
  });
}

describe("crossings on land a river cuts in two", () => {
  it("join the two sides even where the river is too short to space crossings along", () => {
    const crossings = planCrossings(landCutInTwo(0));

    expect(crossings).toHaveLength(1);
    expect(
      crossings.every((crossing) => {
        return Math.sign(crossing.startX) !== Math.sign(crossing.endX);
      })
    ).toBe(true);
  });

  it("wade a calm stream and lay a fallen log over one that falls steeply", () => {
    expect(kindsOf(planCrossings(landCutInTwo(0)))).toEqual(["ford"]);
    expect(kindsOf(planCrossings(landCutInTwo(STEEP_FALL)))).toEqual(["log"]);
  });

  it("give up a ford once its stream falls steeply", () => {
    const [ford] = planCrossings(landCutInTwo(0));

    if (ford === undefined) {
      throw new Error("Expected a ford across the calm stream");
    }

    expect(refreshCrossings(landCutInTwo(0), [ford])).toEqual([ford]);
    expect(kindsOf(refreshCrossings(landCutInTwo(STEEP_FALL), [ford]))).toEqual(["log"]);
  });
});
