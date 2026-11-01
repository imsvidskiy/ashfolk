import { clamp, lerp, saturate, smoothstep } from "../shared/math.ts";
import { isOnIsland } from "../world/coast.ts";
import { CELL_STAND_INSET } from "../world/footing.ts";
import {
  DRAWN_RIVER_EDGE_WOBBLE,
  drawnRiverHalfWidth,
  hasWater,
  NO_WATER,
  type River,
  type RiverPoint,
  riverCodeOfStrength,
  type Spring,
} from "../world/water.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../world/world-grid.ts";
import { NO_CELL } from "./drainage.ts";
import { carvePond, isRiverWater } from "./ponds.ts";
import { riverStrengthFor } from "./river-chains.ts";
import { interpolatePoint, smoothPinned } from "./river-paths.ts";

export const BANK_FREEBOARD = 0.2;

const DIAGONAL_REACH = 0.75;
const BANK_DEPTH = 0.7;
const SHORE_DEPTH = 0.3;
const SHALLOWEST_WATER = 0.05;
const MINIMUM_BANK_WIDTH = 6;
const SHALLOWEST_CHANNEL = 0.6;
const DESCENT_PASSES = 8;
const LIFT_ALLOWANCE = 0.3;
const FLOOR_CELLS = 1.2;
const DRAWN_EDGE_SLACK = 0.75;
const RIM_DEPTH = 0.12;
const RIM_EASING = 4;
const WALL_SLOPE_LIFT = 0.2;
const GENTLEST_WALL = 0.35;
const STEEPEST_WALL = 0.75;
const WALL_FOOT = 5;
const WALL_BLEND = 3;
const WALL_SLOPE_REACH = 20;
const WALL_SLOPE_SPREAD = 20;
const WALL_SLOPE_SPACING = 2.5;
const DEEPEST_WALL_CUT = 10;
const DEEPEST_FLOOR_CUT = 30;
const FLOOR_CUT_SLACK = 2;
const FLOOR_CUT_REACH = 60;
const FLOOR_CUT_PROBE = 20;
const ROOMY_LAND_RISE = 0.45;
const CRAMPED_LAND_RISE = 0.7;
const WALL_CUT_EASING = 4;
const WALL_REACH = 50;
const WALL_FADE = 60;
const WALL_FOOT_SOFTNESS = 6;
const WALL_FOOT_CUTOFF = 4 * WALL_FOOT_SOFTNESS;
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
  sideFloors: Float32Array;
  threshold: number;
  uncarvedHeights: Float32Array;
  waterSurface: Float32Array;
}

interface ChannelSamples {
  readonly alongs: Float64Array;
  readonly cells: number[];
  readonly distances: Float64Array;
  readonly footSurfaces: Float64Array;
  readonly footWeights: Float64Array;
  readonly segments: Int32Array;
}

interface PinchedBank {
  readonly cell: number;
  readonly level: number;
  readonly strength: number;
}

interface ChannelKind {
  readonly coastSegment: number;
  readonly isRiver: boolean;
}

interface CellShape {
  readonly acrossX: number;
  readonly acrossZ: number;
  readonly floorCut: number;
  readonly floorSurface: number;
  readonly footSurface: number;
  readonly isPastCoast: boolean;
  readonly isRiver: boolean;
  readonly wallSlope: number;
}

interface WallSide {
  readonly floorCuts: Float64Array;
  readonly slopes: Float64Array;
}

interface RiverWalls {
  readonly left: WallSide;
  readonly right: WallSide;
}

export function bankWidthOf(point: RiverPoint): number {
  return Math.max(MINIMUM_BANK_WIDTH, point.width);
}

function drawnReach(halfWidth: number): number {
  return drawnRiverHalfWidth(halfWidth) + DRAWN_RIVER_EDGE_WOBBLE + DRAWN_EDGE_SLACK;
}

function riverWetReach(grid: WorldGrid, halfWidth: number, shape: CellShape): number {
  const standingReach = (grid.cellSize / 2 - CELL_STAND_INSET) * (Math.abs(shape.acrossX) + Math.abs(shape.acrossZ));

  return drawnReach(halfWidth) + standingReach;
}

function channelBed(distanceFromCenter: number, point: RiverPoint): number {
  const halfWidth = point.width / 2;

  if (distanceFromCenter >= halfWidth) {
    return point.surface - SHORE_DEPTH * point.depth;
  }

  const across = distanceFromCenter / halfWidth;

  return point.surface - point.depth * (1 - across * across * 0.7);
}

function riverBed(distanceFromCenter: number, point: RiverPoint): number {
  const deep = channelBed(distanceFromCenter, point);
  const drawnEdge = drawnRiverHalfWidth(point.width / 2);
  const rim = smoothstep(drawnEdge, drawnEdge + RIM_EASING, distanceFromCenter);

  return lerp(deep, Math.max(deep, point.surface - RIM_DEPTH), rim);
}

function easedCut(cut: number, deepest: number): number {
  const start = deepest - WALL_CUT_EASING;

  if (cut <= start) {
    return cut;
  }

  if (cut >= deepest + WALL_CUT_EASING) {
    return deepest;
  }

  return cut - ((cut - start) * (cut - start)) / (4 * WALL_CUT_EASING);
}

function softRamp(amount: number): number {
  if (amount >= WALL_FOOT) {
    return amount;
  }

  if (amount <= -WALL_FOOT) {
    return 0;
  }

  return ((amount + WALL_FOOT) * (amount + WALL_FOOT)) / (4 * WALL_FOOT);
}

function smoothMinimum(first: number, second: number): number {
  const overlap = Math.max(WALL_BLEND - Math.abs(first - second), 0) / WALL_BLEND;

  return Math.min(first, second) - (overlap * overlap * WALL_BLEND) / 4;
}

function wallHeight(
  distanceFromCenter: number,
  floorReach: number,
  point: RiverPoint,
  shape: CellShape,
  uncarvedHeight: number
): number {
  const wallStart = floorReach + WALL_FOOT;
  const wall = shape.footSurface + BANK_FREEBOARD + shape.wallSlope * softRamp(distanceFromCenter - wallStart);
  const floorShare = 1 - smoothstep(floorReach, floorReach + FLOOR_CUT_REACH, distanceFromCenter);
  const deepest = DEEPEST_WALL_CUT + Math.max(0, shape.floorCut - DEEPEST_WALL_CUT) * floorShare;
  const cut = easedCut(Math.max(0, uncarvedHeight - smoothMinimum(uncarvedHeight, wall)), deepest);
  const fade = 1 - saturate((distanceFromCenter - point.width / 2 - WALL_REACH) / WALL_FADE);

  return uncarvedHeight - Math.max(0, smoothMinimum(cut, deepest * fade));
}

function sideRise(targets: ChannelTargets, point: RiverPoint, acrossX: number, acrossZ: number): number {
  const { coastDistance, grid, uncarvedHeights } = targets;

  const reach = point.width / 2 + WALL_SLOPE_REACH;
  const cell = grid.cellAt(point.x + acrossX * reach, point.z + acrossZ * reach);

  if (cell < 0 || !isOnIsland(coastDistance, cell)) {
    return 0;
  }

  return Math.max(0, uncarvedHeights[cell] - point.surface) / reach;
}

function floorReachOf(grid: WorldGrid, halfWidth: number): number {
  return drawnReach(halfWidth) + grid.cellSize * FLOOR_CELLS;
}

function landAcross(
  targets: ChannelTargets,
  point: RiverPoint,
  acrossX: number,
  acrossZ: number,
  reach: number
): number {
  const { coastDistance, grid, uncarvedHeights } = targets;

  const cell = grid.cellAt(point.x + acrossX * reach, point.z + acrossZ * reach);

  return cell < 0 || !isOnIsland(coastDistance, cell) ? Number.NaN : uncarvedHeights[cell];
}

function floorCut(targets: ChannelTargets, point: RiverPoint, acrossX: number, acrossZ: number): number {
  const reach = floorReachOf(targets.grid, point.width / 2);
  const edge = landAcross(targets, point, acrossX, acrossZ, reach);
  const beyond = landAcross(targets, point, acrossX, acrossZ, reach + FLOOR_CUT_PROBE);

  if (Number.isNaN(edge) || Number.isNaN(beyond)) {
    return DEEPEST_WALL_CUT;
  }

  const room = 1 - smoothstep(ROOMY_LAND_RISE, CRAMPED_LAND_RISE, (beyond - edge) / FLOOR_CUT_PROBE);
  const needed = edge - point.surface - BANK_FREEBOARD + FLOOR_CUT_SLACK;

  return DEEPEST_WALL_CUT + Math.max(0, needed - DEEPEST_WALL_CUT) * room;
}

function wallSide(targets: ChannelTargets, points: readonly RiverPoint[], side: number): WallSide {
  const rises = new Float64Array(points.length);
  const cuts = new Float64Array(points.length);

  for (const [index, point] of points.entries()) {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const length = Math.max(1e-6, Math.hypot(after.x - before.x, after.z - before.z));
    const acrossX = (-(after.z - before.z) / length) * side;
    const acrossZ = ((after.x - before.x) / length) * side;

    rises[index] = sideRise(targets, point, acrossX, acrossZ);
    cuts[index] = floorCut(targets, point, acrossX, acrossZ);
  }

  const spread = WALL_SLOPE_SPREAD / WALL_SLOPE_SPACING;

  return {
    floorCuts: smoothPinned(cuts, spread).map((cut) => {
      return clamp(cut, DEEPEST_WALL_CUT, DEEPEST_FLOOR_CUT);
    }),
    slopes: smoothPinned(rises, spread).map((rise) => {
      return clamp(rise + WALL_SLOPE_LIFT, GENTLEST_WALL, STEEPEST_WALL);
    }),
  };
}

function riverWalls(targets: ChannelTargets, points: readonly RiverPoint[]): RiverWalls {
  return { left: wallSide(targets, points, 1), right: wallSide(targets, points, -1) };
}

function createChannelSamples(cellCount: number): ChannelSamples {
  return {
    alongs: new Float64Array(cellCount),
    cells: [],
    distances: new Float64Array(cellCount).fill(Number.POSITIVE_INFINITY),
    footSurfaces: new Float64Array(cellCount),
    footWeights: new Float64Array(cellCount),
    segments: new Int32Array(cellCount),
  };
}

function visitSegment(
  grid: WorldGrid,
  points: readonly RiverPoint[],
  segment: number,
  visit: (cell: number, distance: number, along: number) => void
): void {
  const start = points[segment];
  const end = points[segment + 1];

  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;

  const reach = Math.max(start.width, end.width) / 2 + WALL_REACH + WALL_FADE + grid.cellSize;
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

      visit(grid.index(column, row), distance, along);
    }
  }
}

function sampleSegment(grid: WorldGrid, points: readonly RiverPoint[], segment: number, samples: ChannelSamples): void {
  const { alongs, cells, distances, segments } = samples;

  visitSegment(grid, points, segment, (cell, distance, along) => {
    if (distance >= distances[cell]) {
      return;
    }

    if (distances[cell] === Number.POSITIVE_INFINITY) {
      cells.push(cell);
    }

    alongs[cell] = along;
    distances[cell] = distance;
    segments[cell] = segment;
  });
}

function blendFeet(grid: WorldGrid, points: readonly RiverPoint[], segment: number, samples: ChannelSamples): void {
  const { distances, footSurfaces, footWeights } = samples;

  const start = points[segment];
  const end = points[segment + 1];

  visitSegment(grid, points, segment, (cell, distance, along) => {
    const farther = distance - distances[cell];

    if (farther > WALL_FOOT_CUTOFF) {
      return;
    }

    const weight = Math.exp(-farther / WALL_FOOT_SOFTNESS);

    footSurfaces[cell] += weight * (start.surface + (end.surface - start.surface) * along);
    footWeights[cell] += weight;
  });
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
  shape: CellShape
): void {
  const halfWidth = sampled.width / 2;
  const wetReach = shape.isRiver
    ? riverWetReach(targets.grid, halfWidth, shape)
    : Math.max(halfWidth, targets.grid.cellSize * DIAGONAL_REACH);
  const channelReach = Math.max(halfWidth + bankWidthOf(sampled), wetReach);

  if (distanceFromCenter > halfWidth + WALL_REACH + WALL_FADE) {
    return;
  }

  if (!(shape.isPastCoast || isOnIsland(targets.coastDistance, cell))) {
    return;
  }

  const uncarvedHeight = targets.uncarvedHeights[cell];

  const point = shape.isPastCoast || shape.isRiver ? sampled : settledOnGround(sampled, uncarvedHeight);
  const isUnderWater =
    distanceFromCenter <= wetReach ||
    (distanceFromCenter <= channelReach && uncarvedHeight < point.surface - SHALLOWEST_WATER);

  if (!isUnderWater) {
    const floorReach = floorReachOf(targets.grid, halfWidth);
    const wall = wallHeight(distanceFromCenter, floorReach, point, shape, uncarvedHeight);
    const floor = Math.max(point.surface, shape.floorSurface) + BANK_FREEBOARD;

    targets.sideCuts[cell] = Math.min(targets.sideCuts[cell], Math.max(wall, floor));

    if (distanceFromCenter <= floorReach) {
      targets.sideFloors[cell] = Math.max(targets.sideFloors[cell], floor);
    }

    return;
  }

  const bed = shape.isRiver
    ? riverBed(distanceFromCenter, point)
    : Math.min(channelBed(distanceFromCenter, point), point.surface - point.depth * BANK_DEPTH);

  targets.heights[cell] = Math.min(targets.heights[cell], bed);

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

function wallSideOf(walls: RiverWalls | null, isLeft: boolean): WallSide | null {
  if (walls === null) {
    return null;
  }

  return isLeft ? walls.left : walls.right;
}

function alongSide(values: Float64Array, segment: number, along: number): number {
  return values[segment] + (values[segment + 1] - values[segment]) * along;
}

function highestSurfaceAlong(points: readonly RiverPoint[], segment: number, point: RiverPoint, reach: number): number {
  let highest = point.surface;

  for (const step of [-1, 1]) {
    for (let index = step < 0 ? segment : segment + 1; index >= 0 && index < points.length; index += step) {
      const near = points[index];

      if (Math.hypot(near.x - point.x, near.z - point.z) > reach) {
        break;
      }

      highest = Math.max(highest, near.surface);
    }
  }

  return highest;
}

function carveChannel(
  targets: ChannelTargets,
  samples: ChannelSamples,
  points: readonly RiverPoint[],
  channel: ChannelKind
): void {
  const { alongs, cells, distances, footSurfaces, footWeights, segments } = samples;

  const walls = channel.isRiver ? riverWalls(targets, points) : null;

  for (let segment = 0; segment < points.length - 1; segment += 1) {
    sampleSegment(targets.grid, points, segment, samples);
  }

  for (let segment = 0; segment < points.length - 1; segment += 1) {
    blendFeet(targets.grid, points, segment, samples);
  }

  for (const cell of cells) {
    const segment = segments[cell];
    const along = alongs[cell];
    const start = points[segment];
    const end = points[segment + 1];
    const point = interpolatePoint(start, end, along);
    const isLeft =
      (end.x - start.x) * (targets.grid.cellCenterZ(cell) - start.z) -
        (end.z - start.z) * (targets.grid.cellCenterX(cell) - start.x) >
      0;
    const side = wallSideOf(walls, isLeft);
    const distance = Math.max(distances[cell], 1e-6);

    carveCell(targets, cell, distances[cell], point, {
      acrossX: (targets.grid.cellCenterX(cell) - point.x) / distance,
      acrossZ: (targets.grid.cellCenterZ(cell) - point.z) / distance,
      floorCut: side === null ? DEEPEST_WALL_CUT : alongSide(side.floorCuts, segment, along),
      floorSurface: highestSurfaceAlong(points, segment, point, targets.grid.cellSize / 2),
      footSurface: footWeights[cell] > 0 ? footSurfaces[cell] / footWeights[cell] : point.surface,
      isPastCoast: segment === channel.coastSegment,
      isRiver: channel.isRiver,
      wallSlope: side === null ? GENTLEST_WALL : alongSide(side.slopes, segment, along),
    });
    distances[cell] = Number.POSITIVE_INFINITY;
    footSurfaces[cell] = 0;
    footWeights[cell] = 0;
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
    carveChannel(targets, samples, river.points, { coastSegment: pastCoastSegment(targets, river), isRiver: true });
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

function waterFloorBeside(targets: ChannelTargets, cell: number): number {
  const { grid, heights, riverStrength, waterSurface } = targets;

  const column = grid.columnOf(cell);
  const row = grid.rowOf(cell);

  let highestStanding = Number.NEGATIVE_INFINITY;
  let lowestRiver = Number.POSITIVE_INFINITY;

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighbor = grid.neighborIndex(column, row, offset);

    if (neighbor < 0 || !hasWater(waterSurface[neighbor], heights[neighbor])) {
      continue;
    }

    if (riverStrength[neighbor] > 0) {
      lowestRiver = Math.min(lowestRiver, waterSurface[neighbor]);
    } else {
      highestStanding = Math.max(highestStanding, waterSurface[neighbor]);
    }
  }

  return Math.max(highestStanding, Number.isFinite(lowestRiver) ? lowestRiver : Number.NEGATIVE_INFINITY);
}

function applySideCuts(targets: ChannelTargets): void {
  const { heights, sideCuts, sideFloors, waterSurface } = targets;

  for (let cell = 0; cell < sideCuts.length; cell += 1) {
    const cut = sideCuts[cell];

    if (cut === Number.POSITIVE_INFINITY || hasWater(waterSurface[cell], heights[cell])) {
      continue;
    }

    heights[cell] = Math.min(heights[cell], Math.max(cut, sideFloors[cell], waterFloorBeside(targets, cell)));
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
    carveChannel(targets, samples, channel, { coastSegment: NO_CELL, isRiver: false });
  }

  for (const spring of springs) {
    if (spring.kind === "pond") {
      carvePond(targets, spring);
    }
  }

  applySideCuts(targets);
  keepRiversDescending(targets, rivers);
  dropShallowWater(targets.heights, targets.waterSurface, targets.riverStrength);
  fillPinchedBanks(targets);
}
