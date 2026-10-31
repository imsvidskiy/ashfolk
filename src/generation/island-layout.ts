import {
  clamp,
  distanceToSegment,
  FULL_TURN,
  gaussian,
  hashToUnit,
  lerp,
  saturate,
  smoothstep,
} from "../shared/math.ts";
import { createRandom, type RandomSource } from "../shared/random.ts";

export const LAYOUT_ARCHETYPES = ["rim", "spine", "twin", "crown", "lowland", "plateau"] as const;
export const FARTHEST_BASIN = 0.46;
export const BASIN_SEPARATION = 0.5;

const RANGE_POINTS = 6;
const RANGE_JITTER = 0.03;
const FARTHEST_RANGE_POINT = 0.74;
const CREST_ROUNDING = 0.05;
const SEGMENT_BLEND = 0.08;
const RANGE_BLEND = 0.1;
const BASIN_CANDIDATES = 24;
const SURVEY_STEPS = 9;
const DESERT_CANDIDATES = 3;
const DESERT_SPREAD = 0.9;
const DRIEST_DESERTLESS = 0.28;
const DESERT_PROBE_SHARE = 0.6;
const CRATER_SHARE = 0.08;
const BASIN_LOBES = 0.22;
const BASIN_TWISTS = 0.14;

type Polyline = readonly (readonly [number, number])[];

type LayoutArchetype = (typeof LAYOUT_ARCHETYPES)[number];

interface MountainRange {
  readonly points: Polyline;
  readonly reach: number;
  readonly strength: number;
}

interface Cone {
  readonly crater: number;
  readonly height: number;
  readonly radius: number;
  readonly x: number;
  readonly z: number;
}

interface Rise {
  readonly height: number;
  readonly spread: number;
  readonly x: number;
  readonly z: number;
}

interface Shelf {
  readonly directionX: number;
  readonly directionZ: number;
  readonly height: number;
  readonly offset: number;
  readonly width: number;
}

export interface Basin {
  readonly across: number;
  readonly along: number;
  readonly cosine: number;
  readonly depth: number;
  readonly lobeTurn: number;
  readonly sine: number;
  readonly twistTurn: number;
  readonly x: number;
  readonly z: number;
}

interface Tilt {
  readonly base: number;
  readonly x: number;
  readonly z: number;
}

export interface DesertPatch {
  readonly radius: number;
  readonly x: number;
  readonly z: number;
}

export interface ClimateProfile {
  readonly desert: DesertPatch | null;
  readonly moistureOffset: number;
  readonly temperatureOffset: number;
  readonly warmthX: number;
  readonly warmthZ: number;
  readonly wetlandShare: number;
}

export interface IslandLayout {
  readonly archetype: LayoutArchetype;
  readonly basins: readonly Basin[];
  readonly climate: ClimateProfile;
  readonly cones: readonly Cone[];
  readonly hills: readonly Rise[];
  readonly peakHeight: number;
  readonly ranges: readonly MountainRange[];
  readonly rises: readonly Rise[];
  readonly roughness: number;
  readonly shelves: readonly Shelf[];
  readonly shoreWidth: number;
  readonly tilt: Tilt;
}

interface Landforms {
  basinCount: number;
  cones: Cone[];
  hills: Rise[];
  peakHeight: number;
  ranges: MountainRange[];
  rises: Rise[];
  roughness: number;
  shelves: Shelf[];
  shoreWidth: number;
  tiltAmount: number;
  tiltBase: number;
}

const PLANNERS: Readonly<
  Record<LayoutArchetype, (random: RandomSource, landforms: Landforms, facing: number) => void>
> = {
  crown: planCrown,
  lowland: planLowland,
  plateau: planPlateau,
  rim: planRim,
  spine: planSpine,
  twin: planTwin,
};

interface RangeShape {
  bend: number;
  length: number;
  reach: number;
  strength: number;
}

interface RangeCourse extends RangeShape {
  angle: number;
  x: number;
  z: number;
}

interface Heading {
  x: number;
  z: number;
}

function smoothMinimum(first: number, second: number, smoothness: number): number {
  const blend = Math.max(smoothness - Math.abs(first - second), 0) / smoothness;

  return Math.min(first, second) - (blend * blend * smoothness) / 4;
}

function headingAt(angle: number, radius: number): Heading {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function withinReach(x: number, z: number): readonly [number, number] {
  const radius = Math.hypot(x, z);

  if (radius <= FARTHEST_RANGE_POINT) {
    return [x, z];
  }

  return [(x * FARTHEST_RANGE_POINT) / radius, (z * FARTHEST_RANGE_POINT) / radius];
}

function traceRange(random: RandomSource, course: RangeCourse): MountainRange {
  const directionX = Math.cos(course.angle);
  const directionZ = Math.sin(course.angle);
  const points: (readonly [number, number])[] = [];

  for (let index = 0; index < RANGE_POINTS; index += 1) {
    const along = index / (RANGE_POINTS - 1) - 0.5;
    const bow = course.bend * (1 - 4 * along * along);
    const x = course.x + directionX * along * course.length - directionZ * bow + RANGE_JITTER * random.signed();
    const z = course.z + directionZ * along * course.length + directionX * bow + RANGE_JITTER * random.signed();

    points.push(withinReach(x, z));
  }

  return { points, reach: course.reach, strength: course.strength };
}

function rangeFrom(random: RandomSource, start: Heading, angle: number, shape: RangeShape): MountainRange {
  const x = start.x + (Math.cos(angle) * shape.length) / 2;
  const z = start.z + (Math.sin(angle) * shape.length) / 2;

  return traceRange(random, { ...shape, angle, x, z });
}

function emptyLandforms(random: RandomSource): Landforms {
  return {
    basinCount: random.chance(0.45) ? 2 : 1,
    cones: [],
    hills: [],
    peakHeight: random.between(1.1, 1.4),
    ranges: [],
    rises: [],
    roughness: random.between(0.15, 0.4),
    shelves: [],
    shoreWidth: random.between(1, 2.2),
    tiltAmount: random.between(50, 90),
    tiltBase: random.between(255, 295),
  };
}

function hillsAt(random: RandomSource, angle: number, radius: number): Rise {
  const center = headingAt(angle, radius);

  return { height: random.between(70, 110), spread: random.between(0.32, 0.45), x: center.x, z: center.z };
}

function riseAt(random: RandomSource, x: number, z: number): Rise {
  return { height: random.between(120, 180), spread: random.between(0.2, 0.26), x, z };
}

function planRim(random: RandomSource, landforms: Landforms, facing: number): void {
  const center = headingAt(facing, random.between(0.45, 0.52));
  const main = traceRange(random, {
    angle: facing + Math.PI / 2,
    bend: random.between(-0.04, 0.12),
    length: random.between(1, 1.22),
    reach: random.between(0.6, 0.7),
    strength: 1,
    x: center.x,
    z: center.z,
  });
  const side = random.chance(0.5) ? 0 : RANGE_POINTS - 1;
  const [endX, endZ] = main.points[side];
  const [farX, farZ] = main.points[RANGE_POINTS - 1 - side];

  landforms.ranges.push(main);

  if (random.chance(0.7)) {
    const inward = Math.atan2(-endZ, -endX) + random.between(-0.5, 0.5);

    landforms.ranges.push(
      rangeFrom(random, { x: endX, z: endZ }, inward, {
        bend: random.between(-0.08, 0.08),
        length: random.between(0.45, 0.65),
        reach: random.between(0.44, 0.5),
        strength: random.between(0.72, 0.85),
      })
    );
  }

  landforms.rises.push(riseAt(random, farX * 0.8, farZ * 0.8));
  landforms.hills.push(hillsAt(random, facing + Math.PI + random.between(-0.6, 0.6), random.between(0.5, 0.7)));
}

function planSpine(random: RandomSource, landforms: Landforms, facing: number): void {
  const center = headingAt(facing, random.between(0, 0.22));
  const angle = facing + Math.PI / 2 + random.between(-0.5, 0.5);

  landforms.ranges.push(
    traceRange(random, {
      angle,
      bend: random.between(-0.22, 0.22),
      length: random.between(1.05, 1.35),
      reach: random.between(0.44, 0.52),
      strength: random.between(0.9, 1),
      x: center.x,
      z: center.z,
    })
  );

  if (random.chance(0.5)) {
    const branch = angle + (random.chance(0.5) ? 1 : -1) * random.between(0.8, 1.3);

    landforms.ranges.push(
      rangeFrom(random, center, branch, {
        bend: random.between(-0.08, 0.08),
        length: random.between(0.35, 0.5),
        reach: random.between(0.38, 0.45),
        strength: random.between(0.65, 0.8),
      })
    );
  }

  landforms.basinCount = 2;
  landforms.hills.push(hillsAt(random, facing + Math.PI / 2, random.between(0.45, 0.6)));
  landforms.hills.push(hillsAt(random, facing - Math.PI / 2, random.between(0.45, 0.6)));
}

function planTwin(random: RandomSource, landforms: Landforms, facing: number): void {
  const opposite = facing + Math.PI + random.between(-0.8, 0.8);

  for (const [angle, strongest] of [
    [facing, 1],
    [opposite, 0.94],
  ] as const) {
    const center = headingAt(angle, random.between(0.46, 0.54));

    landforms.ranges.push(
      traceRange(random, {
        angle: angle + Math.PI / 2 + random.between(-0.3, 0.3),
        bend: random.between(-0.02, 0.12),
        length: random.between(0.5, 0.7),
        reach: random.between(0.36, 0.42),
        strength: random.between(strongest - 0.1, strongest),
        x: center.x,
        z: center.z,
      })
    );
  }

  landforms.hills.push(hillsAt(random, facing + Math.PI / 2, random.between(0.5, 0.65)));
  landforms.peakHeight = random.between(1.3, 1.6);
}

function planCrown(random: RandomSource, landforms: Landforms, facing: number): void {
  const center = headingAt(facing, random.between(0, 0.18));
  const ridgeCount = random.chance(0.5) ? 3 : 4;
  const turn = random.next() * FULL_TURN;

  landforms.cones.push({
    crater: random.between(30, 60),
    height: random.between(900, 1150),
    radius: random.between(0.44, 0.52),
    x: center.x,
    z: center.z,
  });

  for (let ridge = 0; ridge < ridgeCount; ridge += 1) {
    const angle = turn + (ridge / ridgeCount) * FULL_TURN + random.between(-0.35, 0.35);

    landforms.ranges.push(
      rangeFrom(random, center, angle, {
        bend: random.between(-0.1, 0.1),
        length: random.between(0.4, 0.58),
        reach: random.between(0.26, 0.34),
        strength: random.between(0.5, 0.65),
      })
    );
  }

  landforms.basinCount = 2;
  landforms.peakHeight = random.between(0.6, 0.8);
  landforms.roughness = random.between(0.2, 0.35);
  landforms.tiltAmount = random.between(25, 55);
}

function planLowland(random: RandomSource, landforms: Landforms, facing: number): void {
  const center = headingAt(facing, random.between(0.3, 0.5));
  const riseCount = random.chance(0.5) ? 3 : 4;
  const turn = random.next() * FULL_TURN;

  landforms.ranges.push(
    traceRange(random, {
      angle: facing + Math.PI / 2 + random.between(-0.6, 0.6),
      bend: random.between(-0.1, 0.1),
      length: random.between(0.5, 0.75),
      reach: random.between(0.4, 0.48),
      strength: random.between(0.5, 0.62),
      x: center.x,
      z: center.z,
    })
  );

  for (let rise = 0; rise < riseCount; rise += 1) {
    const place = headingAt(
      turn + (rise / riseCount) * FULL_TURN + random.between(-0.4, 0.4),
      random.between(0.3, 0.55)
    );

    landforms.rises.push({
      height: random.between(60, 110),
      spread: random.between(0.14, 0.2),
      x: place.x,
      z: place.z,
    });
  }

  landforms.basinCount = random.chance(0.6) ? 2 : 1;
  landforms.peakHeight = random.between(0.35, 0.5);
  landforms.roughness = random.between(0.12, 0.25);
  landforms.shoreWidth = random.between(2.2, 3);
  landforms.tiltAmount = random.between(30, 55);
  landforms.tiltBase = random.between(215, 235);
}

function planPlateau(random: RandomSource, landforms: Landforms, facing: number): void {
  const center = headingAt(facing, random.between(0.5, 0.56));

  landforms.shelves.push({
    directionX: Math.cos(facing),
    directionZ: Math.sin(facing),
    height: random.between(230, 320),
    offset: random.between(-0.12, 0.08),
    width: random.between(0.07, 0.11),
  });

  landforms.ranges.push(
    traceRange(random, {
      angle: facing + Math.PI / 2 + random.between(-0.3, 0.3),
      bend: random.between(0, 0.12),
      length: random.between(0.7, 0.9),
      reach: random.between(0.4, 0.48),
      strength: random.between(0.68, 0.82),
      x: center.x,
      z: center.z,
    })
  );

  landforms.hills.push(hillsAt(random, facing + Math.PI + random.between(-0.5, 0.5), random.between(0.45, 0.6)));
  landforms.peakHeight = random.between(0.9, 1.2);
  landforms.roughness = random.between(0.25, 0.45);
  landforms.shoreWidth = random.between(1, 1.4);
  landforms.tiltAmount = random.between(30, 60);
}

function rangeProfile(x: number, z: number, range: MountainRange): number {
  let distance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < range.points.length; index += 1) {
    distance = smoothMinimum(
      distance,
      distanceToSegment(x, z, range.points[index - 1], range.points[index]),
      SEGMENT_BLEND
    );
  }

  const rounded = Math.sqrt(distance * distance + CREST_ROUNDING * CREST_ROUNDING) - CREST_ROUNDING;

  return range.strength * saturate(1 - rounded / range.reach) ** 1.6;
}

export function mountainMaskAt(layout: Pick<IslandLayout, "ranges">, x: number, z: number): number {
  let negated = Number.POSITIVE_INFINITY;

  for (const range of layout.ranges) {
    negated = smoothMinimum(negated, -rangeProfile(x, z, range), RANGE_BLEND);
  }

  return clamp(-negated, 0, 1.1);
}

export function coneHeightAt(cones: readonly Cone[], x: number, z: number): number {
  let height = 0;

  for (const cone of cones) {
    const distance = Math.hypot(x - cone.x, z - cone.z) / cone.radius;
    const flank = saturate(1 - distance) ** 1.35;
    const rounded = flank * flank * (3 - 2 * flank) * 0.25 + flank * 0.75;

    height += cone.height * rounded - cone.crater * Math.exp(-((distance / CRATER_SHARE) ** 2));
  }

  return height;
}

export function shelfHeightAt(shelves: readonly Shelf[], x: number, z: number): number {
  let height = 0;

  for (const shelf of shelves) {
    const across = x * shelf.directionX + z * shelf.directionZ - shelf.offset;

    height += shelf.height * smoothstep(-shelf.width, shelf.width, across);
  }

  return height;
}

export function risesHeightAt(rises: readonly Rise[], x: number, z: number): number {
  let height = 0;

  for (const rise of rises) {
    height += rise.height * gaussian(x, z, rise.x, rise.z, rise.spread);
  }

  return height;
}

export function basinShapeAt(basin: Basin, x: number, z: number): number {
  const offsetX = x - basin.x;
  const offsetZ = z - basin.z;
  const along = (offsetX * basin.cosine + offsetZ * basin.sine) / basin.along;
  const across = (offsetZ * basin.cosine - offsetX * basin.sine) / basin.across;
  const angle = Math.atan2(across, along);
  const reach =
    1 + BASIN_LOBES * Math.sin(2 * angle + basin.lobeTurn) + BASIN_TWISTS * Math.sin(3 * angle + basin.twistTurn);

  return Math.exp(-(along * along + across * across) / (2 * reach * reach));
}

function highGroundHeading(landforms: Landforms): Heading {
  let sumX = 0;
  let sumZ = 0;

  for (let row = 0; row < SURVEY_STEPS; row += 1) {
    for (let column = 0; column < SURVEY_STEPS; column += 1) {
      const x = (column / (SURVEY_STEPS - 1)) * 1.6 - 0.8;
      const z = (row / (SURVEY_STEPS - 1)) * 1.6 - 0.8;
      const weight =
        mountainMaskAt(landforms, x, z) +
        shelfHeightAt(landforms.shelves, x, z) / 400 +
        coneHeightAt(landforms.cones, x, z) / 1000;

      sumX += weight * x;
      sumZ += weight * z;
    }
  }

  const length = Math.hypot(sumX, sumZ);

  if (length < 1e-6) {
    return { x: 0, z: 0 };
  }

  return { x: sumX / length, z: sumZ / length };
}

function groundAt(landforms: Landforms, x: number, z: number): number {
  return (
    mountainMaskAt(landforms, x, z) +
    risesHeightAt(landforms.rises, x, z) / 400 +
    shelfHeightAt(landforms.shelves, x, z) / 300 +
    coneHeightAt(landforms.cones, x, z) / 1000
  );
}

function planBasins(random: RandomSource, landforms: Landforms): Basin[] {
  const candidates = Array.from({ length: BASIN_CANDIDATES }, () => {
    const place = headingAt(random.next() * FULL_TURN, FARTHEST_BASIN * Math.sqrt(random.next()));

    return { ...place, score: groundAt(landforms, place.x, place.z) + 0.35 * Math.hypot(place.x, place.z) };
  }).sort((first, second) => {
    return first.score - second.score;
  });
  const basins: Basin[] = [];

  for (const candidate of candidates) {
    if (basins.length >= landforms.basinCount) {
      break;
    }

    const isApart = basins.every((basin) => {
      return Math.hypot(basin.x - candidate.x, basin.z - candidate.z) >= BASIN_SEPARATION;
    });

    if (!isApart) {
      continue;
    }

    const angle = random.next() * Math.PI;
    const size = basins.length === 0 ? 1 : random.between(0.7, 0.85);

    basins.push({
      across: random.between(0.15, 0.18) * size,
      along: random.between(0.18, 0.23) * size,
      cosine: Math.cos(angle),
      depth: random.between(120, 145) * size,
      lobeTurn: random.next() * FULL_TURN,
      sine: Math.sin(angle),
      twistTurn: random.next() * FULL_TURN,
      x: candidate.x,
      z: candidate.z,
    });
  }

  return basins;
}

function planDesert(random: RandomSource, landforms: Landforms, warmth: number, aridity: number): DesertPatch | null {
  if (aridity < DRIEST_DESERTLESS) {
    return null;
  }

  const angles = Array.from({ length: DESERT_CANDIDATES }, (_, index) => {
    return warmth + (index - 1) * DESERT_SPREAD + random.between(-0.3, 0.3);
  });
  const distance = random.between(0.84, 0.98);
  const radius = lerp(0.48, 0.68, saturate((aridity - DRIEST_DESERTLESS) / (1 - DRIEST_DESERTLESS)));

  const lowest = angles.reduce(
    (best, angle) => {
      const inland = headingAt(angle, distance * DESERT_PROBE_SHARE);
      const ground = groundAt(landforms, inland.x, inland.z);

      return ground < best.ground ? { angle, ground } : best;
    },
    { angle: warmth, ground: Number.POSITIVE_INFINITY }
  );

  return { ...headingAt(lowest.angle, distance), radius };
}

function planClimate(random: RandomSource, landforms: Landforms): ClimateProfile {
  const aridity = random.next();
  const warmth = random.next() * FULL_TURN;
  const warmthAmount = random.between(3.5, 6);
  const temperatureOffset = random.between(-2.6, 1.8);
  const moistureOffset = lerp(0.08, -0.08, aridity) + random.between(-0.04, 0.04);
  const wetlandShare = lerp(0.05, 0.02, aridity) * random.between(0.85, 1.15);

  return {
    desert: planDesert(random, landforms, warmth, aridity),
    moistureOffset,
    temperatureOffset,
    warmthX: Math.cos(warmth) * warmthAmount,
    warmthZ: Math.sin(warmth) * warmthAmount,
    wetlandShare,
  };
}

export function planIslandLayout(seed: number): IslandLayout {
  const random = createRandom(seed * 43 + 29);
  const climateRandom = random.derive(1);
  const basinRandom = random.derive(2);

  const archetype = LAYOUT_ARCHETYPES[Math.floor(hashToUnit(seed, 21, 40) * LAYOUT_ARCHETYPES.length)];
  const facing = random.next() * FULL_TURN;
  const landforms = emptyLandforms(random);

  PLANNERS[archetype](random, landforms, facing);

  const high = highGroundHeading(landforms);
  const tiltAngle = Math.atan2(high.z, high.x) + random.between(-0.5, 0.5);
  const tiltAmount = Math.hypot(high.x, high.z) > 0 ? landforms.tiltAmount : 0;

  return {
    archetype,
    basins: planBasins(basinRandom, landforms),
    climate: planClimate(climateRandom, landforms),
    cones: landforms.cones,
    hills: landforms.hills,
    peakHeight: landforms.peakHeight,
    ranges: landforms.ranges,
    rises: landforms.rises,
    roughness: landforms.roughness,
    shelves: landforms.shelves,
    shoreWidth: landforms.shoreWidth,
    tilt: { base: landforms.tiltBase, x: Math.cos(tiltAngle) * tiltAmount, z: Math.sin(tiltAngle) * tiltAmount },
  };
}
