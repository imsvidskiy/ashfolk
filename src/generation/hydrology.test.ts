import { describe, expect, it } from "vitest";
import { landEverywhere, shapeTerrain } from "../world/testing/terrain-fixtures.ts";
import { hasWater, type River, type RiverPoint } from "../world/water.ts";
import { NEIGHBOR_OFFSETS, WorldGrid } from "../world/world-grid.ts";
import { chainFlows, computeHydrology, DEFAULT_HYDROLOGY, NO_CELL } from "./hydrology.ts";

const VALLEY_FLOOR_HALF_WIDTH = 10;
const GENTLE_WALLS = 0.6;
const STEEP_WALLS = 2;
const BANK_FREEBOARD = 0.2;
const DEEPEST_BANK_LOWERING = 10;
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
const BANK_HEIGHT = 1.6;
const LEVEE_CREST = 10;
const LEVEE_RISE = 0.4;
const LEVEE_FALL = 0.25;
const SHELF_HEIGHT = 5;
const SHELF_BASIN_OFFSET = 40;
const SHELF_BASIN_DEPTH = 15;
const SHELF_BASIN_SPREAD = 2 * 16 * 16;
const SIDEHILL_REACH = 250;

interface CarvedWater {
  readonly carved: Float32Array;
  readonly riverStrength: Uint8Array;
  readonly waterSurface: Float32Array;
}

function carveValley(wallSlope: number, ridgeHeight = 0) {
  const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });

  const uncarved = shapeTerrain(grid, (x, z) => {
    return 100 + Math.abs(x) * wallSlope + (z + grid.halfSize) * 0.05 + ridgeHeight * Math.exp(-(z * z) / RIDGE_SPREAD);
  });

  const carved = Float32Array.from(uncarved);
  const options = { ...DEFAULT_HYDROLOGY, riverCatchmentArea: 30_000 };

  const result = computeHydrology(
    carved,
    grid,
    new Float32Array(grid.cellCount),
    landEverywhere(grid.cellCount),
    options
  );

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

function riverEnd(river: River): RiverPoint {
  const end = river.points.at(-1);

  if (end === undefined) {
    throw new Error(`River ${river.id} has no points`);
  }

  return end;
}

function riverLevelBeside(grid: WorldGrid, cell: number, water: CarvedWater): number {
  const { carved, riverStrength, waterSurface } = water;

  let total = 0;
  let count = 0;

  for (const offset of NEIGHBOR_OFFSETS) {
    const column = grid.columnOf(cell) + offset.column;
    const row = grid.rowOf(cell) + offset.row;

    if (!grid.contains(column, row)) {
      continue;
    }

    const neighbor = grid.index(column, row);

    if (!hasWater(waterSurface[neighbor], carved[neighbor])) {
      continue;
    }

    if (riverStrength[neighbor] === 0) {
      return Number.NaN;
    }

    total += waterSurface[neighbor];
    count += 1;
  }

  return count > 0 ? total / count : Number.NaN;
}

describe("river carving", () => {
  it("cuts a channel and lowers the banks beside it to just above the water level there", () => {
    const { carved, grid, result } = carveValley(GENTLE_WALLS);

    const rises: number[] = [];
    let wetFloorCells = 0;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (hasWater(result.waterSurface[cell], carved[cell])) {
        wetFloorCells += Math.abs(grid.cellCenterX(cell)) < VALLEY_FLOOR_HALF_WIDTH ? 1 : 0;

        continue;
      }

      const water = riverLevelBeside(grid, cell, {
        carved,
        riverStrength: result.riverStrength,
        waterSurface: result.waterSurface,
      });

      if (Number.isFinite(water)) {
        rises.push(carved[cell] - water);
      }
    }

    expect(result.features.rivers.length).toBeGreaterThan(0);
    expect(wetFloorCells).toBeGreaterThan(10);
    expect(rises.length).toBeGreaterThan(20);
    expect(Math.max(...rises)).toBeLessThan(BANK_FREEBOARD + 0.01);
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

  it("lowers steep valley walls by at most ten meters and never notches them", () => {
    const { carved, grid, uncarved } = carveValley(STEEP_WALLS);

    let deepestWallCut = 0;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (Math.abs(grid.cellCenterX(cell)) > VALLEY_FLOOR_HALF_WIDTH) {
        deepestWallCut = Math.max(deepestWallCut, uncarved[cell] - carved[cell]);
      }
    }

    const row = grid.rowAt(-150);
    const profile = Array.from({ length: 12 }, (_, step) => {
      return carved[grid.index(grid.columnAt(15 + step * 10), row)];
    });

    expect(deepestWallCut).toBeGreaterThan(5);
    expect(deepestWallCut).toBeLessThanOrEqual(DEEPEST_BANK_LOWERING + 0.01);

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
    const options = { ...DEFAULT_HYDROLOGY, lakeMinimumArea, lakeMinimumCatchmentArea: 0, riverCatchmentArea: 30_000 };

    const result = computeHydrology(
      carved,
      grid,
      new Float32Array(grid.cellCount),
      landEverywhere(grid.cellCount),
      options
    );

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
    expect(Math.max(...outerCuts)).toBeLessThan(1);
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

    const result = computeHydrology(heights, grid, new Float32Array(grid.cellCount), coastDistance, {
      ...DEFAULT_HYDROLOGY,
      riverCatchmentArea: 40_000,
    });

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

    const { rivers } = computeHydrology(
      heights,
      grid,
      new Float32Array(grid.cellCount),
      landEverywhere(grid.cellCount),
      { ...DEFAULT_HYDROLOGY, riverCatchmentArea: 40_000 }
    ).features;

    expect(rivers.length).toBeGreaterThan(0);

    for (const river of rivers) {
      expect(largestDeviation(river.points)).toBeGreaterThan(5);
    }
  });
});

describe("river flow", () => {
  const CELLS = 64;
  const LAKE_CELL = 40;
  const CAPTURED_FLOW = 50;
  const FEEDER_CATCHMENT = 100;

  type Pairs = readonly (readonly [number, number])[];

  const STREAM_LINKS: Pairs = [
    [20, 21],
    [21, 22],
    [30, 31],
    [31, 32],
    [32, 33],
    [10, 11],
    [11, 12],
  ];

  const STREAM_ACCUMULATIONS: Pairs = [
    [20, FEEDER_CATCHMENT],
    [21, FEEDER_CATCHMENT],
    [22, FEEDER_CATCHMENT],
    [30, CAPTURED_FLOW],
    [31, CAPTURED_FLOW],
    [32, CAPTURED_FLOW],
  ];

  function flowNetwork(links: Pairs, accumulations: Pairs) {
    const receivers = new Int32Array(CELLS).fill(NO_CELL);
    const accumulation = new Float32Array(CELLS);

    for (const [cell, receiver] of [...STREAM_LINKS, ...links]) {
      receivers[cell] = receiver;
    }

    for (const [cell, value] of [...STREAM_ACCUMULATIONS, ...accumulations]) {
      accumulation[cell] = value;
    }

    return { accumulation, filled: new Float32Array(CELLS), order: new Int32Array(CELLS), receivers };
  }

  function capturedFeeder(joinsCell: number, mouthReceiver: number) {
    return [
      { cells: [10, 11, 12], joinsCell: NO_CELL, mouthReceiver: NO_CELL },
      { cells: [20, 21, 22], joinsCell, mouthReceiver },
      { cells: [30, 31, 32], joinsCell: 21, mouthReceiver: 21 },
    ];
  }

  it("carries the water of a captured stream on past a natural confluence", () => {
    const network = flowNetwork(
      [[22, 11]],
      [
        [10, 20],
        [11, 125],
        [12, 130],
      ]
    );

    const [trunk, feeder] = chainFlows(network, capturedFeeder(11, 11));
    const feederFlow = FEEDER_CATCHMENT + CAPTURED_FLOW;

    expect(feeder[2]).toBe(feederFlow);
    expect(trunk[1]).toBeGreaterThanOrEqual(feederFlow);
    expect(trunk[2]).toBeGreaterThanOrEqual(feederFlow);
  });

  it("carries the water of a captured stream on through a lake into its outflow", () => {
    const network = flowNetwork(
      [
        [22, LAKE_CELL],
        [LAKE_CELL, 10],
      ],
      [
        [LAKE_CELL, 105],
        [10, 105],
        [11, 125],
        [12, 130],
      ]
    );

    const [trunk, feeder] = chainFlows(network, capturedFeeder(NO_CELL, LAKE_CELL));
    const feederFlow = FEEDER_CATCHMENT + CAPTURED_FLOW;

    expect(feeder[2]).toBe(feederFlow);
    expect(trunk[0]).toBeGreaterThanOrEqual(feederFlow);
    expect(trunk[2]).toBeGreaterThanOrEqual(feederFlow);
  });
});
