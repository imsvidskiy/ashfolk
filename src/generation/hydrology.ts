import { clamp, hashToUnit, saturate, smoothstep } from "../shared/math.ts";
import { MinHeap } from "../shared/min-heap.ts";
import { isOnIsland } from "../world/coast.ts";
import {
  hasWater,
  type Lake,
  NO_WATER,
  type River,
  type RiverPoint,
  riverCodeOfStrength,
  riverWidthOfStrength,
  type WaterFeatures,
  type Waterfall,
} from "../world/water.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../world/world-grid.ts";
import { carvePond, isRiverWater } from "./ponds.ts";
import { interpolatePoint, makeSurfaceDescend, smoothRiverPath } from "./river-paths.ts";
import { type RiverLand, spaceRiverChains } from "./river-spacing.ts";
import { placeSprings } from "./springs.ts";

export const NO_CELL = -1;

const DIAGONAL_REACH = 0.75;
const BANK_DEPTH = 0.7;
const SHALLOWEST_WATER = 0.05;
const MINIMUM_BANK_WIDTH = 6;
const REJECTED_LAKE = -2;
const FILL_EPSILON = 1e-3;
const FLOODED_DEPTH = 0.25;
const BANK_HEIGHT = 1.6;
const DEEPEST_BANK_CUT = 2;
const BANK_FREEBOARD = 0.2;
const DEEPEST_BANK_LOWERING = 10;
const BANK_LOWERING_FADE = 0.2;
const MINIMUM_POINT_DROP = 0.04;
const SHALLOWEST_CHANNEL = 0.6;
const DESCENT_PASSES = 8;
const LIFT_ALLOWANCE = 0.3;
const SLOPE_LOOKAROUND = 2;
const BANK_SAMPLES = 3;
const GENTLE_BANK_SLOPE = 0.2;
const WIDEST_SIDE_CUT = 40;
const FLAT_CROSS_SLOPE = 0.04;
const STEEP_CROSS_SLOPE = 0.12;
const FLOW_REACH = 15;
const PINCH_PASSES = 2;
const PINCHED_DEPTH = 0.6;
const WANDER_SLOPE_SHARE = 0.65;
const WANDER_SALT = 61.7;
const WANDER_STEP = 10;
const WANDER_CHANCE_SALT = 29.3;
const OPPOSITE_SIDES = [
  [0, 1],
  [1, 0],
] as const;

interface HydrologyOptions {
  lakeMinimumArea: number;
  lakeMinimumCatchmentArea: number;
  lakeMinimumDepth: number;
  riverBasinMinimumArea: number;
  riverBasinMinimumDepth: number;
  riverCatchmentArea: number;
}

export const DEFAULT_HYDROLOGY: HydrologyOptions = {
  lakeMinimumArea: 3000,
  lakeMinimumCatchmentArea: 420_000,
  lakeMinimumDepth: 1.6,
  riverBasinMinimumArea: Number.POSITIVE_INFINITY,
  riverBasinMinimumDepth: 0.6,
  riverCatchmentArea: 200_000,
};

export const RESHAPED_LAND_HYDROLOGY: HydrologyOptions = { ...DEFAULT_HYDROLOGY, riverBasinMinimumArea: 500 };

interface CellThresholds {
  lakeMinimumCatchment: number;
  lakeMinimumCells: number;
  lakeMinimumDepth: number;
  riverBasinMinimumCells: number;
  riverBasinMinimumDepth: number;
  riverThreshold: number;
}

interface HydrologyResult {
  carving: Float32Array;
  features: WaterFeatures;
  lakeIds: Int32Array;
  riverStrength: Uint8Array;
  waterSurface: Float32Array;
}

interface DrainageNetwork {
  accumulation: Float32Array;
  filled: Float32Array;
  order: Int32Array;
  receivers: Int32Array;
}

export interface DrainageBasins {
  lakeIds: Int32Array;
  lakes: Lake[];
  network: DrainageNetwork;
  riverThreshold: number;
  waterSurface: Float32Array;
}

export interface RiverChain {
  cells: number[];
  joinsCell: number;
  mouthReceiver: number;
}

interface ChainPosition {
  readonly chain: number;
  readonly index: number;
}

interface FloodedArea {
  cells: number[];
  level: number;
  maximumAccumulation: number;
  maximumDepth: number;
}

interface NeighborCell {
  readonly cell: number;
  readonly outwardX: number;
  readonly outwardZ: number;
}

interface ChannelTargets {
  coastDistance: Float32Array;
  grid: WorldGrid;
  heights: Float32Array;
  lakeIds: Int32Array;
  riverStrength: Uint8Array;
  threshold: number;
  uncarvedHeights: Float32Array;
  waterSurface: Float32Array;
}

interface ChannelSample {
  along: number;
  distance: number;
  segment: number;
}

type ChannelSamples = Map<number, ChannelSample>;

interface PinchedBank {
  readonly cell: number;
  readonly level: number;
  readonly strength: number;
}

interface BankLowering {
  readonly cuts: Float32Array;
  readonly floors: Float32Array;
  readonly heap: MinHeap;
  readonly isBesideWater: Uint8Array;
}

function toCellThresholds(grid: WorldGrid, options: HydrologyOptions): CellThresholds {
  const cellArea = grid.cellSize * grid.cellSize;

  return {
    lakeMinimumCatchment: options.lakeMinimumCatchmentArea / cellArea,
    lakeMinimumCells: Math.max(1, options.lakeMinimumArea / cellArea),
    lakeMinimumDepth: options.lakeMinimumDepth,
    riverBasinMinimumCells: Math.max(1, options.riverBasinMinimumArea / cellArea),
    riverBasinMinimumDepth: options.riverBasinMinimumDepth,
    riverThreshold: options.riverCatchmentArea / cellArea,
  };
}

export function isNearLake(grid: WorldGrid, lakeIds: Int32Array, x: number, z: number, radius: number): boolean {
  return grid.cellsInRadius(x, z, radius).some((cell) => {
    return lakeIds[cell] !== NO_CELL;
  });
}

export function touchesOffIsland(grid: WorldGrid, coastDistance: Float32Array, cell: number): boolean {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighbor = grid.neighborIndex(column, row, offset);

    if (neighbor >= 0 && !isOnIsland(coastDistance, neighbor)) {
      return true;
    }
  }

  return false;
}

function wanderingReceiver(grid: WorldGrid, filled: Float32Array, cell: number, weights: Float64Array): number {
  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);
  const level = filled[cell];

  let steepest = 0;

  for (const [index, offset] of NEIGHBOR_OFFSETS.entries()) {
    const neighbor = grid.neighborIndex(column, row, offset);

    weights[index] = neighbor < 0 ? 0 : Math.max(0, (level - filled[neighbor]) / offset.distance);
    steepest = Math.max(steepest, weights[index]);
  }

  let total = 0;

  for (let index = 0; index < NEIGHBOR_OFFSETS.length; index += 1) {
    weights[index] = Math.max(0, weights[index] - WANDER_SLOPE_SHARE * steepest);
    total += weights[index];
  }

  if (total <= 0) {
    return NO_CELL;
  }

  let pick = hashToUnit(column, row, WANDER_SALT) * total;

  for (const [index, offset] of NEIGHBOR_OFFSETS.entries()) {
    pick -= weights[index];

    if (weights[index] > 0 && pick <= 0) {
      return grid.neighborIndex(column, row, offset);
    }
  }

  return NO_CELL;
}

function wanderReceivers(grid: WorldGrid, heights: Float32Array, filled: Float32Array, receivers: Int32Array): void {
  const wanderChance = Math.min(1, WANDER_STEP / grid.cellSize);
  const weights = new Float64Array(NEIGHBOR_OFFSETS.length);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (receivers[cell] === NO_CELL || filled[cell] > heights[cell]) {
      continue;
    }

    if (hashToUnit(grid.columnOf(cell), grid.rowOf(cell), WANDER_CHANCE_SALT) >= wanderChance) {
      continue;
    }

    const receiver = wanderingReceiver(grid, filled, cell, weights);

    if (receiver !== NO_CELL) {
      receivers[cell] = receiver;
    }
  }
}

function fillDepressions(heights: Float32Array, grid: WorldGrid, coastDistance: Float32Array): DrainageNetwork {
  const size = grid.cellsPerSide;
  const filled = Float32Array.from(heights);
  const closed = new Uint8Array(grid.cellCount);
  const receivers = new Int32Array(grid.cellCount).fill(NO_CELL);
  const order = new Int32Array(grid.cellCount);
  const heap = new MinHeap(size * 16);
  let processed = 0;

  function seedCell(cell: number): void {
    if (closed[cell] === 1 || !isOnIsland(coastDistance, cell)) {
      return;
    }

    closed[cell] = 1;
    heap.push(cell, filled[cell]);
  }

  for (let position = 0; position < size; position += 1) {
    seedCell(grid.index(position, 0));
    seedCell(grid.index(position, size - 1));
    seedCell(grid.index(0, position));
    seedCell(grid.index(size - 1, position));
  }

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (touchesOffIsland(grid, coastDistance, cell)) {
      seedCell(cell);
    }
  }

  while (heap.size > 0) {
    const cell = heap.pop();

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);
    const level = filled[cell];

    order[processed] = cell;
    processed += 1;

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0) {
        continue;
      }

      if (closed[neighbor] === 1 || !isOnIsland(coastDistance, neighbor)) {
        continue;
      }

      const neighborLevel = Math.max(heights[neighbor], level + FILL_EPSILON);

      closed[neighbor] = 1;
      filled[neighbor] = neighborLevel;
      receivers[neighbor] = cell;
      heap.push(neighbor, neighborLevel);
    }
  }

  wanderReceivers(grid, heights, filled, receivers);

  const accumulation = new Float32Array(grid.cellCount).fill(1);

  for (let position = processed - 1; position >= 0; position -= 1) {
    const cell = order[position];
    const receiver = receivers[cell];

    if (receiver !== NO_CELL) {
      accumulation[receiver] += accumulation[cell];
    }
  }

  return { accumulation, filled, order, receivers };
}

function collectFloodedArea(
  grid: WorldGrid,
  heights: Float32Array,
  network: DrainageNetwork,
  start: number,
  visited: Int32Array,
  marker: number
): FloodedArea {
  const area: FloodedArea = { cells: [], level: Number.POSITIVE_INFINITY, maximumAccumulation: 0, maximumDepth: 0 };
  const stack = [start];

  visited[start] = marker;

  for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
    area.cells.push(cell);
    area.maximumAccumulation = Math.max(area.maximumAccumulation, network.accumulation[cell]);
    area.level = Math.min(area.level, network.filled[cell]);
    area.maximumDepth = Math.max(area.maximumDepth, network.filled[cell] - heights[cell]);

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0) {
        continue;
      }

      if (visited[neighbor] === NO_CELL && network.filled[neighbor] - heights[neighbor] >= FLOODED_DEPTH) {
        visited[neighbor] = marker;
        stack.push(neighbor);
      }
    }
  }

  return area;
}

function averageCell(grid: WorldGrid, cells: readonly number[]): { x: number; z: number } {
  let sumX = 0;
  let sumZ = 0;

  for (const cell of cells) {
    sumX += grid.cellCenterX(cell);
    sumZ += grid.cellCenterZ(cell);
  }

  return { x: sumX / cells.length, z: sumZ / cells.length };
}

function isLakeKept(area: FloodedArea, centerDryness: number, options: CellThresholds): boolean {
  const catchmentNeeded = options.lakeMinimumCatchment * (1 + 6 * centerDryness);

  const isLargeLake =
    area.cells.length >= options.lakeMinimumCells &&
    area.maximumAccumulation >= catchmentNeeded &&
    area.maximumDepth >= options.lakeMinimumDepth;

  return isLargeLake || isFilledByRiver(area, options);
}

function isFilledByRiver(area: FloodedArea, options: CellThresholds): boolean {
  return (
    area.cells.length >= options.riverBasinMinimumCells &&
    area.maximumAccumulation >= options.riverThreshold &&
    area.maximumDepth >= options.riverBasinMinimumDepth
  );
}

function findLakes(
  heights: Float32Array,
  network: DrainageNetwork,
  grid: WorldGrid,
  dryness: Float32Array,
  options: CellThresholds,
  waterSurface: Float32Array,
  lakeIds: Int32Array
): Lake[] {
  const lakes: Lake[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (lakeIds[cell] !== NO_CELL || network.filled[cell] - heights[cell] < FLOODED_DEPTH) {
      continue;
    }

    const id = lakes.length;
    const area = collectFloodedArea(grid, heights, network, cell, lakeIds, id);

    const center = averageCell(grid, area.cells);
    const centerDryness = dryness[grid.cellAt(center.x, center.z)];

    if (!isLakeKept(area, centerDryness, options)) {
      for (const floodedCell of area.cells) {
        lakeIds[floodedCell] = REJECTED_LAKE;
      }

      continue;
    }

    for (const floodedCell of area.cells) {
      waterSurface[floodedCell] = area.level;
    }

    lakes.push({
      cellCount: area.cells.length,
      centerX: center.x,
      centerZ: center.z,
      id,
      level: area.level,
    });
  }

  for (let cell = 0; cell < lakeIds.length; cell += 1) {
    if (lakeIds[cell] === REJECTED_LAKE) {
      lakeIds[cell] = NO_CELL;
    }
  }

  return lakes;
}

function buildUpstreamLists(isRiver: Uint8Array, receivers: Int32Array): Map<number, number[]> {
  const upstream = new Map<number, number[]>();

  for (let cell = 0; cell < isRiver.length; cell += 1) {
    const receiver = receivers[cell];

    if (isRiver[cell] === 0 || receiver === NO_CELL || isRiver[receiver] === 0) {
      continue;
    }

    const list = upstream.get(receiver);

    if (list !== undefined) {
      list.push(cell);

      continue;
    }

    upstream.set(receiver, [cell]);
  }

  return upstream;
}

function largestByAccumulation(accumulation: Float32Array, cells: readonly number[]): number {
  let best = NO_CELL;
  let bestAccumulation = -1;

  for (const cell of cells) {
    if (accumulation[cell] > bestAccumulation) {
      best = cell;
      bestAccumulation = accumulation[cell];
    }
  }

  return best;
}

function traceRiverChains(network: DrainageNetwork, lakeIds: Int32Array, riverThreshold: number): RiverChain[] {
  const isRiver = new Uint8Array(lakeIds.length);

  for (let cell = 0; cell < isRiver.length; cell += 1) {
    if (network.accumulation[cell] >= riverThreshold && lakeIds[cell] === NO_CELL) {
      isRiver[cell] = 1;
    }
  }

  const upstream = buildUpstreamLists(isRiver, network.receivers);
  const pending: { joinsCell: number; mouth: number }[] = [];

  for (let cell = 0; cell < isRiver.length; cell += 1) {
    const receiver = network.receivers[cell];

    if (isRiver[cell] === 1 && (receiver === NO_CELL || isRiver[receiver] === 0)) {
      pending.push({ joinsCell: NO_CELL, mouth: cell });
    }
  }

  const chains: RiverChain[] = [];

  for (let start = pending.pop(); start !== undefined; start = pending.pop()) {
    const cells = [start.mouth];
    let current = start.mouth;

    for (let sources = upstream.get(current); sources !== undefined; sources = upstream.get(current)) {
      const main = largestByAccumulation(network.accumulation, sources);

      for (const tributary of sources) {
        if (tributary !== main) {
          pending.push({ joinsCell: current, mouth: tributary });
        }
      }

      cells.push(main);
      current = main;
    }

    cells.reverse();
    chains.push({ cells, joinsCell: start.joinsCell, mouthReceiver: network.receivers[start.mouth] });
  }

  return chains;
}

function riverStrengthFor(flow: number, threshold: number): number {
  return Math.log2(Math.max(1, flow / threshold));
}

function channelGround(heights: Float32Array, network: DrainageNetwork, cell: number): number {
  const filled = network.filled[cell];

  if (filled - heights[cell] < FLOODED_DEPTH) {
    return heights[cell];
  }

  return filled;
}

export function riverWidthFor(flow: number, threshold: number): number {
  return riverWidthOfStrength(riverStrengthFor(flow, threshold));
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

export function chainCells(chain: RiverChain): number[] {
  return chain.joinsCell === NO_CELL ? [...chain.cells] : [...chain.cells, chain.joinsCell];
}

function downstreamChainCell(
  network: DrainageNetwork,
  positions: ReadonlyMap<number, ChainPosition>,
  cell: number
): ChainPosition | undefined {
  for (let current = network.receivers[cell]; current !== NO_CELL; current = network.receivers[current]) {
    const position = positions.get(current);

    if (position !== undefined) {
      return position;
    }
  }

  return undefined;
}

export function chainFlows(network: DrainageNetwork, chains: readonly RiverChain[]): number[][] {
  const positions = new Map<number, ChainPosition>();

  for (const [chain, { cells }] of chains.entries()) {
    for (const [index, cell] of cells.entries()) {
      positions.set(cell, { chain, index });
    }
  }

  const inflows = chains.map((chain) => {
    return new Float64Array(chain.cells.length + 1);
  });
  const flows: number[][] = [];

  for (let chainIndex = chains.length - 1; chainIndex >= 0; chainIndex -= 1) {
    const chain = chains[chainIndex];

    let flow = 0;

    flows[chainIndex] = chainCells(chain).map((cell, index) => {
      flow = Math.max(flow, network.accumulation[cell]) + inflows[chainIndex][index];

      return flow;
    });

    const last = chain.cells.at(-1);

    if (last === undefined) {
      continue;
    }

    const lastFlow = flows[chainIndex][chain.cells.length - 1];
    const junction = positions.get(chain.joinsCell);

    if (junction !== undefined && network.receivers[last] !== chain.joinsCell) {
      inflows[junction.chain][junction.index] += lastFlow;
      continue;
    }

    const downstream = downstreamChainCell(network, positions, last);
    const addedFlow = lastFlow - network.accumulation[last];

    if (downstream !== undefined && downstream.chain < chainIndex && addedFlow > 0) {
      inflows[downstream.chain][downstream.index] += addedFlow;
    }
  }

  return flows;
}

function bankGroundAt(land: RiverLand, x: number, z: number): number {
  const { basins, coastDistance, grid, heights } = land;

  if (!grid.contains(grid.columnAt(x), grid.rowAt(z))) {
    return Number.NaN;
  }

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

    lowest = Math.min(lowest, ground);
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

    if (sinking > 0 && lowestBank < point.surface) {
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

function bankWidthOf(point: RiverPoint): number {
  return Math.max(MINIMUM_BANK_WIDTH, point.width);
}

function channelBed(distanceFromCenter: number, point: RiverPoint, uncarvedHeight: number): number {
  const halfWidth = point.width / 2;

  if (distanceFromCenter < halfWidth) {
    const across = distanceFromCenter / halfWidth;

    return point.surface - point.depth * (1 - across * across * 0.7);
  }

  const bank = smoothstep(0, 1, (distanceFromCenter - halfWidth) / bankWidthOf(point));

  const shapedBank = point.surface - 0.3 * point.depth + (0.3 * point.depth + BANK_HEIGHT) * bank;
  const lowestBank = uncarvedHeight - (0.3 * point.depth + DEEPEST_BANK_CUT) * (1 - bank);

  return Math.max(shapedBank, lowestBank);
}

function sideCut(distanceFromCenter: number, point: RiverPoint, uncarvedHeight: number): number {
  const brink = point.surface + BANK_HEIGHT;
  const rise = uncarvedHeight - brink;

  if (rise <= 0) {
    return uncarvedHeight;
  }

  const cutWidth = clamp(rise / GENTLE_BANK_SLOPE, MINIMUM_BANK_WIDTH, WIDEST_SIDE_CUT);
  const blend = smoothstep(0, 1, (distanceFromCenter - point.width / 2) / cutWidth);

  return uncarvedHeight - Math.min(rise, DEEPEST_BANK_LOWERING) * (1 - blend);
}

function sampleSegment(grid: WorldGrid, points: readonly RiverPoint[], segment: number, samples: ChannelSamples): void {
  const start = points[segment];
  const end = points[segment + 1];

  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;

  const reach =
    Math.max(start.width, end.width) / 2 + Math.max(WIDEST_SIDE_CUT, start.width, end.width) + grid.cellSize;
  const lengthSquared = Math.max(1e-6, segmentX * segmentX + segmentZ * segmentZ);

  const firstColumn = Math.max(0, grid.columnAt(Math.min(start.x, end.x) - reach));
  const lastColumn = Math.min(grid.cellsPerSide - 1, grid.columnAt(Math.max(start.x, end.x) + reach));
  const firstRow = Math.max(0, grid.rowAt(Math.min(start.z, end.z) - reach));
  const lastRow = Math.min(grid.cellsPerSide - 1, grid.rowAt(Math.max(start.z, end.z) + reach));

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const x = grid.centerX(column);
      const z = grid.centerZ(row);

      const along = saturate(((x - start.x) * segmentX + (z - start.z) * segmentZ) / lengthSquared);
      const distance = Math.hypot(x - (start.x + segmentX * along), z - (start.z + segmentZ * along));
      const cell = grid.index(column, row);
      const nearest = samples.get(cell);

      if (nearest === undefined || distance < nearest.distance) {
        samples.set(cell, { along, distance, segment });
      }
    }
  }
}

function nearestChannelSamples(grid: WorldGrid, points: readonly RiverPoint[]): ChannelSamples {
  const samples: ChannelSamples = new Map();

  for (let segment = 0; segment < points.length - 1; segment += 1) {
    sampleSegment(grid, points, segment, samples);
  }

  return samples;
}

function settledOnGround(point: RiverPoint, ground: number): RiverPoint {
  const highest = ground + LIFT_ALLOWANCE;

  if (point.surface <= highest) {
    return point;
  }

  return { ...point, surface: highest };
}

function carveCell(
  targets: ChannelTargets,
  cell: number,
  distanceFromCenter: number,
  sampled: RiverPoint,
  isPastCoast: boolean
): void {
  const halfWidth = sampled.width / 2;
  const wetReach = Math.max(halfWidth, targets.grid.cellSize * DIAGONAL_REACH);

  const channelReach = Math.max(halfWidth + bankWidthOf(sampled), wetReach);

  if (distanceFromCenter > Math.max(halfWidth + WIDEST_SIDE_CUT, channelReach)) {
    return;
  }

  if (!(isPastCoast || isOnIsland(targets.coastDistance, cell))) {
    return;
  }

  const uncarvedHeight = targets.uncarvedHeights[cell];

  const point = isPastCoast ? sampled : settledOnGround(sampled, uncarvedHeight);
  const cut = sideCut(distanceFromCenter, point, uncarvedHeight);

  if (distanceFromCenter > channelReach) {
    targets.heights[cell] = Math.min(targets.heights[cell], cut);

    return;
  }

  const bed = Math.min(channelBed(distanceFromCenter, point, uncarvedHeight), cut);
  const isUnderWater = distanceFromCenter <= wetReach || bed < point.surface - SHALLOWEST_WATER;

  if (!isUnderWater) {
    targets.heights[cell] = Math.min(targets.heights[cell], Math.max(bed, point.surface));

    return;
  }

  targets.heights[cell] = Math.min(targets.heights[cell], bed, point.surface - point.depth * BANK_DEPTH);

  if (targets.lakeIds[cell] !== NO_CELL) {
    return;
  }

  targets.waterSurface[cell] = Math.max(targets.waterSurface[cell], point.surface);

  const strength = riverCodeOfStrength(riverStrengthFor(point.flow, targets.threshold));

  targets.riverStrength[cell] = Math.max(targets.riverStrength[cell], strength);
}

function pastCoastSegment(targets: ChannelTargets, river: River): number {
  const mouth = river.points.at(-1);

  if (mouth === undefined || isOnIsland(targets.coastDistance, targets.grid.cellAt(mouth.x, mouth.z))) {
    return NO_CELL;
  }

  return river.points.length - 2;
}

function carveChannel(targets: ChannelTargets, points: readonly RiverPoint[], coastSegment = NO_CELL): void {
  for (const [cell, sample] of nearestChannelSamples(targets.grid, points)) {
    const point = interpolatePoint(points[sample.segment], points[sample.segment + 1], sample.along);

    carveCell(targets, cell, sample.distance, point, sample.segment === coastSegment);
  }
}

function matchStrengthUnderPoints(targets: ChannelTargets, points: readonly RiverPoint[]): void {
  const { grid, riverStrength, threshold } = targets;

  for (const point of points) {
    const cell = grid.cellAt(point.x, point.z);

    if (riverStrength[cell] > 0) {
      riverStrength[cell] = Math.max(riverStrength[cell], riverCodeOfStrength(riverStrengthFor(point.flow, threshold)));
    }
  }
}

function carveRivers(targets: ChannelTargets, rivers: readonly River[]): void {
  for (const river of rivers) {
    carveChannel(targets, river.points, pastCoastSegment(targets, river));
    matchStrengthUnderPoints(targets, river.points);
  }
}

function riverPathCells(grid: WorldGrid, river: River): number[] {
  const cells: number[] = [];

  for (let pointIndex = 1; pointIndex < river.points.length; pointIndex += 1) {
    const start = river.points[pointIndex - 1];
    const end = river.points[pointIndex];

    for (const cell of grid.cellsAlong(start.x, start.z, end.x, end.z)) {
      if (cell !== cells.at(-1)) {
        cells.push(cell);
      }
    }
  }

  return cells;
}

function lowerAlongPath(targets: ChannelTargets, path: readonly number[]): boolean {
  const { heights, lakeIds, waterSurface } = targets;

  let level = Number.POSITIVE_INFINITY;
  let hasLowered = false;

  for (const cell of path) {
    if (lakeIds[cell] !== NO_CELL || waterSurface[cell] === NO_WATER) {
      continue;
    }

    if (waterSurface[cell] > level) {
      waterSurface[cell] = level;
      heights[cell] = Math.min(heights[cell], level - SHALLOWEST_CHANNEL);
      hasLowered = true;
    }

    level = waterSurface[cell];
  }

  return hasLowered;
}

function keepRiversDescending(targets: ChannelTargets, rivers: readonly River[]): void {
  const paths = rivers.map((river) => {
    return riverPathCells(targets.grid, river);
  });

  for (let pass = 0; pass < DESCENT_PASSES; pass += 1) {
    let hasLowered = false;

    for (const path of paths) {
      hasLowered = lowerAlongPath(targets, path) || hasLowered;
    }

    if (!hasLowered) {
      return;
    }
  }
}

function isRiverWaterAt(targets: ChannelTargets, column: number, row: number): boolean {
  const { grid } = targets;

  return grid.contains(column, row) && isRiverWater(targets, grid.index(column, row));
}

function pinchedBank(targets: ChannelTargets, cell: number): PinchedBank | null {
  const { grid, riverStrength, waterSurface } = targets;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  for (const [columnStep, rowStep] of OPPOSITE_SIDES) {
    const isBetween =
      isRiverWaterAt(targets, column - columnStep, row - rowStep) &&
      isRiverWaterAt(targets, column + columnStep, row + rowStep);

    if (!isBetween) {
      continue;
    }

    const before = grid.index(column - columnStep, row - rowStep);
    const after = grid.index(column + columnStep, row + rowStep);

    return {
      cell,
      level: (waterSurface[before] + waterSurface[after]) / 2,
      strength: Math.max(riverStrength[before], riverStrength[after]),
    };
  }

  return null;
}

function fillPinchedBanks(targets: ChannelTargets): void {
  const { coastDistance, grid, heights, lakeIds, riverStrength, waterSurface } = targets;

  for (let pass = 0; pass < PINCH_PASSES; pass += 1) {
    const pinched: PinchedBank[] = [];

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      const isDryBank =
        isOnIsland(coastDistance, cell) && lakeIds[cell] === NO_CELL && !hasWater(waterSurface[cell], heights[cell]);

      const bank = isDryBank ? pinchedBank(targets, cell) : null;

      if (bank !== null) {
        pinched.push(bank);
      }
    }

    for (const { cell, level, strength } of pinched) {
      waterSurface[cell] = level;
      heights[cell] = Math.min(heights[cell], level - PINCHED_DEPTH);
      riverStrength[cell] = Math.max(riverStrength[cell], strength);
    }
  }
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

function isDryLand(targets: ChannelTargets, cell: number): boolean {
  return isOnIsland(targets.coastDistance, cell) && !hasWater(targets.waterSurface[cell], targets.heights[cell]);
}

function waterLevelBeside(targets: ChannelTargets, cell: number): number {
  const { grid, heights, riverStrength, waterSurface } = targets;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  let total = 0;
  let count = 0;
  let isBesideRiver = false;

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighbor = grid.neighborIndex(column, row, offset);

    if (neighbor < 0) {
      continue;
    }

    if (!hasWater(waterSurface[neighbor], heights[neighbor])) {
      continue;
    }

    total += waterSurface[neighbor];
    count += 1;

    if (riverStrength[neighbor] > 0) {
      isBesideRiver = true;
    }
  }

  return isBesideRiver ? total / count : NO_WATER;
}

function startBankLowering(targets: ChannelTargets): BankLowering {
  const { grid, uncarvedHeights } = targets;

  const lowering: BankLowering = {
    cuts: new Float32Array(grid.cellCount),
    floors: new Float32Array(grid.cellCount).fill(Number.NEGATIVE_INFINITY),
    heap: new MinHeap(grid.cellsPerSide * 16),
    isBesideWater: new Uint8Array(grid.cellCount),
  };

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!isDryLand(targets, cell)) {
      continue;
    }

    const water = waterLevelBeside(targets, cell);

    if (water === NO_WATER) {
      continue;
    }

    const floor = water + BANK_FREEBOARD;
    const cut = clamp(uncarvedHeights[cell] - floor, 0, DEEPEST_BANK_LOWERING);

    lowering.floors[cell] = floor;
    lowering.isBesideWater[cell] = 1;

    if (cut > 0) {
      lowering.cuts[cell] = cut;
      lowering.heap.push(cell, -cut);
    }
  }

  return lowering;
}

function spreadBankLowering(targets: ChannelTargets, lowering: BankLowering): void {
  const { cuts, floors, heap, isBesideWater } = lowering;
  const { grid } = targets;

  const settled = new Uint8Array(grid.cellCount);

  while (heap.size > 0) {
    const cell = heap.pop();

    if (settled[cell] === 1) {
      continue;
    }

    settled[cell] = 1;

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0) {
        continue;
      }

      const cut = cuts[cell] - BANK_LOWERING_FADE * offset.distance * grid.cellSize;

      if (cut <= cuts[neighbor] || settled[neighbor] === 1 || !isDryLand(targets, neighbor)) {
        continue;
      }

      cuts[neighbor] = cut;
      heap.push(neighbor, -cut);

      if (isBesideWater[neighbor] === 0) {
        floors[neighbor] = Math.max(floors[neighbor], floors[cell]);
      }
    }
  }
}

function lowerBanks(targets: ChannelTargets): void {
  const { heights, uncarvedHeights } = targets;

  const lowering = startBankLowering(targets);

  spreadBankLowering(targets, lowering);

  for (let cell = 0; cell < lowering.cuts.length; cell += 1) {
    const cut = lowering.cuts[cell];

    if (cut > 0) {
      heights[cell] = Math.min(heights[cell], Math.max(uncarvedHeights[cell] - cut, lowering.floors[cell]));
    }
  }
}

function dropShallowWater(heights: Float32Array, waterSurface: Float32Array, riverStrength: Uint8Array): void {
  for (let cell = 0; cell < waterSurface.length; cell += 1) {
    if (waterSurface[cell] !== NO_WATER && !hasWater(waterSurface[cell], heights[cell])) {
      waterSurface[cell] = NO_WATER;
      riverStrength[cell] = 0;
    }
  }
}

export function analyzeDrainage(
  heights: Float32Array,
  grid: WorldGrid,
  dryness: Float32Array,
  coastDistance: Float32Array,
  options: HydrologyOptions = DEFAULT_HYDROLOGY
): DrainageBasins {
  const thresholds = toCellThresholds(grid, options);
  const network = fillDepressions(heights, grid, coastDistance);
  const waterSurface = new Float32Array(grid.cellCount).fill(NO_WATER);
  const lakeIds = new Int32Array(grid.cellCount).fill(NO_CELL);

  const lakes = findLakes(heights, network, grid, dryness, thresholds, waterSurface, lakeIds);

  return { lakeIds, lakes, network, riverThreshold: thresholds.riverThreshold, waterSurface };
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
  const rivers = buildRivers(land, chains);
  const springs = placeSprings({ coastDistance, grid, heights, lakeIds, riverThreshold }, rivers);
  const targets: ChannelTargets = {
    coastDistance,
    grid,
    heights,
    lakeIds,
    riverStrength,
    threshold: riverThreshold,
    uncarvedHeights: Float32Array.from(heights),
    waterSurface,
  };

  carveRivers(targets, rivers);

  for (const channel of springs.channels) {
    carveChannel(targets, channel);
  }

  for (const spring of springs.springs) {
    if (spring.kind === "pond") {
      carvePond(targets, spring);
    }
  }

  keepRiversDescending(targets, rivers);
  dropShallowWater(heights, waterSurface, riverStrength);
  lowerBanks(targets);
  fillPinchedBanks(targets);

  return {
    carving: targets.uncarvedHeights.map((uncarvedHeight, cell) => {
      return uncarvedHeight - heights[cell];
    }),
    features: { lakes, rivers, springs: springs.springs, waterfalls: findWaterfalls(rivers) },
    lakeIds,
    riverStrength,
    waterSurface,
  };
}
