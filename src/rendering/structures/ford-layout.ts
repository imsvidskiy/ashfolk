import { FULL_TURN, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import {
  crossingLength,
  type Ford,
  pointOnCrossing,
  STEPPING_STONE_VARIANTS,
  STONE_RISE,
} from "../../world/crossings.ts";
import { NO_WATER } from "../../world/water.ts";

export const LARGEST_STEP_GAP = 0.5;
export const STONE_SINK = 0.3;
export const BAR_SHALLOWEST = 0.28;
const BAR_DEEPEST = 0.5;
const BAR_FOOT = 3.8;
const BAR_ACROSS: readonly number[] = [-BAR_FOOT, -2.7, -1.9, -1.3, -0.6, 0, 0.6, 1.3, 1.9, 2.7, BAR_FOOT];

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
const SLAB_RISE = 0.05;
const SLAB_RISE_SPREAD = 0.07;
const SLAB_WIDENING = 1.15;
const BAR_NARROWEST = 0.9;
const BAR_WIDEST = 1.8;
const BAR_SIDE_DROP = 2.6;
const BAR_BURIAL = 0.3;
const BAR_ROW_STEP = 0.5;
const BAR_OVERHANG = 1;
const SIDE_CHANCE = 0.6;
const SIDE_NEAREST = 1.1;
const SIDE_SPREAD = 1.1;
const SIDE_SMALLEST = 0.24;
const SIDE_LARGEST = 0.55;
const SIDE_RISE = 0.1;
const SIDE_DROWNING = 0.14;
const SIDE_SHORTEST = 0.12;
const PEBBLE_STEP = 0.4;
const PEBBLES_PER_STEP = 3;
const PEBBLE_REACH = 1.8;
const PEBBLE_SPREAD = 1.7;
const PEBBLE_DEEPEST = 0.45;
const PEBBLE_SMALLEST = 0.07;
const PEBBLE_LARGEST = 0.18;
const PEBBLE_RISE = 0.04;
const PEBBLE_SINK = 0.05;
const STONE_SALT = 41.7;
const SIDE_SALT = 57.3;
const PEBBLE_SALT = 23.9;

type FordStoneKind = "boulder" | "pebble" | "slab" | "step";

export interface FordStone {
  readonly along: number;
  readonly bottom: number;
  readonly isGrounded: boolean;
  readonly kind: FordStoneKind;
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

  if (waterLevel === NO_WATER) {
    return { ground, height: ground, waterLevel };
  }

  const drop = BAR_SIDE_DROP * smoothstep(barHalfWidthAt(ford, along), BAR_FOOT, Math.abs(across));
  const surface = surroundings.waterSurfaceAt(point.x, point.z);
  const deepest = surface === NO_WATER ? waterLevel : Math.min(waterLevel, surface);
  const bar = deepest - barDepthAt(ford, along) - drop;

  return { ground, height: Math.max(ground, bar), waterLevel };
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

function placeStep(ford: Ford, surroundings: FordSurroundings, span: WaterSpan, step: LineStep): FordStone[] {
  function hash(item: number, channel: number): number {
    return fordHash(ford, STONE_SALT, item, channel);
  }

  const { along, index, radius } = step;

  const meander = MEANDER * Math.sin(along * 0.3 + ford.seed * 30);
  const across = meander + (hash(index, 2) - 0.5) * 2 * ACROSS_JITTER;
  const point = pointOnCrossing(ford, along, across);
  const bed = bedAt(ford, surroundings, along, across);
  const waterLevel = surroundings.waterLevelAt(point.x, point.z);
  const lift = STONE_RISE + (hash(index, 5) - 0.5) * LIFT_JITTER;

  const stone = {
    along,
    bottom: bed.height - STONE_SINK,
    isGrounded: bed.height === bed.ground,
    rotation: hash(index, 4) * FULL_TURN,
    variant: variantOf(hash(index, 6)),
    waterLevel,
    ...point,
  };

  if (waterLevel === NO_WATER || waterLevel + lift - bed.height < SHORTEST_STEP) {
    const rise = SLAB_RISE + SLAB_RISE_SPREAD * hash(index, 7);
    const surface = surroundings.waterSurfaceAt(point.x, point.z);
    const isAwash = surface !== NO_WATER && surroundings.shoreDepthAt(point.x, point.z) > 0;

    return [
      {
        ...stone,
        kind: "slab",
        radius: radius * SLAB_WIDENING,
        top: Math.max(bed.height, isAwash ? surface : bed.height) + rise,
      },
    ];
  }

  const main: FordStone = { ...stone, kind: "step", radius, top: waterLevel + lift };
  const fromBank = Math.min(along - span.start, span.end - along);

  if (fromBank < NEAR_BANK / 2 || hash(index, 8) > COMPANION_CHANCE) {
    return [main];
  }

  const side = across < 0 ? 1 : -1;
  const companionAcross = across + side * radius * (1 + COMPANION_SIZE) * 0.9;
  const companionPoint = pointOnCrossing(ford, along + (hash(index, 9) - 0.5) * radius, companionAcross);
  const companionBed = bedAt(ford, surroundings, along, companionAcross);

  return [
    main,
    {
      ...main,
      bottom: companionBed.height - STONE_SINK,
      isGrounded: companionBed.height === companionBed.ground,
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
  const waterLevel = surroundings.waterLevelAt(point.x, point.z);
  const nearBank = 1 - smoothstep(0, NEAR_BANK, Math.min(along - span.start, span.end - along));
  const top = waterLevel + lerp(-SIDE_DROWNING, SIDE_RISE, hash(index, 5));

  if (waterLevel === NO_WATER || top - bed.height < SIDE_SHORTEST) {
    return null;
  }

  return {
    along,
    bottom: bed.height - STONE_SINK,
    isGrounded: bed.height === bed.ground,
    kind: "boulder",
    radius: lerp(SIDE_SMALLEST, SIDE_LARGEST, hash(index, 6)) * (1 + 0.5 * nearBank),
    rotation: hash(index, 7) * FULL_TURN,
    top,
    variant: variantOf(hash(index, 8)),
    waterLevel,
    ...point,
  };
}

function scatterPebbles(ford: Ford, surroundings: FordSurroundings, span: WaterSpan): FordStone[] {
  function hash(item: number, channel: number): number {
    return fordHash(ford, PEBBLE_SALT, item, channel);
  }

  const pebbles: FordStone[] = [];
  const first = span.start - PEBBLE_REACH;
  const last = span.end + PEBBLE_REACH;

  for (let row = 0; first + row * PEBBLE_STEP <= last; row += 1) {
    for (let pebble = 0; pebble < PEBBLES_PER_STEP; pebble += 1) {
      const index = row * PEBBLES_PER_STEP + pebble;
      const along = first + (row + hash(index, 1)) * PEBBLE_STEP;
      const across = (hash(index, 2) - 0.5) * 2 * PEBBLE_SPREAD;
      const point = pointOnCrossing(ford, along, across);
      const bed = bedAt(ford, surroundings, along, across);
      const waterLevel = surroundings.waterLevelAt(point.x, point.z);

      if (waterLevel !== NO_WATER && waterLevel - bed.height > PEBBLE_DEEPEST) {
        continue;
      }

      pebbles.push({
        along,
        bottom: bed.height - PEBBLE_SINK,
        isGrounded: bed.height === bed.ground,
        kind: "pebble",
        radius: lerp(PEBBLE_SMALLEST, PEBBLE_LARGEST, hash(index, 3) * hash(index, 4)),
        rotation: hash(index, 5) * FULL_TURN,
        top: bed.height + PEBBLE_RISE * (0.5 + hash(index, 6)),
        variant: variantOf(hash(index, 7)),
        waterLevel,
        ...point,
      });
    }
  }

  return pebbles;
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

  const steps = line.flatMap((step) => {
    return placeStep(ford, surroundings, span, step);
  });
  const sides = line
    .map((step) => {
      return placeSideStone(ford, surroundings, span, step);
    })
    .filter((stone): stone is FordStone => {
      return stone !== null;
    });

  return {
    bar: layBar(ford, surroundings, span),
    stones: [...steps, ...sides, ...scatterPebbles(ford, surroundings, span)],
  };
}
