import { clamp, FULL_TURN, hashToUnit, lerp, smoothstep, wrapAngle } from "../shared/math.ts";

export const NO_WATER = -10_000;

export const POND_SHORE_SLOPE = 0.3;

export const SPRING_KINDS = ["pond", "cave"] as const;

const POND_STRETCH = 1.7;
const POND_STRETCH_SKEW = 1.6;
const POND_AXIS_SWING = Math.PI;
const POND_WAIST = { deepest: 0.34, narrowest: 0.5, shift: 0.8, widest: 0.9 } as const;
const POND_LOBES = 2;
const POND_SPIT_FEATURE = POND_LOBES + 1;
const POND_SHAPE_FEATURE = POND_LOBES + 2;
const POND_LOBE = { least: -0.1, most: 0.32, narrowest: 0.25, widest: 0.6 } as const;
const POND_SPIT = { chance: 0.5, deepest: 0.42, least: 0.22, narrowest: 0.16, widest: 0.28 } as const;
const POND_RIPPLES = [
  { most: 0.045, order: 3 },
  { most: 0.035, order: 4 },
  { most: 0.03, order: 5 },
  { most: 0.025, order: 6 },
  { most: 0.02, order: 7 },
] as const;
const POND_CALM_OUTLET = { from: 0.3, to: 0.9 } as const;
const POND_NARROWEST_SWELL = 0.4;
const POND_EXTENT_SAMPLES = 256;
const POND_EXTENT_SLACK = 1.02;
const POND_FEATURE_SALT = 59.3;
const REMEMBERED_POND_SHAPES = 1024;
const SHALLOWEST_WATER = 0.05;
const NARROWEST_RIVER = 3.5;
const WIDEST_RIVER = 26;
const RIVER_WIDTH_PER_STRENGTH = 3.4;
const RIVER_CODE_AT_SOURCE = 40;
const RIVER_CODE_PER_STRENGTH = 30;

type SpringKind = (typeof SPRING_KINDS)[number];

interface PondFeature {
  readonly angle: number;
  readonly swell: number;
  readonly width: number;
}

interface PondRipple {
  readonly order: number;
  readonly swell: number;
  readonly turn: number;
}

interface PondOutline {
  readonly axis: number;
  readonly features: readonly PondFeature[];
  readonly outlet: number;
  readonly ripples: readonly PondRipple[];
  readonly stretch: number;
}

interface PondShape {
  readonly extent: number;
  readonly outline: PondOutline;
}

const pondShapes = new WeakMap<Spring, PondShape>();
const pondShapesByKey = new Map<string, PondShape>();

export interface Lake {
  cellCount: number;
  centerX: number;
  centerZ: number;
  id: number;
  level: number;
}

export interface RiverPoint {
  depth: number;
  flow: number;
  surface: number;
  width: number;
  x: number;
  z: number;
}

export interface River {
  id: number;
  points: RiverPoint[];
  reachesEdge: boolean;
}

export interface Waterfall {
  directionX: number;
  directionZ: number;
  top: number;
  width: number;
  x: number;
  z: number;
}

export interface Spring {
  readonly cells: readonly number[];
  readonly directionX: number;
  readonly directionZ: number;
  readonly kind: SpringKind;
  readonly level: number;
  readonly radius: number;
  readonly river: number;
  readonly seed: number;
  readonly x: number;
  readonly z: number;
}

export interface WaterFeatures {
  lakes: Lake[];
  rivers: River[];
  springs: Spring[];
  waterfalls: Waterfall[];
}

export type MirroredWater = Omit<WaterFeatures, "rivers">;

export function mirroredWater({ lakes, springs, waterfalls }: WaterFeatures): MirroredWater {
  return { lakes, springs, waterfalls };
}

function featureDraw(spring: Spring, feature: number, index: number): number {
  return hashToUnit(spring.seed, feature * 7 + index, POND_FEATURE_SALT);
}

function waistOf(spring: Spring, axis: number): PondFeature {
  const side = featureDraw(spring, 0, 0) < 0.5 ? -1 : 1;

  return {
    angle: axis + (side * Math.PI) / 2 + (featureDraw(spring, 0, 1) - 0.5) * POND_WAIST.shift,
    swell: -POND_WAIST.deepest * featureDraw(spring, 0, 2),
    width: lerp(POND_WAIST.narrowest, POND_WAIST.widest, featureDraw(spring, 0, 3)),
  };
}

function lobeOf(spring: Spring, lobe: number): PondFeature {
  return {
    angle: featureDraw(spring, lobe, 0) * FULL_TURN,
    swell: lerp(POND_LOBE.least, POND_LOBE.most, featureDraw(spring, lobe, 1)),
    width: lerp(POND_LOBE.narrowest, POND_LOBE.widest, featureDraw(spring, lobe, 2)),
  };
}

function spitOf(spring: Spring): PondFeature {
  const hasSpit = featureDraw(spring, POND_SPIT_FEATURE, 0) < POND_SPIT.chance;

  return {
    angle: featureDraw(spring, POND_SPIT_FEATURE, 1) * FULL_TURN,
    swell: hasSpit ? -lerp(POND_SPIT.least, POND_SPIT.deepest, featureDraw(spring, POND_SPIT_FEATURE, 2)) : 0,
    width: lerp(POND_SPIT.narrowest, POND_SPIT.widest, featureDraw(spring, POND_SPIT_FEATURE, 3)),
  };
}

function featuresOf(spring: Spring, axis: number): PondFeature[] {
  const lobes = Array.from({ length: POND_LOBES }, (_, lobe) => {
    return lobeOf(spring, lobe + 1);
  });

  return [waistOf(spring, axis), ...lobes, spitOf(spring)];
}

function ripplesOf(spring: Spring): PondRipple[] {
  return POND_RIPPLES.map(({ most, order }) => {
    return {
      order,
      swell: most * featureDraw(spring, order + POND_LOBES, 0),
      turn: featureDraw(spring, order + POND_LOBES, 1) * FULL_TURN,
    };
  });
}

function ellipseRadius(outline: PondOutline, angle: number): number {
  const along = Math.cos(angle - outline.axis);
  const across = Math.sin(angle - outline.axis);

  return 1 / Math.sqrt((along * along) / outline.stretch + across * across * outline.stretch);
}

function shoreSwell(outline: PondOutline, angle: number): number {
  let swell = 0;

  for (const { angle: center, swell: strength, width } of outline.features) {
    const offset = wrapAngle(angle - center) / width;

    swell += strength * Math.exp(-offset * offset);
  }

  for (const { order, swell: strength, turn } of outline.ripples) {
    swell += strength * Math.cos(order * angle + turn);
  }

  const calm = smoothstep(POND_CALM_OUTLET.from, POND_CALM_OUTLET.to, Math.abs(wrapAngle(angle - outline.outlet)));

  return Math.max(POND_NARROWEST_SWELL, 1 + calm * swell);
}

function outlineRadius(outline: PondOutline, angle: number): number {
  return ellipseRadius(outline, angle) * shoreSwell(outline, angle);
}

function outlineOf(spring: Spring): PondOutline {
  const outlet = Math.atan2(spring.directionZ, spring.directionX);
  const axis = outlet + (featureDraw(spring, POND_SHAPE_FEATURE, 1) - 0.5) * POND_AXIS_SWING;

  return {
    axis,
    features: featuresOf(spring, axis),
    outlet,
    ripples: ripplesOf(spring),
    stretch: 1 + POND_STRETCH * featureDraw(spring, POND_SHAPE_FEATURE, 0) ** POND_STRETCH_SKEW,
  };
}

function shapeOf(spring: Spring): PondShape {
  const outline = outlineOf(spring);

  let widest = 0;

  for (let sample = 0; sample < POND_EXTENT_SAMPLES; sample += 1) {
    widest = Math.max(widest, outlineRadius(outline, (sample / POND_EXTENT_SAMPLES) * FULL_TURN));
  }

  return { extent: widest * POND_EXTENT_SLACK, outline };
}

function pondShapeOf(spring: Spring): PondShape {
  const known = pondShapes.get(spring);

  if (known !== undefined) {
    return known;
  }

  const key = `${spring.seed},${spring.directionX},${spring.directionZ}`;

  if (pondShapesByKey.size >= REMEMBERED_POND_SHAPES) {
    pondShapesByKey.clear();
  }

  const remembered = pondShapesByKey.get(key);
  const shape = remembered === undefined ? shapeOf(spring) : remembered;

  pondShapesByKey.set(key, shape);
  pondShapes.set(spring, shape);

  return shape;
}

export function pondOutlineRadius(spring: Spring, angle: number): number {
  return spring.radius * outlineRadius(pondShapeOf(spring).outline, angle);
}

export function pondOutlineExtent(spring: Spring): number {
  return spring.radius * pondShapeOf(spring).extent;
}

export function pondEdgeReach(spring: Spring, x: number, z: number): number {
  const angle = Math.atan2(z - spring.z, x - spring.x);

  return pondOutlineRadius(spring, angle) - Math.hypot(x - spring.x, z - spring.z);
}

export function hasWater(waterSurface: number, ground: number): boolean {
  return waterSurface !== NO_WATER && waterSurface > ground + SHALLOWEST_WATER;
}

export function riverWidthOfStrength(strength: number): number {
  return clamp(NARROWEST_RIVER + RIVER_WIDTH_PER_STRENGTH * strength, NARROWEST_RIVER, WIDEST_RIVER);
}

export function riverCodeOfStrength(strength: number): number {
  return Math.round(clamp(RIVER_CODE_AT_SOURCE + strength * RIVER_CODE_PER_STRENGTH, 0, 255));
}

export function riverCodeOfWidth(width: number): number {
  return RIVER_CODE_AT_SOURCE + (RIVER_CODE_PER_STRENGTH * (width - NARROWEST_RIVER)) / RIVER_WIDTH_PER_STRENGTH;
}
