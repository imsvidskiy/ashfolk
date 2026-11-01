import { beforeAll, describe, expect, it } from "vitest";
import { lerp, saturate } from "../shared/math.ts";
import { isOnIsland } from "../world/coast.ts";
import { CELL_STAND_INSET } from "../world/footing.ts";
import { sampleHeight } from "../world/terrain-sampling.ts";
import { landEverywhere, shapeTerrain } from "../world/testing/terrain-fixtures.ts";
import {
  DRAWN_RIVER_EDGE_WOBBLE,
  drawnRiverHalfWidth,
  hasWater,
  type Lake,
  NO_WATER,
  type River,
  type RiverPoint,
} from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { DEFAULT_HYDROLOGY, type HydrologyOptions, NO_CELL } from "./drainage.ts";
import { computeHydrology } from "./hydrology.ts";
import { pondShoreReach } from "./ponds.ts";
import { coarseWorld, FULL_SIZE_TIMEOUT, fullSizeWorld } from "./testing/generated-worlds.ts";
import { mouthFaults, riverEnd, riverFaults } from "./testing/water-checks.ts";
import type { GeneratedWorld } from "./world-generator.ts";

const VALLEY_FLOOR_HALF_WIDTH = 10;
const GENTLE_WALLS = 0.6;
const STEEP_WALLS = 2;
const BANK_FREEBOARD = 0.2;
const DRAWN_EDGE_CELLS = 1;
const STANDING_SAMPLES = 5;
const DROP_WITHIN_CELL = 0.35;
const ALONG_SLOPE = 0.05;
const DEEPEST_BANK_LOWERING = 10;
const DEEPEST_POND_SHORE_CUT = 12;
const UNTOUCHED_DISTANCE = 120;
const RIDGE_HEIGHT = 10;
const RIDGE_SPREAD = 2 * 30 * 30;
const GULLY_OFFSET = 80;
const GULLY_DEPTH = 4;
const GULLY_SPREAD = 2 * 15 * 15;
const PLANE_ASPECT = (25 * Math.PI) / 180;
const DIVIDING_RIDGE = 20;
const INLET_HALF_WIDTH = 20;
const INLET_REACH = 100;
const PARALLEL_REACH = 180;
const SMOOTHED_SPLITS = 4;
const STEP_TOLERANCE = 0.01;
const JOIN_TOLERANCE = 0.01;
const BANK_HEIGHT = 1.6;
const LEVEE_CREST = 10;
const LEVEE_RISE = 0.4;
const LEVEE_FALL = 0.25;
const OUTER_BANK_CUT = 1.25;
const SHELF_HEIGHT = 5;
const SHELF_BASIN_OFFSET = 40;
const SHELF_BASIN_DEPTH = 15;
const SHELF_BASIN_SPREAD = 2 * 16 * 16;
const SIDEHILL_REACH = 250;
const SURE_WET_REACH = 7.5;
const WIDEST_SIDE_CUT = 40;
const MINIMUM_BANK_WIDTH = 6;
const STREAM_WALLS = 0.6;
const STREAM_GULLY_DEPTH = 12;
const STREAM_GULLY_SPREAD = 2 * 30 * 30;
const DEEPENING_TOLERANCE = 1;
const RIVER_SAMPLE_STEP = 5;
const STRAIGHT_RUN = 150;
const STRAIGHT_DEVIATION = 3;
const OUTLET_REACH_PER_CELL = 12;
const OUTLET_LEVEL_SLACK = 1.5;
const RIVER_COUNT_SLACK = 1;

interface RiverSpot {
  readonly distance: number;
  readonly point: RiverPoint;
}

function hydrologyOf(
  grid: WorldGrid,
  heights: Float32Array,
  options: Partial<HydrologyOptions>,
  coastDistance = landEverywhere(grid.cellCount)
) {
  return computeHydrology(heights, grid, new Float32Array(grid.cellCount), coastDistance, {
    ...DEFAULT_HYDROLOGY,
    ...options,
  });
}

function carveValley(wallSlope: number, ridgeHeight = 0) {
  const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });

  const uncarved = shapeTerrain(grid, (x, z) => {
    return (
      100 +
      Math.abs(x) * wallSlope +
      (z + grid.halfSize) * ALONG_SLOPE +
      ridgeHeight * Math.exp(-(z * z) / RIDGE_SPREAD)
    );
  });

  const carved = Float32Array.from(uncarved);
  const result = hydrologyOf(grid, carved, { riverCatchmentArea: 30_000 });

  return { carved, grid, result, uncarved };
}

function largestDeviation(points: readonly { x: number; z: number }[]): number {
  const [start] = points;
  const end = points.at(-1);

  if (start === undefined || end === undefined) {
    return 0;
  }

  const chordX = end.x - start.x;
  const chordZ = end.z - start.z;
  const chord = Math.max(1e-6, Math.hypot(chordX, chordZ));

  return Math.max(
    ...points.map((point) => {
      return Math.abs((point.x - start.x) * chordZ - (point.z - start.z) * chordX) / chord;
    })
  );
}

function nearestOnRiver(river: River, x: number, z: number): RiverSpot {
  let nearest: RiverSpot = { distance: Number.POSITIVE_INFINITY, point: river.points[0] };

  for (let index = 1; index < river.points.length; index += 1) {
    const start = river.points[index - 1];
    const end = river.points[index];
    const alongX = end.x - start.x;
    const alongZ = end.z - start.z;
    const lengthSquared = alongX * alongX + alongZ * alongZ;
    const share = lengthSquared === 0 ? 0 : saturate(((x - start.x) * alongX + (z - start.z) * alongZ) / lengthSquared);
    const point = {
      depth: lerp(start.depth, end.depth, share),
      flow: start.flow,
      surface: lerp(start.surface, end.surface, share),
      width: lerp(start.width, end.width, share),
      x: start.x + alongX * share,
      z: start.z + alongZ * share,
    };
    const distance = Math.hypot(point.x - x, point.z - z);

    if (distance < nearest.distance) {
      nearest = { distance, point };
    }
  }

  return nearest;
}

function channelReachOf(point: RiverPoint): number {
  return Math.max(point.width / 2 + Math.max(MINIMUM_BANK_WIDTH, point.width), SURE_WET_REACH);
}

function resampledRiver(river: River): { x: number; z: number }[] {
  const samples = river.points.slice(0, 1).map((point) => {
    return { x: point.x, z: point.z };
  });

  let carried = 0;

  for (let index = 1; index < river.points.length; index += 1) {
    const start = river.points[index - 1];
    const end = river.points[index];
    const length = Math.hypot(end.x - start.x, end.z - start.z);

    let along = RIVER_SAMPLE_STEP - carried;

    for (; along <= length; along += RIVER_SAMPLE_STEP) {
      samples.push({
        x: start.x + ((end.x - start.x) * along) / length,
        z: start.z + ((end.z - start.z) * along) / length,
      });
    }

    carried = length - (along - RIVER_SAMPLE_STEP);
  }

  return samples;
}

function straightSamples(samples: readonly { x: number; z: number }[]): number {
  const window = Math.round(STRAIGHT_RUN / RIVER_SAMPLE_STEP);
  const isStraight = new Uint8Array(samples.length);

  for (let first = 0; first + window < samples.length; first += 1) {
    const start = samples[first];
    const end = samples[first + window];
    const chordX = end.x - start.x;
    const chordZ = end.z - start.z;
    const chord = Math.hypot(chordX, chordZ);

    const deviations = samples.slice(first, first + window + 1).map((sample) => {
      return Math.abs((sample.x - start.x) * chordZ - (sample.z - start.z) * chordX) / chord;
    });

    if (Math.max(...deviations) < STRAIGHT_DEVIATION) {
      isStraight.fill(1, first, first + window + 1);
    }
  }

  return isStraight.reduce((total, flag) => {
    return total + flag;
  }, 0);
}

function straightRiverShare(generated: GeneratedWorld): number {
  const rivers = generated.water.rivers.map(resampledRiver);

  const total = rivers.reduce((sum, samples) => {
    return sum + samples.length;
  }, 0);
  const straight = rivers.reduce((sum, samples) => {
    return sum + straightSamples(samples);
  }, 0);

  return straight / total;
}

function distanceToWaterfall(generated: GeneratedWorld, grid: WorldGrid, cell: number): number {
  const x = grid.cellCenterX(cell);
  const z = grid.cellCenterZ(cell);

  return Math.min(
    ...generated.water.waterfalls.map((waterfall) => {
      return Math.hypot(waterfall.x - x, waterfall.z - z);
    })
  );
}

function isUnderDrawnRiver(grid: WorldGrid, rivers: readonly River[], cell: number): boolean {
  const reach = grid.cellSize / 2 - CELL_STAND_INSET;

  return Array.from({ length: STANDING_SAMPLES * STANDING_SAMPLES }, (_, sample) => {
    const x = grid.cellCenterX(cell) + reach * ((2 * (sample % STANDING_SAMPLES)) / (STANDING_SAMPLES - 1) - 1);
    const z =
      grid.cellCenterZ(cell) + reach * ((2 * Math.floor(sample / STANDING_SAMPLES)) / (STANDING_SAMPLES - 1) - 1);

    return rivers.some((river) => {
      const spot = nearestOnRiver(river, x, z);

      return spot.distance < drawnRiverHalfWidth(spot.point.width / 2) + DRAWN_RIVER_EDGE_WOBBLE;
    });
  }).some(Boolean);
}

function leavesLake(lake: Lake, point: RiverPoint): boolean {
  const reach = Math.sqrt(lake.cellCount) * OUTLET_REACH_PER_CELL;

  return (
    Math.hypot(point.x - lake.centerX, point.z - lake.centerZ) < reach &&
    Math.abs(point.surface - lake.level) < OUTLET_LEVEL_SLACK
  );
}

describe("river carving", () => {
  it("cuts a channel and keeps the land under and just past the drawn edge at the water level there", () => {
    const { carved, grid, result } = carveValley(GENTLE_WALLS);
    const { rivers } = result.features;

    const rises: number[] = [];
    let wetFloorCells = 0;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (hasWater(result.waterSurface[cell], carved[cell])) {
        wetFloorCells += Math.abs(grid.cellCenterX(cell)) < VALLEY_FLOOR_HALF_WIDTH ? 1 : 0;

        continue;
      }

      for (const river of rivers) {
        const spot = nearestOnRiver(river, grid.cellCenterX(cell), grid.cellCenterZ(cell));

        if (spot.distance <= drawnRiverHalfWidth(spot.point.width / 2) + grid.cellSize * DRAWN_EDGE_CELLS) {
          rises.push(carved[cell] - spot.point.surface);
        }
      }
    }

    expect(rivers.length).toBeGreaterThan(0);
    expect(wetFloorCells).toBeGreaterThan(10);
    expect(rises.length).toBeGreaterThan(20);
    expect(Math.min(...rises)).toBeGreaterThan(0);
    expect(Math.max(...rises)).toBeLessThan(BANK_FREEBOARD + DROP_WITHIN_CELL);
  });

  it("keeps the ground people stand on in every dry cell clear of the drawn river", () => {
    for (const wallSlope of [GENTLE_WALLS, STEEP_WALLS]) {
      const { carved, grid, result } = carveValley(wallSlope);

      const crowded = Array.from({ length: grid.cellCount }, (_, cell) => {
        return cell;
      }).filter((cell) => {
        return (
          !hasWater(result.waterSurface[cell], carved[cell]) && isUnderDrawnRiver(grid, result.features.rivers, cell)
        );
      });

      expect(crowded).toEqual([]);
    }
  });

  it("rises steadily from the river to the untouched valley walls", () => {
    const { carved, grid, uncarved } = carveValley(GENTLE_WALLS);

    const row = grid.rowAt(-150);
    const profile = Array.from({ length: 12 }, (_, step) => {
      return carved[grid.index(grid.columnAt(5 + step * 10), row)];
    });

    for (let step = 1; step < profile.length; step += 1) {
      expect(profile[step]).toBeGreaterThanOrEqual(profile[step - 1]);
    }

    const untouched = Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return Math.abs(grid.cellCenterX(cell)) > UNTOUCHED_DISTANCE;
    });

    for (const cell of untouched) {
      expect(carved[cell]).toBe(uncarved[cell]);
    }
  });

  it("lowers dry valley walls by at most ten meters beside the river and twelve at a pond, and never notches them", () => {
    const { carved, grid, result, uncarved } = carveValley(STEEP_WALLS);

    let deepestWallCut = 0;
    let deepestShoreCut = 0;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (hasWater(result.waterSurface[cell], carved[cell])) {
        continue;
      }

      const isPondShore = result.features.springs.some((spring) => {
        return (
          spring.kind === "pond" &&
          Math.hypot(grid.cellCenterX(cell) - spring.x, grid.cellCenterZ(cell) - spring.z) < pondShoreReach(spring)
        );
      });

      if (isPondShore) {
        deepestShoreCut = Math.max(deepestShoreCut, uncarved[cell] - carved[cell]);
      } else if (Math.abs(grid.cellCenterX(cell)) > VALLEY_FLOOR_HALF_WIDTH) {
        deepestWallCut = Math.max(deepestWallCut, uncarved[cell] - carved[cell]);
      }
    }

    const row = grid.rowAt(-150);
    const profile = Array.from({ length: 12 }, (_, step) => {
      return carved[grid.index(grid.columnAt(15 + step * 10), row)];
    });

    expect(deepestWallCut).toBeGreaterThan(5);
    expect(deepestWallCut).toBeLessThanOrEqual(DEEPEST_BANK_LOWERING + 0.01);
    expect(deepestShoreCut).toBeGreaterThan(0);
    expect(deepestShoreCut).toBeLessThanOrEqual(DEEPEST_POND_SHORE_CUT + 0.01);

    for (let step = 1; step < profile.length; step += 1) {
      expect(profile[step] - profile[step - 1]).toBeGreaterThan(0);
      expect(profile[step] - profile[step - 1]).toBeLessThan(STEEP_WALLS * 10 + 5);
    }
  });

  it("cuts a gorge through a ridge across the valley instead of lifting the water over it", () => {
    const { carved, grid, result, uncarved } = carveValley(GENTLE_WALLS, RIDGE_HEIGHT);

    const crossing = result.features.rivers
      .flatMap((river) => {
        return river.points;
      })
      .find((point) => {
        return Math.abs(point.z) < 5;
      });

    expect(crossing).toBeDefined();

    if (crossing === undefined) {
      return;
    }

    const crest = grid.cellAt(crossing.x, crossing.z);
    const wall = grid.cellAt(crossing.x + 25, crossing.z);

    expect(uncarved[crest] - result.waterSurface[crest]).toBeGreaterThan(RIDGE_HEIGHT * 0.5);
    expect(carved[crest]).toBeLessThan(result.waterSurface[crest]);
    expect(carved[wall] - result.waterSurface[crest]).toBeGreaterThan(5);

    for (const river of result.features.rivers) {
      const levels = river.points.map((point) => {
        return result.waterSurface[grid.cellAt(point.x, point.z)];
      });

      for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index]).toBeLessThanOrEqual(levels[index - 1] + 1e-3);
      }
    }
  });
});

describe("river confluences", () => {
  function joinSteepStream() {
    const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 96 });

    const carved = shapeTerrain(grid, (x, z) => {
      const gully = x > 0 ? STREAM_GULLY_DEPTH * Math.exp(-(z * z) / STREAM_GULLY_SPREAD) * saturate((x - 20) / 40) : 0;

      return 100 + 0.05 * (z + grid.halfSize) + STREAM_WALLS * Math.abs(x) - gully;
    });

    const result = hydrologyOf(grid, carved, { riverCatchmentArea: 20_000 });

    return { carved, grid, result };
  }

  function wetCells(grid: WorldGrid, carved: Float32Array, waterSurface: Float32Array): number[] {
    return Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return hasWater(waterSurface[cell], carved[cell]);
    });
  }

  it("keeps the water where a stream runs into a river at the lower of the two surfaces", () => {
    const { carved, grid, result } = joinSteepStream();
    const { rivers } = result.features;

    let sharedCells = 0;

    for (const cell of wetCells(grid, carved, result.waterSurface)) {
      if (result.riverStrength[cell] === 0) {
        continue;
      }

      const spots = rivers
        .map((river) => {
          return nearestOnRiver(river, grid.cellCenterX(cell), grid.cellCenterZ(cell));
        })
        .filter((spot) => {
          return spot.distance <= SURE_WET_REACH;
        });

      sharedCells += spots.length > 1 ? 1 : 0;

      for (const spot of spots) {
        expect(result.waterSurface[cell]).toBeLessThanOrEqual(spot.point.surface + STEP_TOLERANCE);
      }
    }

    expect(rivers.length).toBeGreaterThan(1);
    expect(sharedCells).toBeGreaterThan(0);
  });

  it("leaves the bed of a stream in the side cut of the river it joins as the stream carved it", () => {
    const { carved, grid, result } = joinSteepStream();
    const [river, stream] = result.features.rivers;

    expect(river?.reachesEdge).toBe(true);
    expect(stream?.reachesEdge).toBe(false);

    if (river === undefined || stream === undefined) {
      return;
    }

    let besideRiver = 0;

    for (const cell of wetCells(grid, carved, result.waterSurface)) {
      const x = grid.cellCenterX(cell);
      const z = grid.cellCenterZ(cell);
      const own = nearestOnRiver(stream, x, z);
      const other = nearestOnRiver(river, x, z);

      if (own.distance > SURE_WET_REACH || other.distance <= channelReachOf(other.point)) {
        continue;
      }

      besideRiver += other.distance <= other.point.width / 2 + WIDEST_SIDE_CUT ? 1 : 0;

      expect(result.waterSurface[cell] - carved[cell]).toBeLessThan(own.point.depth + DEEPENING_TOLERANCE);
    }

    expect(besideRiver).toBeGreaterThan(0);
  });
});

describe("river sidehills", () => {
  function carveSidehill(
    heightAt: (x: number, z: number) => number,
    lakeMinimumArea = DEFAULT_HYDROLOGY.lakeMinimumArea
  ) {
    const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });

    const uncarved = shapeTerrain(grid, (x, z) => {
      return 100 + (z + grid.halfSize) * 0.05 + heightAt(x, z);
    });

    const carved = Float32Array.from(uncarved);
    const result = hydrologyOf(grid, carved, {
      lakeMinimumArea,
      lakeMinimumCatchmentArea: 0,
      riverCatchmentArea: 30_000,
    });

    const points = result.features.rivers.flatMap((river) => {
      return river.points;
    });

    return { carved, grid, points, result, uncarved };
  }

  it("keeps a river under a steep wall up at an outer bank that falls away gently", () => {
    const { carved, grid, points, uncarved } = carveSidehill((x) => {
      if (x < 0) {
        return -STEEP_WALLS * x;
      }

      return x < LEVEE_CREST ? LEVEE_RISE * x : LEVEE_RISE * LEVEE_CREST - LEVEE_FALL * (x - LEVEE_CREST);
    });

    const inside = points.filter((point) => {
      return Math.abs(point.z) < SIDEHILL_REACH;
    });

    expect(inside.length).toBeGreaterThan(20);

    for (const point of inside) {
      expect(uncarved[grid.cellAt(point.x + grid.cellSize, point.z)] - point.surface).toBeLessThan(2 * BANK_HEIGHT);
    }

    const outerCuts = Array.from(uncarved, (height, cell) => {
      return height - carved[cell];
    }).filter((_, cell) => {
      const x = grid.cellCenterX(cell);

      return x > 2 * LEVEE_CREST && x < 6 * LEVEE_CREST && Math.abs(grid.cellCenterZ(cell)) < SIDEHILL_REACH;
    });

    expect(outerCuts.length).toBeGreaterThan(20);
    expect(Math.max(...outerCuts)).toBeLessThan(OUTER_BANK_CUT);
  });

  it("doesn't sink a river toward the bed of a lake beside it", () => {
    const { grid, points, result, uncarved } = carveSidehill((x, z) => {
      const basin = Math.exp(-((x - SHELF_BASIN_OFFSET) ** 2 + z * z) / SHELF_BASIN_SPREAD);

      return (x < 0 ? -x : Math.min(LEVEE_RISE * x, SHELF_HEIGHT)) - SHELF_BASIN_DEPTH * basin;
    }, 500);

    const besideLake = points.filter((point) => {
      return [2, 3].some((cells) => {
        return result.lakeIds[grid.cellAt(point.x + cells * grid.cellSize, point.z)] !== NO_CELL;
      });
    });

    expect(result.features.lakes.length).toBeGreaterThan(0);
    expect(besideLake.length).toBeGreaterThan(3);

    for (const point of besideLake) {
      expect(uncarved[grid.cellAt(point.x, point.z)] - point.surface).toBeLessThan(1);
    }
  });
});

describe("river network", () => {
  interface Divide {
    readonly inlet?: boolean;
    readonly ridgeHeight?: number;
  }

  function drainFlank({ inlet = false, ridgeHeight = 0 }: Divide = {}) {
    const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 96 });

    const heights = shapeTerrain(grid, (x, z) => {
      const gullies =
        Math.exp(-((x - GULLY_OFFSET) ** 2) / GULLY_SPREAD) + 0.8 * Math.exp(-((x + GULLY_OFFSET) ** 2) / GULLY_SPREAD);

      return 100 + 0.3 * (z + grid.halfSize) - GULLY_DEPTH * gullies + ridgeHeight * Math.exp(-(x * x) / RIDGE_SPREAD);
    });

    const coastDistance = landEverywhere(grid.cellCount);

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (inlet && Math.abs(grid.cellCenterX(cell)) < INLET_HALF_WIDTH && grid.cellCenterZ(cell) < INLET_REACH) {
        coastDistance[cell] = -1;
      }
    }

    const result = hydrologyOf(grid, heights, { riverCatchmentArea: 40_000 }, coastDistance);

    return { grid, rivers: result.features.rivers };
  }

  it("joins a stream running beside a larger one into it instead of keeping two parallel rivers", () => {
    const { rivers } = drainFlank();

    expect(rivers.length).toBeGreaterThan(1);
    expect(
      rivers.filter((river) => {
        return river.reachesEdge;
      })
    ).toHaveLength(1);
  });

  it("ends every joined stream on another river through a path without gaps", () => {
    const { grid, rivers } = drainFlank();

    const joined = rivers.filter((river) => {
      return !river.reachesEdge;
    });

    expect(joined.length).toBeGreaterThan(0);

    for (const river of joined) {
      const end = riverEnd(river);
      const others = rivers
        .filter((other) => {
          return other !== river;
        })
        .flatMap((other) => {
          return other.points;
        });

      expect(
        Math.min(
          ...others.map((point) => {
            return Math.hypot(point.x - end.x, point.z - end.z);
          })
        )
      ).toBeLessThanOrEqual(grid.cellSize * Math.SQRT2);

      const junction = rivers
        .filter((other) => {
          return other !== river;
        })
        .map((other) => {
          return nearestOnRiver(other, end.x, end.z);
        })
        .reduce((nearest, spot) => {
          return spot.distance < nearest.distance ? spot : nearest;
        });

      expect(junction.distance).toBeLessThan(JOIN_TOLERANCE);
      expect(end.surface).toBeCloseTo(junction.point.surface, 4);

      for (let index = 1; index < river.points.length; index += 1) {
        const step = Math.hypot(
          river.points[index].x - river.points[index - 1].x,
          river.points[index].z - river.points[index - 1].z
        );

        expect(step).toBeLessThan((grid.cellSize * Math.SQRT2) / SMOOTHED_SPLITS + STEP_TOLERANCE);
      }
    }
  });

  it.each([
    ["a ridge", { ridgeHeight: DIVIDING_RIDGE }],
    ["an inlet of the sea", { inlet: true }],
  ])("keeps a stream from joining a river across %s between them", (_, divide) => {
    const { rivers } = drainFlank(divide);

    const edgeRivers = rivers.filter((river) => {
      return river.reachesEdge;
    });

    expect(
      edgeRivers.some((river) => {
        return river.points[0].x > 0;
      })
    ).toBe(true);
    expect(
      edgeRivers.some((river) => {
        return river.points[0].x < 0;
      })
    ).toBe(true);

    for (const river of rivers.filter((joined) => {
      return !joined.reachesEdge;
    })) {
      expect(Math.sign(riverEnd(river).x)).toBe(Math.sign(river.points[0].x));
    }
  });

  it("drops a stream that runs beside a river it can't join", () => {
    const { rivers } = drainFlank({ ridgeHeight: DIVIDING_RIDGE });

    const mouths = rivers
      .filter((river) => {
        return river.reachesEdge;
      })
      .map((river) => {
        return riverEnd(river).x;
      });

    for (const [index, mouth] of mouths.entries()) {
      for (const other of mouths.slice(index + 1)) {
        expect(Math.abs(mouth - other)).toBeGreaterThan(PARALLEL_REACH);
      }
    }
  });

  it("gathers the water of an even slope into streams that bend off the grid lines", () => {
    const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 96 });

    const heights = shapeTerrain(grid, (x, z) => {
      return 300 + 0.3 * (z * Math.cos(PLANE_ASPECT) + x * Math.sin(PLANE_ASPECT));
    });

    const { rivers } = hydrologyOf(grid, heights, { riverCatchmentArea: 40_000 }).features;

    expect(rivers.length).toBeGreaterThan(0);

    for (const river of rivers) {
      expect(largestDeviation(river.points)).toBeGreaterThan(5);
    }
  });
});

describe("rivers of coarse islands", () => {
  let world: GeneratedWorld;
  let squareWorld: GeneratedWorld;

  beforeAll(() => {
    world = coarseWorld(7);
    squareWorld = coarseWorld(7, "square");
  });

  it("traces rivers that flow downhill", () => {
    expect(world.water.rivers.length).toBeGreaterThan(0);

    for (const river of world.water.rivers) {
      const surfaces = river.points.map((point) => {
        return point.surface;
      });

      for (let pointIndex = 1; pointIndex < surfaces.length; pointIndex += 1) {
        expect(surfaces[pointIndex]).toBeLessThanOrEqual(surfaces[pointIndex - 1] + 1e-3);
      }
    }
  });

  it("lets rivers leave the island as waterfalls", () => {
    const edgeRivers = world.water.rivers.filter((river) => {
      return river.reachesEdge;
    });

    expect(world.water.waterfalls).toHaveLength(edgeRivers.length);

    for (const waterfall of world.water.waterfalls) {
      expect(Math.hypot(waterfall.directionX, waterfall.directionZ)).toBeCloseTo(1);
    }
  });

  it("runs the rivers that leave the island past the coast to the top of their waterfalls", () => {
    for (const generated of [world, squareWorld, coarseWorld(11), coarseWorld(11, "square")]) {
      expect(generated.water.waterfalls.length).toBeGreaterThan(0);
      expect(mouthFaults(generated)).toEqual([]);
    }
  });

  it("points every waterfall out of the island, the way its river leaves", () => {
    for (const generated of [world, squareWorld]) {
      const grid = new WorldGrid(generated.dimensions);

      for (const { directionX, directionZ, x, z } of generated.water.waterfalls) {
        const upstream = sampleHeight(generated.terrain.coastDistance, grid, x - directionX * 30, z - directionZ * 30);

        expect(upstream).toBeGreaterThan(sampleHeight(generated.terrain.coastDistance, grid, x, z));
      }
    }
  });

  it("puts water beyond the coast only where a waterfall pours off", () => {
    const grid = new WorldGrid(world.dimensions);

    const fallingWater = Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return !isOnIsland(world.terrain.coastDistance, cell) && world.terrain.waterSurface[cell] !== NO_WATER;
    });

    for (const cell of fallingWater) {
      expect(distanceToWaterfall(world, grid, cell)).toBeLessThan(grid.cellSize * 2);
    }
  });
});

describe("rivers of full-size islands", () => {
  const pinnedRiverCounts = new Map([
    [7, 23],
    [10, 29],
  ]);

  let round: GeneratedWorld;
  let square: GeneratedWorld;
  let pinned: (readonly [GeneratedWorld, number])[];

  beforeAll(() => {
    round = fullSizeWorld(7);
    square = fullSizeWorld(1, "square");
    pinned = [...pinnedRiverCounts].map(([seed, count]) => {
      return [fullSizeWorld(seed), count] as const;
    });
  }, FULL_SIZE_TIMEOUT);

  it("keeps full-size rivers falling all the way to the coast and their waterfalls on both shapes", () => {
    for (const generated of [round, square]) {
      expect(riverFaults(generated)).toEqual([]);
      expect(mouthFaults(generated)).toEqual([]);
    }
  });

  it("bends full-size rivers instead of running them dead straight down even slopes on both shapes", () => {
    for (const generated of [round, square]) {
      expect(straightRiverShare(generated)).toBeLessThan(0.05);
    }
  });

  it("keeps close to the pinned river counts on seeds 7 and 10", () => {
    for (const [generated, count] of pinned) {
      expect(Math.abs(generated.water.rivers.length - count)).toBeLessThanOrEqual(RIVER_COUNT_SLACK);
    }
  });

  it("sends a river out of every lake on seeds 7 and 10", () => {
    for (const [generated] of pinned) {
      const closed = generated.water.lakes.filter((lake) => {
        return !generated.water.rivers.some((river) => {
          return leavesLake(lake, river.points[0]);
        });
      });

      expect(closed).toEqual([]);
    }
  });
});
