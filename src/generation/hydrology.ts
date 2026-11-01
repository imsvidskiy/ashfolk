import { smoothstep } from "../shared/math.ts";
import { isOnIsland } from "../world/coast.ts";
import {
  type Lake,
  type River,
  type RiverPoint,
  riverWidthOfStrength,
  type WaterFeatures,
  type Waterfall,
} from "../world/water.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../world/world-grid.ts";
import { analyzeDrainage, channelGround, DEFAULT_HYDROLOGY, type HydrologyOptions, NO_CELL } from "./drainage.ts";
import { BANK_FREEBOARD, bankWidthOf, type ChannelTargets, carveWaterways } from "./river-carving.ts";
import { chainCells, chainFlows, type RiverChain, riverStrengthFor, traceRiverChains } from "./river-chains.ts";
import {
  acrossAt,
  makeSurfaceDescend,
  nearestAlong,
  pointAlong,
  relaxRiverSurfaces,
  riverCourse,
  smoothRiverPath,
  smoothRiverSurfaces,
  surfaceAlong,
} from "./river-paths.ts";
import { type RiverLand, spaceRiverChains } from "./river-spacing.ts";
import { placeSprings } from "./springs.ts";

const MINIMUM_POINT_DROP = 0.04;
const SLOPE_LOOKAROUND = 2;
const BANK_SAMPLES = 3;
const OUTER_BANK_SLOPE = 0.3;
const FLAT_CROSS_SLOPE = 0.04;
const STEEP_CROSS_SLOPE = 0.12;
const FLOW_REACH = 15;
const PATH_SPACING = 2.5;
const PATH_SPREAD = 8;
const SURFACE_SPREAD = 20;
const MEANDER_SIDE_REACH = 15;
const ROOMY_SIDE_RISE = 0.15;
const CRAMPED_SIDE_RISE = 0.45;
const RELAXING_PASSES = 16;
const SMOOTHED_POINT_DROP = 0.01;
const ACROSS_REACH = 4;

interface HydrologyResult {
  carving: Float32Array;
  features: WaterFeatures;
  lakeIds: Int32Array;
  riverStrength: Uint8Array;
  waterSurface: Float32Array;
}

interface Banks {
  readonly left: number;
  readonly right: number;
}

interface Junction {
  readonly surface: number;
  readonly x: number;
  readonly z: number;
}

interface NeighborCell {
  readonly cell: number;
  readonly outwardX: number;
  readonly outwardZ: number;
}

function riverPointFor(land: RiverLand, cell: number, flow: number): RiverPoint {
  const { basins, grid, heights } = land;

  const threshold = basins.riverThreshold;
  const strength = riverStrengthFor(flow, threshold);

  return {
    depth: Math.min(0.8 + 0.42 * strength, 3.2),
    flow,
    surface: channelGround(heights, basins.network, cell) - 0.3,
    width: riverWidthOfStrength(strength),
    x: grid.cellCenterX(cell),
    z: grid.cellCenterZ(cell),
  };
}

function bankGroundAt(land: RiverLand, x: number, z: number): number {
  const { basins, coastDistance, grid, heights } = land;

  const cell = grid.cellAt(x, z);

  if (!isOnIsland(coastDistance, cell) || basins.lakeIds[cell] !== NO_CELL) {
    return Number.NaN;
  }

  return heights[cell];
}

function lowestBankGround(land: RiverLand, point: RiverPoint, acrossX: number, acrossZ: number): number {
  const nearest = point.width / 2 + bankWidthOf(point);
  let lowest = Number.POSITIVE_INFINITY;

  for (let step = 0; step < BANK_SAMPLES; step += 1) {
    const reach = nearest + step * land.grid.cellSize;
    const ground = bankGroundAt(land, point.x + acrossX * reach, point.z + acrossZ * reach);

    if (Number.isNaN(ground)) {
      return Number.NaN;
    }

    lowest = Math.min(lowest, ground + step * land.grid.cellSize * OUTER_BANK_SLOPE);
  }

  return lowest;
}

function banksAcross(land: RiverLand, points: readonly RiverPoint[], index: number, reach: number): Banks {
  const point = points[index];
  const across = acrossAt(points, index, reach);

  return {
    left: lowestBankGround(land, point, across.x, across.z),
    right: lowestBankGround(land, point, -across.x, -across.z),
  };
}

function sinkIntoSlopes(land: RiverLand, points: RiverPoint[]): void {
  for (const [index, point] of points.entries()) {
    const { left, right } = banksAcross(land, points, index, SLOPE_LOOKAROUND);

    if (Number.isNaN(left) || Number.isNaN(right)) {
      continue;
    }

    const span = 2 * (point.width / 2 + bankWidthOf(point) + land.grid.cellSize);
    const sinking = smoothstep(FLAT_CROSS_SLOPE, STEEP_CROSS_SLOPE, Math.abs(left - right) / span);
    const lowestBank = Math.min(left, right) - BANK_FREEBOARD;

    if (lowestBank < point.surface) {
      point.surface -= sinking * (point.surface - lowestBank);
    }
  }
}

function settleIntoMainRiver(points: RiverPoint[], mainSurface: number | undefined): void {
  const last = points.at(-1);

  if (mainSurface === undefined || last === undefined) {
    return;
  }

  for (const point of points) {
    point.surface = Math.max(point.surface, mainSurface);
  }

  last.surface = mainSurface;
}

function junctionOn(river: River, x: number, z: number): Junction {
  const course = riverCourse(river);
  const { along } = nearestAlong(course, { x, z });

  return { ...pointAlong(course, along), surface: surfaceAlong(course, along) };
}

function capSurfaces(land: RiverLand, points: RiverPoint[], raw: Float64Array): void {
  for (const [index, point] of points.entries()) {
    const { left, right } = banksAcross(land, points, index, ACROSS_REACH);

    const lowestBank = Math.min(left, right);
    const cap = Number.isNaN(lowestBank) ? raw[index] : Math.max(raw[index], lowestBank - BANK_FREEBOARD);

    point.surface = Math.min(point.surface, cap);
  }
}

function meanderRoom(land: RiverLand, point: RiverPoint, acrossX: number, acrossZ: number): number {
  const ground = bankGroundAt(land, point.x, point.z);
  const rise = Math.max(
    ...[1, -1].map((side) => {
      const bank = bankGroundAt(
        land,
        point.x + acrossX * side * MEANDER_SIDE_REACH,
        point.z + acrossZ * side * MEANDER_SIDE_REACH
      );

      return Number.isNaN(bank) || Number.isNaN(ground) ? 0 : (bank - ground) / MEANDER_SIDE_REACH;
    })
  );

  return 1 - smoothstep(ROOMY_SIDE_RISE, CRAMPED_SIDE_RISE, rise);
}

function shapeRiver(
  land: RiverLand,
  points: readonly RiverPoint[],
  seed: number,
  endSurface: number | undefined
): RiverPoint[] {
  const shaped = smoothRiverPath(points, {
    meanderRoom: (point, acrossX, acrossZ) => {
      return meanderRoom(land, point, acrossX, acrossZ);
    },
    pathSpread: PATH_SPREAD,
    seed,
    spacing: PATH_SPACING,
  });
  const raw = Float64Array.from(shaped, (point) => {
    return point.surface;
  });

  smoothRiverSurfaces(shaped, SURFACE_SPREAD, PATH_SPACING);
  capSurfaces(land, shaped, raw);
  relaxRiverSurfaces(shaped, RELAXING_PASSES);
  makeSurfaceDescend(shaped, SMOOTHED_POINT_DROP);
  settleIntoMainRiver(shaped, endSurface);

  return shaped;
}

function offIslandNeighbors(grid: WorldGrid, coastDistance: Float32Array, cell: number): NeighborCell[] {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const neighbors: NeighborCell[] = [];

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighbor = grid.neighborIndex(column, row, offset);

    if (neighbor < 0) {
      continue;
    }

    if (!isOnIsland(coastDistance, neighbor)) {
      neighbors.push({
        cell: neighbor,
        outwardX: offset.column / offset.distance,
        outwardZ: offset.row / offset.distance,
      });
    }
  }

  return neighbors;
}

function cellPastCoast(land: RiverLand, mouthCell: number, claimed: ReadonlySet<number>): number {
  const neighbors = offIslandNeighbors(land.grid, land.coastDistance, mouthCell);

  const outwardX = neighbors.reduce((total, neighbor) => {
    return total + neighbor.outwardX;
  }, 0);
  const outwardZ = neighbors.reduce((total, neighbor) => {
    return total + neighbor.outwardZ;
  }, 0);

  let best = NO_CELL;
  let bestFacing = Number.NEGATIVE_INFINITY;

  for (const neighbor of neighbors) {
    const facing = neighbor.outwardX * outwardX + neighbor.outwardZ * outwardZ;

    if (facing > bestFacing && !claimed.has(neighbor.cell)) {
      best = neighbor.cell;
      bestFacing = facing;
    }
  }

  return best;
}

function runPastCoast(land: RiverLand, points: RiverPoint[], claimed: Set<number>): void {
  const { grid } = land;

  const mouth = points.at(-1);

  if (mouth === undefined) {
    return;
  }

  const cell = cellPastCoast(land, grid.cellAt(mouth.x, mouth.z), claimed);

  if (cell === NO_CELL) {
    return;
  }

  claimed.add(cell);
  points.push({
    ...mouth,
    surface: mouth.surface - MINIMUM_POINT_DROP,
    x: grid.cellCenterX(cell),
    z: grid.cellCenterZ(cell),
  });
}

function lakeAtMouth(lakeIds: Int32Array, chain: RiverChain): number {
  if (chain.mouthReceiver === NO_CELL || chain.joinsCell !== NO_CELL) {
    return NO_CELL;
  }

  return lakeIds[chain.mouthReceiver];
}

function appendLakeEntry(grid: WorldGrid, points: RiverPoint[], lake: Lake, lakeCell: number): void {
  const last = points.at(-1);

  if (last === undefined) {
    return;
  }

  for (const point of points) {
    point.surface = Math.max(point.surface, lake.level);
  }

  points.push({ ...last, surface: lake.level, x: grid.cellCenterX(lakeCell), z: grid.cellCenterZ(lakeCell) });
}

function joinMainRiver(points: RiverPoint[], junction: Junction | null): void {
  const last = points.at(-1);

  if (junction === null || last === undefined) {
    return;
  }

  settleIntoMainRiver(points, junction.surface);
  last.x = junction.x;
  last.z = junction.z;
}

function buildRivers(land: RiverLand, chains: readonly RiverChain[]): River[] {
  const { basins, grid } = land;

  const rivers: River[] = [];
  const owners = new Map<number, River>();
  const claimedPastCoast = new Set<number>();
  const flows = chainFlows(basins.network, chains);

  for (const [chainIndex, chain] of chains.entries()) {
    const cells = chainCells(chain);

    if (cells.length < 4) {
      continue;
    }

    const points = cells.map((cell, index) => {
      return riverPointFor(land, cell, flows[chainIndex][index]);
    });
    const lakeId = lakeAtMouth(basins.lakeIds, chain);
    const reachesEdge = chain.mouthReceiver === NO_CELL && chain.joinsCell === NO_CELL;
    const mainRiver = owners.get(chain.joinsCell);
    const junction =
      mainRiver === undefined
        ? null
        : junctionOn(mainRiver, grid.cellCenterX(chain.joinsCell), grid.cellCenterZ(chain.joinsCell));
    const lake = lakeId >= 0 ? basins.lakes[lakeId] : undefined;

    sinkIntoSlopes(land, points);

    if (lake !== undefined) {
      appendLakeEntry(grid, points, lake, chain.mouthReceiver);
    }

    makeSurfaceDescend(points, MINIMUM_POINT_DROP);
    joinMainRiver(points, junction);

    const endSurface = junction === null ? lake?.level : junction.surface;
    const shaped = shapeRiver(land, points, chain.cells[0], endSurface);

    if (reachesEdge) {
      runPastCoast(land, shaped, claimedPastCoast);
    }

    const river = { id: rivers.length, points: shaped, reachesEdge };

    for (const cell of chain.cells) {
      owners.set(cell, river);
    }

    rivers.push(river);
  }

  return rivers;
}

function flowDirectionAt(river: River, mouth: RiverPoint): { directionX: number; directionZ: number } {
  const upstream = river.points.findLast((point) => {
    return Math.hypot(point.x - mouth.x, point.z - mouth.z) >= FLOW_REACH;
  });
  const from = upstream === undefined ? river.points[0] : upstream;

  const length = Math.max(1e-6, Math.hypot(mouth.x - from.x, mouth.z - from.z));

  return { directionX: (mouth.x - from.x) / length, directionZ: (mouth.z - from.z) / length };
}

function findWaterfalls(rivers: readonly River[]): Waterfall[] {
  const waterfalls: Waterfall[] = [];

  for (const river of rivers) {
    const mouth = river.points.at(-1);

    if (!river.reachesEdge || mouth === undefined) {
      continue;
    }

    waterfalls.push({
      ...flowDirectionAt(river, mouth),
      top: mouth.surface,
      width: mouth.width,
      x: mouth.x,
      z: mouth.z,
    });
  }

  return waterfalls;
}

export function computeHydrology(
  heights: Float32Array,
  grid: WorldGrid,
  dryness: Float32Array,
  coastDistance: Float32Array,
  options: HydrologyOptions = DEFAULT_HYDROLOGY
): HydrologyResult {
  const basins = analyzeDrainage(heights, grid, dryness, coastDistance, options);
  const { lakeIds, lakes, riverThreshold, waterSurface } = basins;

  const riverStrength = new Uint8Array(grid.cellCount);
  const land: RiverLand = { basins, coastDistance, grid, heights };

  const chains = spaceRiverChains(land, traceRiverChains(basins.network, lakeIds, riverThreshold));
  const { channels, rivers, springs } = placeSprings(
    { coastDistance, grid, heights, lakeIds, riverThreshold },
    buildRivers(land, chains)
  );
  const targets: ChannelTargets = {
    coastDistance,
    grid,
    heights,
    lakeIds,
    riverStrength,
    sideCuts: new Float32Array(grid.cellCount).fill(Number.POSITIVE_INFINITY),
    sideFloors: new Float32Array(grid.cellCount).fill(Number.NEGATIVE_INFINITY),
    threshold: riverThreshold,
    uncarvedHeights: Float32Array.from(heights),
    waterSurface,
  };

  carveWaterways(targets, rivers, channels, springs);

  return {
    carving: targets.uncarvedHeights.map((uncarvedHeight, cell) => {
      return uncarvedHeight - heights[cell];
    }),
    features: { lakes, rivers, springs, waterfalls: findWaterfalls(rivers) },
    lakeIds,
    riverStrength,
    waterSurface,
  };
}
