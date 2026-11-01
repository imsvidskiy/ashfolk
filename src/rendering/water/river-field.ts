import {
  abs,
  cameraPosition,
  cameraProjectionMatrix,
  cos,
  exp,
  Fn,
  float,
  If,
  ivec2,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  screenSize,
  select,
  sin,
  smoothstep,
  textureLoad,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { type DataTexture, type Node, RGBAFormat } from "three/webgpu";
import { lookUpCell } from "../../world/terrain-sampling.ts";
import {
  DRAWN_RIVER_EDGE_WOBBLE,
  DRAWN_RIVER_WIDTH_SCALE,
  drawnRiverHalfWidth,
  hasWater,
  NARROWEST_DRAWN_RIVER_HALF_WIDTH,
  RIVER_LINE_STRIDE,
  type RiverLines,
  WIDEST_DRAWN_RIVER_WIDENING,
} from "../../world/water.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../../world/world-grid.ts";
import { cellByteTexture } from "../data-textures.ts";
import { BANK_SINK } from "./shore-field.ts";

const RIVER_FIELD_REACH = 24;
const NO_RIVER_EDGE = -RIVER_FIELD_REACH;

const CHANNELS = 4;
const BYTE = 255;
const OFFSET_SCALE = 127.5 / RIVER_FIELD_REACH;
const ANGLE_STEPS = 126;
const END_CAP = 127;
const RIVER_CELL_FLAG = 128;
const HALF_WIDTH_STEP = 0.25;
const WIDEST_HALF_WIDTH_CODE = 63;
const NEAR_STANDING_FLAG = 64;
const STANDING_FLAG = 128;
const BLEND_SOFTNESS = 1.5;
const TANGENT_REACH = 7.5;
const DRIED_REACH_CELLS = 2;
const EDGE_DEPTH_SLOPE = 0.45;
const DEPTH_AT_CENTER = 0.6;
const DEPTH_PER_HALF_WIDTH = 0.25;
const MOUTH_DEPTH = 0.7;
const NARROWEST_SCREEN_HALF_WIDTH = 4;
const NARROWEST_SCREEN_MARGIN = 2.5;
const FAR_DEPTH_GAIN = 2;
const FAR_DEPTH_START = 0.2;
const FAR_DEPTH_FULL = 1.2;
const EDGE_WOBBLE_SCALE = 0.11;
const MARGIN_AT_NARROWEST = 1.4;
const MARGIN_PER_HALF_WIDTH = 0.12;
const MARGIN_WOBBLE = 0.45;
const MARGIN_WOBBLE_SCALE = 0.06;
const MARGIN_SOFTNESS = 0.45;
const FLATTEST_VIEW = 0.15;

export interface RiverWaterSource {
  readonly height: Float32Array;
  readonly riverStrength: Uint8Array;
  readonly waterSurface: Float32Array;
}

export interface ShoreDepths {
  readonly data: Float32Array;
  readonly stride: number;
  readonly texture: DataTexture;
}

export interface RiverSample {
  readonly edge: number;
  readonly halfWidth: number;
  readonly hasRiver: boolean;
}

interface StandingSample {
  readonly lakeBank: number;
  readonly lakeWet: number;
  readonly nearShare: number;
  readonly shoreDepth: number;
  readonly standingShare: number;
}

export interface RiverNode {
  readonly edge: Node<"float">;
  readonly halfWidth: Node<"float">;
  readonly hasRiver: Node<"bool">;
  readonly lakeBank: Node<"float">;
  readonly lakeWet: Node<"float">;
  readonly nearShare: Node<"float">;
  readonly shoreDepth: Node<"float">;
  readonly standingShare: Node<"float">;
}

interface Segment {
  readonly endCap: number;
  readonly from: number;
  readonly startCap: number;
}

interface CornerSample {
  readonly edge: number;
  readonly halfWidth: number;
  readonly weight: number;
}

function encodeOffset(offset: number): number {
  return Math.round(Math.min(Math.max(offset * OFFSET_SCALE + 127.5, 0), BYTE));
}

function decodeOffset(code: number): number {
  return (code - 127.5) / OFFSET_SCALE;
}

function encodeAngle(directionX: number, directionZ: number): number {
  const angle = Math.atan2(directionZ, directionX);
  const folded = angle < 0 ? angle + Math.PI : angle;

  return Math.round((folded / Math.PI) * ANGLE_STEPS) % (ANGLE_STEPS + 1);
}

function writeNearest(
  grid: WorldGrid,
  lines: RiverLines,
  segment: Segment,
  nearest: Float32Array,
  target: Uint8Array
): void {
  const { points } = lines;
  const { endCap, from, startCap } = segment;

  const startX = points[from * RIVER_LINE_STRIDE];
  const startZ = points[from * RIVER_LINE_STRIDE + 1];
  const startHalfWidth = points[from * RIVER_LINE_STRIDE + 2];
  const endX = points[(from + 1) * RIVER_LINE_STRIDE];
  const endZ = points[(from + 1) * RIVER_LINE_STRIDE + 1];
  const endHalfWidth = points[(from + 1) * RIVER_LINE_STRIDE + 2];

  const segmentX = endX - startX;
  const segmentZ = endZ - startZ;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;

  if (lengthSquared < 1e-6) {
    return;
  }

  const angle = encodeAngle(segmentX, segmentZ);
  const last = grid.cellsPerSide - 1;
  const firstColumn = Math.max(0, grid.columnAt(Math.min(startX, endX) - RIVER_FIELD_REACH));
  const lastColumn = Math.min(last, grid.columnAt(Math.max(startX, endX) + RIVER_FIELD_REACH));
  const firstRow = Math.max(0, grid.rowAt(Math.min(startZ, endZ) - RIVER_FIELD_REACH));
  const lastRow = Math.min(last, grid.rowAt(Math.max(startZ, endZ) + RIVER_FIELD_REACH));

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const x = grid.centerX(column);
      const z = grid.centerZ(row);
      const cell = grid.index(column, row);

      const along = Math.min(Math.max(((x - startX) * segmentX + (z - startZ) * segmentZ) / lengthSquared, 0), 1);
      const nearestX = startX + segmentX * along;
      const nearestZ = startZ + segmentZ * along;
      const distance = Math.hypot(x - nearestX, z - nearestZ);

      if (distance >= nearest[cell] || distance > RIVER_FIELD_REACH) {
        continue;
      }

      const isCap = (along <= 0 && startCap === 1) || (along >= 1 && endCap === 1);
      const halfWidth = startHalfWidth + (endHalfWidth - startHalfWidth) * along;
      const offset = cell * CHANNELS;

      nearest[cell] = distance;
      target[offset] = encodeOffset(nearestX - x);
      target[offset + 1] = encodeOffset(nearestZ - z);
      target[offset + 2] = isCap ? END_CAP : angle;
      target[offset + 3] = Math.min(Math.max(1, Math.round(halfWidth / HALF_WIDTH_STEP)), WIDEST_HALF_WIDTH_CODE);
    }
  }
}

function isStandingWater(source: RiverWaterSource, cell: number): boolean {
  return source.riverStrength[cell] === 0 && hasWater(source.waterSurface[cell], source.height[cell]);
}

function flagCell(target: Uint8Array, cell: number, flag: number): void {
  if (Math.floor(target[cell * CHANNELS + 3] / flag) % 2 === 0) {
    target[cell * CHANNELS + 3] += flag;
  }
}

function markStandingWater(grid: WorldGrid, source: RiverWaterSource, target: Uint8Array): void {
  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!isStandingWater(source, cell)) {
      continue;
    }

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    flagCell(target, cell, STANDING_FLAG);
    flagCell(target, cell, NEAR_STANDING_FLAG);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor >= 0) {
        flagCell(target, neighbor, NEAR_STANDING_FLAG);
      }
    }
  }
}

function isRiverWater(source: RiverWaterSource, cell: number): boolean {
  return source.riverStrength[cell] > 0 && hasWater(source.waterSurface[cell], source.height[cell]);
}

function widenedOnce(grid: WorldGrid, cells: Uint8Array): Uint8Array {
  const widened = Uint8Array.from(cells);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (cells[cell] === 0) {
      continue;
    }

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(grid.columnOf(cell), grid.rowOf(cell), offset);

      if (neighbor >= 0) {
        widened[neighbor] = 1;
      }
    }
  }

  return widened;
}

function dropDriedRivers(grid: WorldGrid, source: RiverWaterSource, target: Uint8Array): void {
  let near: Uint8Array = Uint8Array.from({ length: grid.cellCount }, (_, cell) => {
    return isRiverWater(source, cell) ? 1 : 0;
  });

  for (let pass = 0; pass < DRIED_REACH_CELLS; pass += 1) {
    near = widenedOnce(grid, near);
  }

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (near[cell] === 0) {
      target.fill(0, cell * CHANNELS, (cell + 1) * CHANNELS);
    }
  }
}

function markRiverCells(grid: WorldGrid, source: RiverWaterSource, target: Uint8Array): void {
  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (isRiverWater(source, cell)) {
      target[cell * CHANNELS + 2] += RIVER_CELL_FLAG;
    }
  }
}

export function buildRiverField(
  grid: WorldGrid,
  lines: RiverLines,
  source: RiverWaterSource,
  target: Uint8Array
): void {
  const nearest = new Float32Array(grid.cellCount).fill(Number.POSITIVE_INFINITY);

  target.fill(0);

  let first = 0;

  for (const end of lines.ends) {
    for (let from = first; from < end - 1; from += 1) {
      const segment = { endCap: from === end - 2 ? 1 : 0, from, startCap: from === first ? 1 : 0 };

      writeNearest(grid, lines, segment, nearest, target);
    }

    first = end;
  }

  dropDriedRivers(grid, source, target);
  markRiverCells(grid, source, target);
  markStandingWater(grid, source, target);
}

function cornerSample(
  grid: WorldGrid,
  field: Uint8Array,
  corner: readonly [number, number, number],
  point: { readonly x: number; readonly z: number }
): CornerSample | null {
  const [column, row, share] = corner;

  const offset = grid.index(column, row) * CHANNELS;
  const widthCode = field[offset + 3] % NEAR_STANDING_FLAG;

  if (widthCode === 0) {
    return null;
  }

  const towardX = point.x - (grid.centerX(column) + decodeOffset(field[offset]));
  const towardZ = point.z - (grid.centerZ(row) + decodeOffset(field[offset + 1]));
  const angleCode = field[offset + 2] % RIVER_CELL_FLAG;
  const angle = (angleCode / ANGLE_STEPS) * Math.PI;
  const across = towardX * Math.sin(angle) - towardZ * Math.cos(angle);
  const along = towardX * Math.cos(angle) + towardZ * Math.sin(angle);
  const distance =
    angleCode === END_CAP
      ? Math.hypot(towardX, towardZ)
      : Math.hypot(across, Math.max(Math.abs(along) - TANGENT_REACH, 0));
  const halfWidth = widthCode * HALF_WIDTH_STEP;

  return { edge: drawnRiverHalfWidth(halfWidth) - distance, halfWidth, weight: share };
}

function cornersAround(grid: WorldGrid, x: number, z: number): (readonly [number, number, number])[] {
  const { amountX, amountZ, column, row } = lookUpCell(grid, x, z);

  return [
    [column, row, (1 - amountX) * (1 - amountZ)],
    [column + 1, row, amountX * (1 - amountZ)],
    [column, row + 1, (1 - amountX) * amountZ],
    [column + 1, row + 1, amountX * amountZ],
  ];
}

function standingAt(grid: WorldGrid, field: Uint8Array, shore: ShoreDepths, x: number, z: number): StandingSample {
  let lakeBank = 0;
  let lakeWet = 0;
  let nearShare = 0;
  let shoreDepth = 0;
  let standingShare = 0;

  for (const [column, row, share] of cornersAround(grid, x, z)) {
    const cell = grid.index(column, row);
    const flags = field[cell * CHANNELS + 3];
    const depth = shore.data[cell * shore.stride];
    const isRiverCell = field[cell * CHANNELS + 2] >= RIVER_CELL_FLAG;

    lakeBank += share * (isRiverCell ? Math.min(depth, 0) - BANK_SINK : depth);
    lakeWet += share * (isRiverCell ? Math.min(depth, MOUTH_DEPTH) : depth);
    nearShare += flags % STANDING_FLAG >= NEAR_STANDING_FLAG ? share : 0;
    shoreDepth += share * depth;
    standingShare += flags >= STANDING_FLAG ? share : 0;
  }

  return { lakeBank, lakeWet, nearShare, shoreDepth, standingShare };
}

export function sampleRiverField(grid: WorldGrid, field: Uint8Array, x: number, z: number): RiverSample {
  const corners = cornersAround(grid, x, z);
  const samples = corners.flatMap((corner) => {
    const sample = cornerSample(grid, field, corner, { x, z });

    return sample === null ? [] : [sample];
  });

  if (samples.length === 0) {
    return { edge: NO_RIVER_EDGE, halfWidth: 0, hasRiver: false };
  }

  const deepest = Math.max(
    ...samples.map((sample) => {
      return sample.edge;
    })
  );

  let edge = 0;
  let halfWidth = 0;
  let total = 0;

  for (const sample of samples) {
    const weight = sample.weight * Math.exp((sample.edge - deepest) / BLEND_SOFTNESS);

    edge += sample.edge * weight;
    halfWidth += sample.halfWidth * weight;
    total += weight;
  }

  if (total === 0) {
    return { edge: NO_RIVER_EDGE, halfWidth: 0, hasRiver: true };
  }

  return { edge: edge / total, halfWidth: halfWidth / total, hasRiver: true };
}

function waterDepthWith(sample: RiverSample, standing: StandingSample, cellDepth: number): number {
  const deepest = sample.halfWidth * DEPTH_PER_HALF_WIDTH + DEPTH_AT_CENTER;
  const riverDepth = Math.min(sample.edge * EDGE_DEPTH_SLOPE, deepest);

  if (standing.nearShare > 0) {
    const wobble = cellDepth - standing.shoreDepth;
    const nearRiver = riverDepth + (Math.min(riverDepth, MOUTH_DEPTH) - riverDepth) * standing.nearShare;
    const lakeWet = standing.lakeWet + wobble;

    return Math.max(standing.lakeBank + wobble, nearRiver + (lakeWet - nearRiver) * standing.standingShare);
  }

  return sample.hasRiver ? riverDepth : cellDepth;
}

export function groundFootprintNode(): Node<"float"> {
  const toCamera = cameraPosition.sub(positionWorld);
  const focal = cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y;
  const pixelAngle = float(2).div(focal.mul(screenSize.y));

  return length(toCamera)
    .mul(pixelAngle)
    .div(max(abs(normalize(toCamera).y), FLATTEST_VIEW));
}

function drawnHalfWidthNode(halfWidth: Node<"float">): Node<"float"> {
  const widening = min(halfWidth.mul(DRAWN_RIVER_WIDTH_SCALE - 1), WIDEST_DRAWN_RIVER_WIDENING);

  return max(halfWidth.add(widening), NARROWEST_DRAWN_RIVER_HALF_WIDTH);
}

function wideningFarAway(river: RiverNode, metersPerPixel: Node<"float">): Node<"float"> {
  return max(metersPerPixel.mul(NARROWEST_SCREEN_HALF_WIDTH).sub(drawnHalfWidthNode(river.halfWidth)), 0);
}

function depthFrom(
  river: RiverNode,
  point: Node<"vec2">,
  cellDepth: Node<"float">,
  metersPerPixel: Node<"float">
): Node<"float"> {
  const widening = wideningFarAway(river, metersPerPixel);
  const wobble = mx_noise_float(vec3(point.mul(EDGE_WOBBLE_SCALE), 6.3)).mul(DRAWN_RIVER_EDGE_WOBBLE);
  const deepest = river.halfWidth.mul(DEPTH_PER_HALF_WIDTH).add(widening.mul(EDGE_DEPTH_SLOPE)).add(DEPTH_AT_CENTER);
  const deepening = smoothstep(FAR_DEPTH_START, FAR_DEPTH_FULL, metersPerPixel).mul(FAR_DEPTH_GAIN).add(1);
  const riverDepth = min(river.edge.add(widening).add(wobble).mul(EDGE_DEPTH_SLOPE), deepest).mul(deepening);

  const shoreWobble = cellDepth.sub(river.shoreDepth);
  const nearRiver = mix(riverDepth, min(riverDepth, MOUTH_DEPTH), river.nearShare);
  const nearDepth = max(
    river.lakeBank.add(shoreWobble),
    mix(nearRiver, river.lakeWet.add(shoreWobble), river.standingShare)
  );

  return select(river.nearShare.greaterThan(0), nearDepth, select(river.hasRiver, riverDepth, cellDepth));
}

export class RiverField {
  readonly texture: DataTexture;
  readonly #data: Uint8Array;
  readonly #grid: WorldGrid;
  readonly #shore: ShoreDepths;

  constructor(grid: WorldGrid, lines: RiverLines, source: RiverWaterSource, shore: ShoreDepths) {
    this.#grid = grid;
    this.#shore = shore;
    this.#data = new Uint8Array(grid.cellCount * CHANNELS);
    this.texture = cellByteTexture(this.#data, grid.cellsPerSide, RGBAFormat);
    this.rebuild(lines, source);
  }

  rebuild(lines: RiverLines, source: RiverWaterSource): void {
    buildRiverField(this.#grid, lines, source, this.#data);
    this.texture.needsUpdate = true;
  }

  depthAt(x: number, z: number, cellDepth: number): number {
    const sample = sampleRiverField(this.#grid, this.#data, x, z);

    return waterDepthWith(sample, standingAt(this.#grid, this.#data, this.#shore, x, z), cellDepth);
  }

  isNearStandingNode(cell: Node<"ivec2">): Node<"bool"> {
    return textureLoad(this.texture, cell)
      .w.mul(BYTE)
      .round()
      .mod(STANDING_FLAG)
      .greaterThan(NEAR_STANDING_FLAG - 0.5);
  }

  sampleNode(point: Node<"vec2">): RiverNode {
    const grid = this.#grid;
    const last = grid.cellsPerSide - 1;
    const cellCoordinate = point.add(grid.halfSize).div(grid.cellSize).sub(0.5);
    const base = cellCoordinate.floor();
    const fraction = cellCoordinate.sub(base);

    const corners = [
      [0, 0, float(1).sub(fraction.x).mul(float(1).sub(fraction.y))],
      [1, 0, fraction.x.mul(float(1).sub(fraction.y))],
      [0, 1, float(1).sub(fraction.x).mul(fraction.y)],
      [1, 1, fraction.x.mul(fraction.y)],
    ] as const;

    const samples = corners.map(([column, row, share]) => {
      const cell = base.add(vec2(column, row)).clamp(vec2(0, 0), vec2(last, last));
      const texel = textureLoad(this.texture, ivec2(cell)).mul(BYTE).round();
      const depth = textureLoad(this.#shore.texture, ivec2(cell)).x;

      const widthCode = texel.w.mod(NEAR_STANDING_FLAG);
      const isRiverCell = texel.z.greaterThanEqual(RIVER_CELL_FLAG);
      const hasRiver = widthCode.greaterThan(0.5);

      const center = cell.add(0.5).mul(grid.cellSize).sub(grid.halfSize);
      const nearest = center.add(texel.xy.sub(127.5).div(OFFSET_SCALE));
      const toward = point.sub(nearest);
      const angleCode = texel.z.mod(RIVER_CELL_FLAG);
      const angle = angleCode.mul(Math.PI / ANGLE_STEPS);
      const across = toward.x.mul(sin(angle)).sub(toward.y.mul(cos(angle)));
      const along = toward.x.mul(cos(angle)).add(toward.y.mul(sin(angle)));
      const lineDistance = length(vec2(across, max(abs(along).sub(TANGENT_REACH), 0)));
      const distance = select(angleCode.greaterThan(END_CAP - 0.5), length(toward), lineDistance);
      const halfWidth = widthCode.mul(HALF_WIDTH_STEP);
      const edge = drawnHalfWidthNode(halfWidth).sub(distance);

      return {
        edge,
        halfWidth,
        hasRiver,
        lakeBank: share.mul(select(isRiverCell, min(depth, 0).sub(BANK_SINK), depth)),
        lakeWet: share.mul(select(isRiverCell, min(depth, MOUTH_DEPTH), depth)),
        nearShare: select(texel.w.mod(STANDING_FLAG).greaterThanEqual(NEAR_STANDING_FLAG), share, float(0)),
        share: select(hasRiver, share, float(0)),
        shoreDepth: share.mul(depth),
        standingShare: select(texel.w.greaterThanEqual(STANDING_FLAG), share, float(0)),
      };
    });

    const deepest = samples.reduce<Node<"float">>(
      (top, sample) => {
        return max(top, select(sample.hasRiver, sample.edge, float(NO_RIVER_EDGE * 4)));
      },
      float(NO_RIVER_EDGE * 4)
    );

    const blended = Fn(() => {
      const edge = float(0).toVar();
      const halfWidth = float(0).toVar();
      const total = float(0).toVar();

      for (const sample of samples) {
        const weight = sample.share.mul(exp(min(sample.edge.sub(deepest), 0).div(BLEND_SOFTNESS)));

        edge.addAssign(sample.edge.mul(weight));
        halfWidth.addAssign(sample.halfWidth.mul(weight));
        total.addAssign(weight);
      }

      const result = vec2(NO_RIVER_EDGE, 0).toVar();

      If(total.greaterThan(0), () => {
        result.assign(vec2(edge.div(total), halfWidth.div(total)));
      });

      return result;
    })();

    const [first, ...others] = samples;

    const hasRiver = others.reduce<Node<"bool">>((any, sample) => {
      return any.or(sample.hasRiver);
    }, first.hasRiver);

    function summed(key: "lakeBank" | "lakeWet" | "nearShare" | "shoreDepth" | "standingShare"): Node<"float"> {
      return others.reduce<Node<"float">>((sum, sample) => {
        return sum.add(sample[key]);
      }, first[key]);
    }

    return {
      edge: blended.x,
      halfWidth: blended.y,
      hasRiver,
      lakeBank: summed("lakeBank"),
      lakeWet: summed("lakeWet"),
      nearShare: summed("nearShare"),
      shoreDepth: summed("shoreDepth"),
      standingShare: summed("standingShare"),
    };
  }

  depthNode(point: Node<"vec2">, cellDepth: Node<"float">, metersPerPixel: Node<"float">): Node<"float"> {
    return depthFrom(this.sampleNode(point), point, cellDepth, metersPerPixel);
  }

  bedNode(point: Node<"vec2">, cellDepth: Node<"float">, metersPerPixel: Node<"float">): Node<"vec2"> {
    const river = this.sampleNode(point);

    const widening = wideningFarAway(river, metersPerPixel);
    const wobble = mx_noise_float(vec3(point.mul(MARGIN_WOBBLE_SCALE), 2.1))
      .mul(MARGIN_WOBBLE)
      .add(1);
    const margin = max(
      river.halfWidth.mul(MARGIN_PER_HALF_WIDTH).add(MARGIN_AT_NARROWEST).mul(wobble),
      metersPerPixel.mul(NARROWEST_SCREEN_MARGIN)
    );
    const edge = river.edge.add(widening);
    const sand = smoothstep(margin.negate().sub(MARGIN_SOFTNESS), margin.negate().add(MARGIN_SOFTNESS), edge);

    return vec2(depthFrom(river, point, cellDepth, metersPerPixel), select(river.hasRiver, sand, float(0)));
  }

  dispose(): void {
    this.texture.dispose();
  }
}
