import { clamp, saturate, smoothstep } from "../shared/math.ts";
import { MinHeap } from "../shared/min-heap.ts";
import { isOnIsland } from "../world/coast.ts";
import { hasWater, NO_WATER, type River, type RiverPoint, riverCodeOfStrength, type Spring } from "../world/water.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../world/world-grid.ts";
import { NO_CELL } from "./drainage.ts";
import { carvePond, isRiverWater } from "./ponds.ts";
import { riverStrengthFor } from "./river-chains.ts";
import { interpolatePoint } from "./river-paths.ts";

export const BANK_FREEBOARD = 0.2;

const DIAGONAL_REACH = 0.75;
const BANK_DEPTH = 0.7;
const SHALLOWEST_WATER = 0.05;
const MINIMUM_BANK_WIDTH = 6;
const BANK_HEIGHT = 1.6;
const DEEPEST_BANK_CUT = 2;
const DEEPEST_BANK_LOWERING = 10;
const BANK_LOWERING_FADE = 0.2;
const SHALLOWEST_CHANNEL = 0.6;
const DESCENT_PASSES = 8;
const LIFT_ALLOWANCE = 0.3;
const GENTLE_BANK_SLOPE = 0.2;
const WIDEST_SIDE_CUT = 40;
const PINCH_PASSES = 2;
const PINCHED_DEPTH = 0.6;
const OPPOSITE_SIDES = [
  [0, 1],
  [1, 0],
] as const;

export interface ChannelTargets {
  coastDistance: Float32Array;
  grid: WorldGrid;
  heights: Float32Array;
  lakeIds: Int32Array;
  riverStrength: Uint8Array;
  sideCuts: Float32Array;
  threshold: number;
  uncarvedHeights: Float32Array;
  waterSurface: Float32Array;
}

interface ChannelSamples {
  readonly alongs: Float64Array;
  readonly cells: number[];
  readonly distances: Float64Array;
  readonly segments: Int32Array;
}

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

export function bankWidthOf(point: RiverPoint): number {
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

function createChannelSamples(cellCount: number): ChannelSamples {
  return {
    alongs: new Float64Array(cellCount),
    cells: [],
    distances: new Float64Array(cellCount).fill(Number.POSITIVE_INFINITY),
    segments: new Int32Array(cellCount),
  };
}

function sampleSegment(grid: WorldGrid, points: readonly RiverPoint[], segment: number, samples: ChannelSamples): void {
  const { alongs, cells, distances, segments } = samples;

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

      if (distance >= distances[cell]) {
        continue;
      }

      if (distances[cell] === Number.POSITIVE_INFINITY) {
        cells.push(cell);
      }

      alongs[cell] = along;
      distances[cell] = distance;
      segments[cell] = segment;
    }
  }
}

function sampleChannel(grid: WorldGrid, points: readonly RiverPoint[], samples: ChannelSamples): void {
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    sampleSegment(grid, points, segment, samples);
  }
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
    targets.sideCuts[cell] = Math.min(targets.sideCuts[cell], cut);

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

  const surface = targets.waterSurface[cell];

  targets.waterSurface[cell] = surface === NO_WATER ? point.surface : Math.min(surface, point.surface);

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

function carveChannel(
  targets: ChannelTargets,
  samples: ChannelSamples,
  points: readonly RiverPoint[],
  coastSegment = NO_CELL
): void {
  const { alongs, cells, distances, segments } = samples;

  sampleChannel(targets.grid, points, samples);

  for (const cell of cells) {
    const segment = segments[cell];
    const point = interpolatePoint(points[segment], points[segment + 1], alongs[cell]);

    carveCell(targets, cell, distances[cell], point, segment === coastSegment);
    distances[cell] = Number.POSITIVE_INFINITY;
  }

  cells.length = 0;
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

function carveRivers(targets: ChannelTargets, samples: ChannelSamples, rivers: readonly River[]): void {
  for (const river of rivers) {
    carveChannel(targets, samples, river.points, pastCoastSegment(targets, river));
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

function highestWaterBeside(targets: ChannelTargets, cell: number, isStandingOnly: boolean): number {
  const { grid, heights, riverStrength, waterSurface } = targets;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  let highest = Number.NEGATIVE_INFINITY;

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighbor = grid.neighborIndex(column, row, offset);

    if (neighbor < 0 || (isStandingOnly && riverStrength[neighbor] > 0)) {
      continue;
    }

    if (hasWater(waterSurface[neighbor], heights[neighbor])) {
      highest = Math.max(highest, waterSurface[neighbor]);
    }
  }

  return highest;
}

function applySideCuts(targets: ChannelTargets): void {
  const { heights, sideCuts, waterSurface } = targets;

  for (let cell = 0; cell < sideCuts.length; cell += 1) {
    const cut = sideCuts[cell];

    if (cut === Number.POSITIVE_INFINITY || hasWater(waterSurface[cell], heights[cell])) {
      continue;
    }

    heights[cell] = Math.min(heights[cell], Math.max(cut, highestWaterBeside(targets, cell, false)));
  }
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

    if (cut <= 0) {
      continue;
    }

    const floor = Math.max(lowering.floors[cell], highestWaterBeside(targets, cell, true));

    heights[cell] = Math.min(heights[cell], Math.max(uncarvedHeights[cell] - cut, floor));
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

export function carveWaterways(
  targets: ChannelTargets,
  rivers: readonly River[],
  channels: readonly (readonly RiverPoint[])[],
  springs: readonly Spring[]
): void {
  const samples = createChannelSamples(targets.grid.cellCount);

  carveRivers(targets, samples, rivers);

  for (const channel of channels) {
    carveChannel(targets, samples, channel);
  }

  for (const spring of springs) {
    if (spring.kind === "pond") {
      carvePond(targets, spring);
    }
  }

  applySideCuts(targets);
  keepRiversDescending(targets, rivers);
  dropShallowWater(targets.heights, targets.waterSurface, targets.riverStrength);
  lowerBanks(targets);
  fillPinchedBanks(targets);
}
