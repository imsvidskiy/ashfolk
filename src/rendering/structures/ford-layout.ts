import { FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import {
  crossingDirection,
  crossingLength,
  type Ford,
  type Point,
  pointOnCrossing,
  STEPPING_STONE_VARIANTS,
  STONE_RISE,
} from "../../world/crossings.ts";
import { NO_WATER } from "../../world/water.ts";

export const LARGEST_STEP_GAP = 0.5;
export const STONE_SINK = 0.3;
export const BAR_SHALLOWEST = 0.28;
export const SIDE_DEEPEST = 0.7;
export const SLAB_LARGEST_SHARE = 1.1;
const BAR_DEEPEST = 0.5;
const BAR_FOOT = 2.6;
const BAR_ACROSS: readonly number[] = [-BAR_FOOT, -2, -1.4, -0.7, 0, 0.7, 1.4, 2, BAR_FOOT];

const SCAN_STEP = 0.25;
const BEYOND_ENDS = 4;
const BANK_OVERLAP = 0.5;
const NEAR_BANK = 4;
const BANK_RADIUS = 0.9;
const MIDSTREAM_RADIUS = 0.45;
const RADIUS_SPREAD = 0.5;
const SMALLEST_GAP = 0.18;
const ACROSS_JITTER = 0.12;
const MEANDER = 0.22;
const LIFT_JITTER = 0.08;
const COMPANION_CHANCE = 0.3;
const COMPANION_SIZE = 0.55;
const COMPANION_SINKING = 0.07;
const SHORTEST_STEP = 0.14;
const SLAB_RISE = 0.12;
const SLAB_RISE_SPREAD = 0.07;
const SLAB_STEEPEST = 0.6;
const BAR_NARROWEST = 0.9;
const BAR_WIDEST = 1.5;
const BAR_SIDE_DROP = 2.6;
const BAR_BURIAL = 0.3;
const BAR_ROW_STEP = 0.5;
const BAR_OVERHANG = 1;
const SIDE_CHANCE = 0.6;
const SIDE_NEAREST = 1.1;
const SIDE_SPREAD = 1.1;
const SIDE_SMALLEST = 0.24;
const SIDE_LARGEST = 0.55;
const SIDE_RISE = 0.12;
const SIDE_EMERGING = 0.03;
const SIDE_SHORTEST = 0.12;
const STONE_SALT = 41.7;
const SIDE_SALT = 57.3;

type FordStoneKind = "boulder" | "slab" | "step";

export interface FordStone {
  readonly along: number;
  readonly bottom: number;
  readonly isGrounded: boolean;
  readonly kind: FordStoneKind;
  readonly pitch: number;
  readonly radius: number;
  readonly rotation: number;
  readonly top: number;
  readonly variant: number;
  readonly waterLevel: number;
  readonly x: number;
  readonly z: number;
}

export interface BarPoint {
  readonly grounding: number;
  readonly waterLevel: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface FordLayout {
  readonly bar: readonly (readonly BarPoint[])[];
  readonly stones: readonly FordStone[];
}

export interface FordSurroundings {
  readonly heightAt: (x: number, z: number) => number;
  readonly shoreDepthAt: (x: number, z: number) => number;
  readonly waterLevelAt: (x: number, z: number) => number;
  readonly waterSurfaceAt: (x: number, z: number) => number;
}

interface WaterSpan {
  readonly end: number;
  readonly start: number;
}

interface Bed {
  readonly ground: number;
  readonly height: number;
  readonly waterLevel: number;
}

interface Tilt {
  readonly pitch: number;
  readonly rotation: number;
}

interface StoneSpot {
  readonly across: number;
  readonly bed: Bed;
  readonly stone: Omit<FordStone, "kind" | "radius" | "top">;
}

interface LineStep {
  readonly along: number;
  readonly index: number;
  readonly radius: number;
}

function fordHash(ford: Ford, salt: number, index: number, channel: number): number {
  return hashToUnit(ford.seed * 1000 + index, channel, salt);
}

function variantOf(unit: number): number {
  return Math.floor(unit * STEPPING_STONE_VARIANTS) % STEPPING_STONE_VARIANTS;
}

export function visibleWaterSpan(ford: Ford, surroundings: FordSurroundings): WaterSpan | null {
  const length = crossingLength(ford);

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (let along = -BEYOND_ENDS; along <= length + BEYOND_ENDS; along += SCAN_STEP) {
    const point = pointOnCrossing(ford, along, 0);

    if (surroundings.shoreDepthAt(point.x, point.z) > 0) {
      start = Math.min(start, along);
      end = Math.max(end, along);
    }
  }

  return start <= end ? { end, start } : null;
}

function stepRadius(span: WaterSpan, along: number, spread: number): number {
  const fromBank = Math.max(0, Math.min(along - span.start, span.end - along));
  const size = lerp(BANK_RADIUS, MIDSTREAM_RADIUS, smoothstep(0, NEAR_BANK, fromBank));

  return size * (1 - RADIUS_SPREAD / 2 + RADIUS_SPREAD * spread);
}

function swellAt(ford: Ford, along: number, salt: number): number {
  return 0.5 + 0.5 * Math.sin(along * 0.7 + ford.seed * 40 + salt) * Math.cos(along * 0.23 + ford.seed * 17 - salt);
}

function barDepthAt(ford: Ford, along: number): number {
  return lerp(BAR_SHALLOWEST, BAR_DEEPEST, swellAt(ford, along, 0));
}

function barHalfWidthAt(ford: Ford, along: number): number {
  return lerp(BAR_NARROWEST, BAR_WIDEST, swellAt(ford, along * 0.6, 2.1));
}

function bedAt(ford: Ford, surroundings: FordSurroundings, along: number, across: number): Bed {
  const center = pointOnCrossing(ford, along, 0);
  const point = pointOnCrossing(ford, along, across);
  const ground = surroundings.heightAt(point.x, point.z);
  const waterLevel = surroundings.waterLevelAt(center.x, center.z);

  if (waterLevel === NO_WATER || surroundings.shoreDepthAt(point.x, point.z) <= 0) {
    return { ground, height: ground, waterLevel };
  }

  const drop = BAR_SIDE_DROP * smoothstep(barHalfWidthAt(ford, along), BAR_FOOT, Math.abs(across));
  const surface = surroundings.waterSurfaceAt(point.x, point.z);
  const deepest = surface === NO_WATER ? waterLevel : Math.min(waterLevel, surface);
  const bar = deepest - barDepthAt(ford, along) - drop;

  return { ground, height: Math.max(ground, bar), waterLevel };
}

function drawnLevelAt(surroundings: FordSurroundings, point: Point): number {
  const surface = surroundings.waterSurfaceAt(point.x, point.z);

  return surface === NO_WATER ? surroundings.waterLevelAt(point.x, point.z) : surface;
}

function highestLevelAround(
  ford: Ford,
  surroundings: FordSurroundings,
  along: number,
  across: number,
  reach: number
): number {
  return [across - reach, across, across + reach].reduce((highest, offset) => {
    return Math.max(highest, drawnLevelAt(surroundings, pointOnCrossing(ford, along, offset)));
  }, NO_WATER);
}

function slopeUnder(ford: Ford, surroundings: FordSurroundings, along: number, across: number, reach: number): Tilt {
  const direction = crossingDirection(ford);

  const rise =
    bedAt(ford, surroundings, along + reach, across).height - bedAt(ford, surroundings, along - reach, across).height;
  const sideRise =
    bedAt(ford, surroundings, along, across + reach).height - bedAt(ford, surroundings, along, across - reach).height;
  const slopeX = (direction.x * rise - direction.z * sideRise) / (2 * reach);
  const slopeZ = (direction.z * rise + direction.x * sideRise) / (2 * reach);

  return {
    pitch: Math.min(Math.atan(Math.hypot(slopeX, slopeZ)), SLAB_STEEPEST),
    rotation: Math.atan2(-slopeZ, slopeX),
  };
}

function steppingLine(ford: Ford, span: WaterSpan): LineStep[] {
  function hash(item: number, channel: number): number {
    return fordHash(ford, STONE_SALT, item, channel);
  }

  const first = span.start - BANK_OVERLAP;
  const last = span.end + BANK_OVERLAP;

  let previous: LineStep = { along: first, index: 0, radius: stepRadius(span, first, hash(0, 3)) };

  const line = [previous];

  for (let index = 1; previous.along < last; index += 1) {
    const reach = previous.along + previous.radius + lerp(SMALLEST_GAP, LARGEST_STEP_GAP, hash(index, 1));
    const radius = stepRadius(span, reach + MIDSTREAM_RADIUS, hash(index, 3));

    if (reach + radius < last) {
      previous = { along: reach + radius, index, radius };
    } else if (last - previous.along > previous.radius) {
      previous = { along: last, index, radius: stepRadius(span, last, hash(index, 3)) };
    } else {
      return line;
    }

    line.push(previous);
  }

  return line;
}

function stoneHash(ford: Ford, index: number, channel: number): number {
  return fordHash(ford, STONE_SALT, index, channel);
}

function spotOf(ford: Ford, surroundings: FordSurroundings, step: LineStep): StoneSpot {
  const { along, index } = step;

  const meander = MEANDER * Math.sin(along * 0.3 + ford.seed * 30);
  const across = meander + (stoneHash(ford, index, 2) - 0.5) * 2 * ACROSS_JITTER;
  const point = pointOnCrossing(ford, along, across);
  const bed = bedAt(ford, surroundings, along, across);
  const isWet = surroundings.shoreDepthAt(point.x, point.z) > 0;

  return {
    across,
    bed,
    stone: {
      along,
      bottom: bed.height - STONE_SINK,
      isGrounded: bed.height === bed.ground,
      pitch: 0,
      rotation: stoneHash(ford, index, 4) * FULL_TURN,
      variant: variantOf(stoneHash(ford, index, 6)),
      waterLevel: isWet ? drawnLevelAt(surroundings, point) : NO_WATER,
      ...point,
    },
  };
}

function slabAt(ford: Ford, surroundings: FordSurroundings, step: LineStep, spot: StoneSpot): FordStone {
  const { along, index, radius } = step;
  const { across, bed, stone } = spot;

  const rise = SLAB_RISE + SLAB_RISE_SPREAD * stoneHash(ford, index, 7);
  const slope = slopeUnder(ford, surroundings, along, across, radius);
  const isFlipped = stoneHash(ford, index, 4) < 0.5;

  return {
    ...stone,
    kind: "slab",
    pitch: isFlipped ? -slope.pitch : slope.pitch,
    radius,
    rotation: isFlipped ? slope.rotation + Math.PI : slope.rotation,
    top: Math.max(bed.height, stone.waterLevel) + rise,
  };
}

function placeStep(ford: Ford, surroundings: FordSurroundings, span: WaterSpan, step: LineStep): FordStone[] {
  const { along, index, radius } = step;

  const spot = spotOf(ford, surroundings, step);
  const { across, bed, stone } = spot;
  const level = highestLevelAround(ford, surroundings, along, across, radius);
  const lift = STONE_RISE + (stoneHash(ford, index, 5) - 0.5) * LIFT_JITTER;

  if (stone.waterLevel === NO_WATER || level + lift - bed.height < SHORTEST_STEP) {
    return [slabAt(ford, surroundings, step, spot)];
  }

  const main: FordStone = { ...stone, kind: "step", radius, top: level + lift };
  const fromBank = Math.min(along - span.start, span.end - along);

  if (fromBank < NEAR_BANK / 2 || stoneHash(ford, index, 8) > COMPANION_CHANCE) {
    return [main];
  }

  const side = across < 0 ? 1 : -1;
  const companionAcross = across + side * radius * (1 + COMPANION_SIZE) * 0.9;
  const companionPoint = pointOnCrossing(ford, along + (stoneHash(ford, index, 9) - 0.5) * radius, companionAcross);
  const companionBed = bedAt(ford, surroundings, along, companionAcross);

  if (main.top - companionBed.height > SIDE_DEEPEST) {
    return [main];
  }

  return [
    main,
    {
      ...main,
      bottom: companionBed.height - STONE_SINK,
      isGrounded: companionBed.height === companionBed.ground,
      kind: "boulder",
      radius: radius * COMPANION_SIZE,
      rotation: main.rotation + 2,
      top: main.top - COMPANION_SINKING,
      variant: (main.variant + 1) % STEPPING_STONE_VARIANTS,
      ...companionPoint,
    },
  ];
}

function placeSideStone(ford: Ford, surroundings: FordSurroundings, span: WaterSpan, step: LineStep): FordStone | null {
  function hash(item: number, channel: number): number {
    return fordHash(ford, SIDE_SALT, item, channel);
  }

  const { index } = step;

  if (hash(index, 1) > SIDE_CHANCE) {
    return null;
  }

  const side = hash(index, 2) < 0.5 ? -1 : 1;
  const along = step.along + (hash(index, 3) - 0.5) * 0.8;
  const across = side * (SIDE_NEAREST + SIDE_SPREAD * hash(index, 4));
  const point = pointOnCrossing(ford, along, across);
  const bed = bedAt(ford, surroundings, along, across);
  const waterLevel = drawnLevelAt(surroundings, point);
  const nearBank = 1 - smoothstep(0, NEAR_BANK, Math.min(along - span.start, span.end - along));
  const top = waterLevel + lerp(SIDE_EMERGING, SIDE_RISE, hash(index, 5));
  const isWet = surroundings.shoreDepthAt(point.x, point.z) > 0;

  if (!isWet || waterLevel === NO_WATER || top - bed.height < SIDE_SHORTEST || top - bed.height > SIDE_DEEPEST) {
    return null;
  }

  return {
    along,
    bottom: bed.height - STONE_SINK,
    isGrounded: bed.height === bed.ground,
    kind: "boulder",
    pitch: 0,
    radius: lerp(SIDE_SMALLEST, SIDE_LARGEST, hash(index, 6)) * (1 + 0.5 * nearBank),
    rotation: hash(index, 7) * FULL_TURN,
    top,
    variant: variantOf(hash(index, 8)),
    waterLevel,
    ...point,
  };
}

function isStep(stone: FordStone): boolean {
  return stone.kind === "step";
}

function middleRadius(stones: readonly FordStone[]): number {
  const radii = stones
    .map((stone) => {
      return stone.radius;
    })
    .toSorted((first, second) => {
      return first - second;
    });

  return radii[Math.floor(radii.length / 2)];
}

function bankSlab(
  ford: Ford,
  surroundings: FordSurroundings,
  step: LineStep,
  largest: number,
  towardSteps: number
): FordStone {
  const radius = Math.min(step.radius, largest);
  const settled = { ...step, along: step.along + (step.radius - radius) * towardSteps, radius };

  return slabAt(ford, surroundings, settled, spotOf(ford, surroundings, settled));
}

function placeLine(
  ford: Ford,
  surroundings: FordSurroundings,
  span: WaterSpan,
  line: readonly LineStep[]
): FordStone[] {
  const placed = line.map((step) => {
    return placeStep(ford, surroundings, span, step);
  });

  const first = placed.findIndex((stones) => {
    return isStep(stones[0]);
  });
  const last = placed.findLastIndex((stones) => {
    return isStep(stones[0]);
  });

  if (first < 0) {
    return placed.flat();
  }

  const crossing = placed.slice(first, last + 1).flat();
  const largest = middleRadius(crossing.filter(isStep)) * SLAB_LARGEST_SHARE;
  const before = first > 0 ? [bankSlab(ford, surroundings, line[first - 1], largest, 1)] : [];
  const after = last < line.length - 1 ? [bankSlab(ford, surroundings, line[last + 1], largest, -1)] : [];

  return [...before, ...crossing, ...after];
}

function barRow(ford: Ford, surroundings: FordSurroundings, along: number, isEnd: boolean): BarPoint[] {
  const last = BAR_ACROSS.length - 1;

  return BAR_ACROSS.map((across, column) => {
    const point = pointOnCrossing(ford, along, across);
    const bed = bedAt(ford, surroundings, along, across);
    const isBuried = isEnd || column === 0 || column === last || bed.height === bed.ground;

    return {
      grounding: isBuried ? 1 : 0,
      waterLevel: bed.waterLevel,
      x: point.x,
      y: isBuried ? bed.ground - BAR_BURIAL : bed.height,
      z: point.z,
    };
  });
}

function layBar(ford: Ford, surroundings: FordSurroundings, span: WaterSpan): BarPoint[][] {
  const first = span.start - BAR_OVERHANG;
  const last = span.end + BAR_OVERHANG;
  const rows = Math.max(1, Math.ceil((last - first) / BAR_ROW_STEP));

  return Array.from({ length: rows + 1 }, (_, row) => {
    return barRow(ford, surroundings, lerp(first, last, row / rows), row === 0 || row === rows);
  });
}

export function layFord(ford: Ford, surroundings: FordSurroundings): FordLayout {
  const span = visibleWaterSpan(ford, surroundings);

  if (span === null) {
    return { bar: [], stones: [] };
  }

  const line = steppingLine(ford, span);

  const steps = placeLine(ford, surroundings, span, line);
  const sides = line
    .map((step) => {
      return placeSideStone(ford, surroundings, span, step);
    })
    .filter((stone): stone is FordStone => {
      return stone !== null;
    });

  return {
    bar: layBar(ford, surroundings, span),
    stones: [...steps, ...sides],
  };
}
