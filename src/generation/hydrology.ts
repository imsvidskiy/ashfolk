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
import { makeSurfaceDescend, smoothRiverPath } from "./river-paths.ts";
import { type RiverLand, spaceRiverChains } from "./river-spacing.ts";
import { placeSprings } from "./springs.ts";

const MINIMUM_POINT_DROP = 0.04;
const SLOPE_LOOKAROUND = 2;
const BANK_SAMPLES = 3;
const OUTER_BANK_SLOPE = 0.3;
const FLAT_CROSS_SLOPE = 0.04;
const STEEP_CROSS_SLOPE = 0.12;
const FLOW_REACH = 15;

interface HydrologyResult {
  carving: Float32Array;
  features: WaterFeatures;
  lakeIds: Int32Array;
  riverStrength: Uint8Array;
  waterSurface: Float32Array;
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

function sinkIntoSlopes(land: RiverLand, points: RiverPoint[]): void {
  for (const [index, point] of points.entries()) {
    const before = points[Math.max(0, index - SLOPE_LOOKAROUND)];
    const after = points[Math.min(points.length - 1, index + SLOPE_LOOKAROUND)];
    const length = Math.hypot(after.x - before.x, after.z - before.z);

    if (length < 1e-6) {
      continue;
    }

    const acrossX = -(after.z - before.z) / length;
    const acrossZ = (after.x - before.x) / length;

    const left = lowestBankGround(land, point, acrossX, acrossZ);
    const right = lowestBankGround(land, point, -acrossX, -acrossZ);

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

function buildRivers(land: RiverLand, chains: readonly RiverChain[]): River[] {
  const { basins, grid } = land;

  const rivers: River[] = [];
  const surfaces = new Map<number, number>();
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

    sinkIntoSlopes(land, points);

    if (lakeId >= 0) {
      appendLakeEntry(grid, points, basins.lakes[lakeId], chain.mouthReceiver);
    }

    makeSurfaceDescend(points, MINIMUM_POINT_DROP);
    settleIntoMainRiver(points, surfaces.get(chain.joinsCell));

    for (const [index, cell] of chain.cells.entries()) {
      surfaces.set(cell, points[index].surface);
    }

    const smoothed = smoothRiverPath(points);

    if (reachesEdge) {
      runPastCoast(land, smoothed, claimedPastCoast);
    }

    rivers.push({ id: rivers.length, points: smoothed, reachesEdge });
  }

  return rivers;
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
