import { lerp, saturate, smoothstep } from "../shared/math.ts";
import { createNoiseSampler, type NoiseSampler } from "../shared/noise.ts";
import { createRandom } from "../shared/random.ts";
import type { IslandShape } from "../world/island-shape.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import { type ErodedRidgedOptions, GradientNoise, type NoiseGradient } from "./gradient-noise.ts";
import {
  basinShapeAt,
  coneHeightAt,
  type DesertPatch,
  type IslandLayout,
  mountainMaskAt,
  risesHeightAt,
  shelfHeightAt,
} from "./island-layout.ts";

const METERS_PER_DETAIL_UNIT = 2560;
const BOUNDARY_WOBBLE = 0.035;
const DESERT_CORE = 0.4;
const INLAND_START = 0.05;
const INLAND_END = 0.55;
const MESA_START = 0.1;
const MESA_END = 0.3;
const RIM_WIDTH = 0.2;
const UPPER_RIM_KNEE = 330;
const LOWER_RIM_KNEE = 200;
const RIM_SOFTNESS = 50;
const MESA_THRESHOLD = 0.12;
const CLIFF_WIDTH = 55;
const CLIFF_SHARE = 0.3;
const TALUS_WIDTH = 210;
const SHALLOWEST_MESA_PATTERN = 0.35;
const SHORE_HEIGHT = 185;
const SHORE_BELOW_INLAND = 15;
const OUTSIDE_SLOPE = 1500;
const DEEPEST_OUTSIDE_DROP = 200;

const RIDGE_HEIGHT = 300;
const MASSIF_HEIGHT = 620;
const RIDGE_FREQUENCY = 1.2;
const HILL_HEIGHT = 110;
const HILL_FREQUENCY = 2.1;

const MOUNTAIN_RIDGES: ErodedRidgedOptions = {
  damping: 6,
  gain: 0.45,
  octaves: 5,
  rounding: 0.03,
  slopeScale: (RIDGE_HEIGHT * RIDGE_FREQUENCY) / METERS_PER_DETAIL_UNIT,
};

const HILL_RIDGES: ErodedRidgedOptions = {
  damping: 4,
  gain: 0.42,
  octaves: 5,
  rounding: 0.06,
  slopeScale: (HILL_HEIGHT * HILL_FREQUENCY) / METERS_PER_DETAIL_UNIT,
};

interface IslandPoint {
  x: number;
  z: number;
}

interface ReliefSample {
  coastDistance: number;
  desert: number;
  height: number;
}

export interface Relief {
  boundaryDistanceAt: (point: IslandPoint) => number;
  sampleAt: (point: IslandPoint) => ReliefSample;
}

interface ReliefNoise {
  desert: NoiseSampler;
  detail: GradientNoise;
  detailScale: number;
  primary: NoiseSampler;
  sample: NoiseGradient;
  secondary: NoiseSampler;
  shape: GradientNoise;
}

export function islandPointAt(grid: WorldGrid, column: number, row: number): IslandPoint {
  return { x: grid.centerX(column) / grid.halfSize, z: grid.centerZ(row) / grid.halfSize };
}

function desertMask(noise: NoiseSampler, patch: DesertPatch | null, point: IslandPoint): number {
  if (patch === null) {
    return 0;
  }

  const warpedX = point.x + 0.22 * noise.fractal(point.x * 1.4 + 2, point.z * 1.4 - 5, { octaves: 3 });
  const warpedZ = point.z + 0.18 * noise.fractal(point.x * 1.4 - 7, point.z * 1.4 + 3, { octaves: 3 });

  return smoothstep(1, DESERT_CORE, Math.hypot(warpedX - patch.x, warpedZ - patch.z) / patch.radius);
}

function warpPoint(noise: NoiseSampler, point: IslandPoint, octaves: number, amount: number): IslandPoint {
  const shiftX = noise.fractal(point.x * 1.1 + 5.3, point.z * 1.1 - 3.1, { octaves });
  const shiftZ = noise.fractal(point.x * 1.1 - 8.2, point.z * 1.1 + 6.4, { octaves });

  return { x: point.x + amount * shiftX, z: point.z + amount * shiftZ };
}

function inDetailUnits(noise: ReliefNoise, point: IslandPoint): IslandPoint {
  return { x: point.x * noise.detailScale, z: point.z * noise.detailScale };
}

function distanceToBoundary(noise: ReliefNoise, point: IslandPoint): number {
  const detail = inDetailUnits(noise, point);

  const wobble = noise.secondary.fractal(detail.x * 3.2 + 17, detail.z * 3.2 - 4, { octaves: 2 });

  return 1 - Math.max(Math.abs(point.x), Math.abs(point.z)) + (BOUNDARY_WOBBLE * wobble) / noise.detailScale;
}

function rimHeight(height: number): number {
  if (height > UPPER_RIM_KNEE) {
    return UPPER_RIM_KNEE + RIM_SOFTNESS * Math.tanh((height - UPPER_RIM_KNEE) / RIM_SOFTNESS);
  }

  if (height < LOWER_RIM_KNEE) {
    return LOWER_RIM_KNEE - RIM_SOFTNESS * Math.tanh((LOWER_RIM_KNEE - height) / RIM_SOFTNESS);
  }

  return height;
}

function escarpmentProfile(insideMeters: number): number {
  if (insideMeters >= 0) {
    return 1;
  }

  if (insideMeters >= -CLIFF_WIDTH) {
    return 1 + (CLIFF_SHARE * insideMeters) / CLIFF_WIDTH;
  }

  const downTalus = saturate((-insideMeters - CLIFF_WIDTH) / TALUS_WIDTH);

  return (1 - CLIFF_SHARE) * (1 - downTalus) ** 1.6;
}

function desertPlateau(noise: ReliefNoise, point: IslandPoint, mesaShare: number): number {
  const pattern = noise.shape.fractal(point.x * 2.4 + 30, point.z * 2.4 - 12, 3, 0.42, noise.sample);
  const plain = 330 + 35 * noise.primary.fractal(point.x * 3 - 9, point.z * 3 + 1, { octaves: 3 });
  const tableTop = 545 + 35 * noise.primary.fractal(point.x * 6 + 3, point.z * 6 - 4, { octaves: 2 });

  const steepness = Math.max(SHALLOWEST_MESA_PATTERN, 2.4 * Math.hypot(pattern.gradientX, pattern.gradientZ));

  const insideMeters = ((pattern.value - MESA_THRESHOLD) / steepness) * METERS_PER_DETAIL_UNIT;

  return plain + (tableTop - plain) * mesaShare * escarpmentProfile(insideMeters);
}

function basinWeight(layout: IslandLayout, point: IslandPoint): number {
  let weight = 0;

  for (const basin of layout.basins) {
    weight = Math.max(weight, basinShapeAt(basin, point.x, point.z));
  }

  return weight;
}

function boundaryDistance(noise: ReliefNoise, island: IslandShape, point: IslandPoint, coastDistance: number): number {
  if (island.kind === "square") {
    return distanceToBoundary(noise, point);
  }

  return coastDistance;
}

function landformHeight(
  noise: ReliefNoise,
  layout: IslandLayout,
  point: IslandPoint,
  boundary: number,
  desert: number
): number {
  const detail = inDetailUnits(noise, point);
  const warped = warpPoint(noise.primary, detail, 3, 0.13);
  const outline = warpPoint(noise.primary, point, 1, 0.07);
  const lake = basinWeight(layout, point);

  const inland = smoothstep(INLAND_START, INLAND_END, boundary);
  const ridges = noise.shape.erodedRidged(
    warped.x * RIDGE_FREQUENCY + 1.3,
    warped.z * RIDGE_FREQUENCY - 7.1,
    MOUNTAIN_RIDGES
  );
  const hills = noise.detail.erodedRidged(warped.x * HILL_FREQUENCY - 4, warped.z * HILL_FREQUENCY + 2, HILL_RIDGES);

  const mountains = mountainMaskAt(layout, outline.x, outline.z) * inland;

  const foothills = (1 - mountains) * (1 - lake) * (1 - desert);
  const hillShare = (0.3 + 0.7 * foothills) * (0.35 + 0.65 * smoothstep(0, 0.5, mountains + 0.25));

  const tilt = layout.tilt.base + layout.tilt.x * point.x + layout.tilt.z * point.z;
  const rolling =
    70 * layout.roughness * noise.primary.fractal(detail.x * 0.9 + 2.2, detail.z * 0.9 + 9.1, { octaves: 4 });
  const massif = MASSIF_HEIGHT * layout.peakHeight * mountains;
  const peaks = RIDGE_HEIGHT * mountains * ridges;
  const cones = coneHeightAt(layout.cones, outline.x, outline.z) * (0.94 + 0.12 * ridges) * inland;
  const rises = risesHeightAt(layout.rises, point.x, point.z) * (0.45 + ridges) * inland;
  const shelves = shelfHeightAt(layout.shelves, outline.x, outline.z) * (0.4 + 0.6 * inland);
  const hillCover = HILL_HEIGHT * layout.roughness * hills * hillShare * (0.45 + 0.55 * inland);
  const hillClusters = risesHeightAt(layout.hills, point.x, point.z) * hills * inland;

  const height = tilt + rolling + massif + peaks + cones + rises + shelves + hillCover + hillClusters;

  const desertLandform = smoothstep(0.25, 0.65, desert) * (1 - mountains * 0.85);

  const landform =
    desertLandform <= 0.001
      ? height
      : lerp(height, desertPlateau(noise, detail, smoothstep(MESA_START, MESA_END, boundary)), desertLandform);

  return lerp(rimHeight(landform), landform, smoothstep(0, RIM_WIDTH, boundary));
}

function shoreHeight(noise: ReliefNoise, point: IslandPoint, inland: number): number {
  const shore = SHORE_HEIGHT + 40 * noise.secondary.fractal(point.x * 3.2 + 17, point.z * 3.2 - 21, { octaves: 3 });

  return Math.min(shore, inland - SHORE_BELOW_INLAND);
}

function coastalHeight(
  noise: ReliefNoise,
  layout: IslandLayout,
  point: IslandPoint,
  inland: number,
  coastDistance: number
): number {
  const detail = inDetailUnits(noise, point);
  const fromCoast = coastDistance * noise.detailScale;

  const shore = shoreHeight(noise, detail, inland);

  if (fromCoast <= 0) {
    return shore + Math.max(fromCoast * OUTSIDE_SLOPE, -DEEPEST_OUTSIDE_DROP);
  }

  const width = (0.07 + 0.11 * smoothstep(shore, shore + 900, inland)) * layout.shoreWidth;
  const cliffs = noise.secondary.ridged(detail.x * 5.5 - 13, detail.z * 5.5 + 4, { octaves: 3 });

  return lerp(shore, inland, smoothstep(0, width * (0.7 + 0.6 * cliffs), fromCoast));
}

function reliefSample(noise: ReliefNoise, layout: IslandLayout, island: IslandShape, point: IslandPoint): ReliefSample {
  const coastDistance = island.coastDistanceAt(point.x, point.z);
  const boundary = boundaryDistance(noise, island, point, coastDistance);
  const desert = desertMask(noise.desert, layout.climate.desert, point);
  const landform = landformHeight(noise, layout, point, boundary, desert);

  if (island.kind === "square") {
    return { coastDistance, desert, height: landform };
  }

  return { coastDistance, desert, height: coastalHeight(noise, layout, point, landform, boundary) };
}

export function createRelief(seed: number, layout: IslandLayout, island: IslandShape, halfSize: number): Relief {
  const random = createRandom(seed);

  const desert = createNoiseSampler(random.derive(1));
  const primary = createNoiseSampler(random.derive(2));
  const secondary = createNoiseSampler(random.derive(3));
  const shape = new GradientNoise(random.derive(4));
  const detail = new GradientNoise(random.derive(5));

  const noise: ReliefNoise = {
    desert,
    detail,
    detailScale: halfSize / METERS_PER_DETAIL_UNIT,
    primary,
    sample: { gradientX: 0, gradientZ: 0, value: 0 },
    secondary,
    shape,
  };

  return {
    boundaryDistanceAt: (point) => {
      return boundaryDistance(noise, island, point, island.coastDistanceAt(point.x, point.z));
    },
    sampleAt: (point) => {
      return reliefSample(noise, layout, island, point);
    },
  };
}
