import { Matrix4, Vector3 } from "three";
import { FULL_TURN, HALF_TURN, lerp, smoothstep } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom, type RandomSource } from "../../shared/random.ts";
import { LOG_TAPER, STEPPING_STONE_VARIANTS } from "../../world/crossings.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { MeshBuilder, type SurfacePoint } from "../mesh/mesh-builder.ts";
import { boundsOf, type MeshData } from "../mesh/mesh-data.ts";
import { deformShape, facetShape, type Shape } from "../mesh/shape.ts";
import { cone, icosphere, type TubePoint, tube } from "../mesh/shapes.ts";
import { segmentTransform, type Triple, transformOf } from "../mesh/transforms.ts";
import { chiseledStone, groundShade, weatheredSlot } from "../stones.ts";

export const CROSSING_DETAIL_LEVELS: readonly CrossingDetailLevel[] = ["high", "medium", "low"];
export const STEPPING_STONE_HEIGHT = 1;
export const STONE_WIDTH = 1.05;
export const FALLEN_LOG_LENGTHS: readonly number[] = [20, 27];
export const FALLEN_LOG_VARIANTS = 4;
export const FALLEN_LOG_ROOT_RADIUS = 0.4;

const WOOD_NOISE = createVolumeNoise(createRandom(7310));
const SUBDIVISIONS: Readonly<Record<CrossingDetailLevel, number>> = { high: 2, low: 0, medium: 1 };

const STONE_SHAPES: readonly (readonly [number, number])[] = [
  [1.12, 0.86],
  [0.96, 1],
  [1.22, 0.8],
  [0.9, 0.94],
];

const WORN_TOP = 0.82;
const TRUNK_SEGMENTS: Readonly<Record<CrossingDetailLevel, number>> = { high: 28, low: 6, medium: 14 };
const TRUNK_SIDES: Readonly<Record<CrossingDetailLevel, number>> = { high: 12, low: 5, medium: 8 };
const STUB_SIDES: Readonly<Record<CrossingDetailLevel, number>> = { high: 6, low: 4, medium: 5 };
const STUBS: Readonly<Record<CrossingDetailLevel, number>> = { high: 5, low: 2, medium: 4 };
const ROOTS: Readonly<Record<CrossingDetailLevel, number>> = { high: 7, low: 0, medium: 4 };
const SPLINTERS: Readonly<Record<CrossingDetailLevel, number>> = { high: 4, low: 0, medium: 2 };
const FLARE = 0.45;
const FLARE_REACH = 1.2;
const GNARL = 0.06;
const PLATE_REACH = 3.4;
const PLATE_THICKNESS = 0.7;
const BARK_NEAR_ROOT = 3;

export type CrossingDetailLevel = "high" | "low" | "medium";

interface LogShape {
  readonly bend: number;
  readonly length: number;
  readonly random: RandomSource;
}

function stoneSlot(seed: number): (point: SurfacePoint) => MaterialSlotIndex {
  const weathered = weatheredSlot({ base: MaterialSlot.Stone, frost: 0, lichen: 0.26, moss: 0, seed });

  return (point) => {
    return point.normal.y > WORN_TOP ? MaterialSlot.PaleStone : weathered(point);
  };
}

function steppingStone(variant: number, level: CrossingDetailLevel): MeshData {
  const random = createRandom(9100 + variant * 31);
  const [stretchX, stretchZ] = STONE_SHAPES[variant % STONE_SHAPES.length];

  const shape = chiseledStone(
    random,
    {
      cuts: 7,
      depth: 0.3,
      flats: [
        { distance: 0.58, normal: [0, 1, 0] },
        { distance: 0.62, normal: [0, -1, 0] },
      ],
      radius: 0.6,
      roughness: 0.05,
    },
    SUBDIVISIONS[level]
  );

  const { maximum, minimum } = boundsOf(shape.positions);
  const height = maximum[1] - minimum[1];
  const width = STONE_WIDTH / 1.2;

  const builder = new MeshBuilder();

  builder.add(shape, {
    style: { shade: groundShade(STEPPING_STONE_HEIGHT), slot: stoneSlot(random.next() * 40) },
    transform: new Matrix4()
      .makeTranslation(0, -minimum[1] * (STEPPING_STONE_HEIGHT / height), 0)
      .multiply(transformOf({ scale: [width * stretchX, STEPPING_STONE_HEIGHT / height, width * stretchZ] })),
  });

  return builder.build();
}

export function buildSteppingStones(level: CrossingDetailLevel): MeshData[] {
  return Array.from({ length: STEPPING_STONE_VARIANTS }, (_, variant) => {
    return steppingStone(variant, level);
  });
}

function taperedRadius(log: LogShape, along: number): number {
  return lerp(FALLEN_LOG_ROOT_RADIUS, FALLEN_LOG_ROOT_RADIUS * LOG_TAPER, along / log.length);
}

function trunkRadius(log: LogShape, along: number): number {
  const flare = FALLEN_LOG_ROOT_RADIUS * FLARE * (1 - smoothstep(0, FLARE_REACH, along));

  return taperedRadius(log, along) + flare;
}

function trunkAxis(log: LogShape, along: number): Vector3 {
  return new Vector3(along, taperedRadius(log, along), Math.sin((along / log.length) * HALF_TURN) * log.bend);
}

function woodSlot(point: SurfacePoint): MaterialSlotIndex {
  const { x, y, z } = point.position;

  const patch = WOOD_NOISE.sample(x * 0.45, y * 1.3, z * 1.3);
  const nearRoot = 1 - smoothstep(0, BARK_NEAR_ROOT, x);

  return patch + nearRoot * 0.9 > 0.62 ? MaterialSlot.Bark : MaterialSlot.Deadwood;
}

function woodShade(point: SurfacePoint): number {
  const { x, y, z } = point.position;

  const grain = WOOD_NOISE.sample(x * 0.18, y * 7, z * 7);
  const underside = smoothstep(-0.6, 0.4, point.normal.y);

  return (0.8 + 0.14 * grain) * (0.72 + 0.28 * underside);
}

function trunk(log: LogShape, level: CrossingDetailLevel): Shape {
  const segments = TRUNK_SEGMENTS[level];
  const offset = log.random.next() * 50;
  const points: TubePoint[] = [];

  for (let segment = 0; segment <= segments; segment += 1) {
    const along = (segment / segments) * log.length;
    const center = trunkAxis(log, along);

    const gnarl = 1 + GNARL * WOOD_NOISE.sample(along * 0.35 + offset, offset, 2.1);

    points.push({ radius: trunkRadius(log, along) * gnarl, x: center.x, y: center.y, z: center.z });
  }

  return tube(points, { radialSegments: TRUNK_SIDES[level] });
}

function addStubs(builder: MeshBuilder, log: LogShape, level: CrossingDetailLevel): void {
  const { random } = log;

  for (let stub = 0; stub < STUBS[level]; stub += 1) {
    const along = lerp(0.22, 0.88, (stub + random.next() * 0.7) / STUBS[level]) * log.length;
    const side = stub % 2 === 0 ? 1 : -1;
    const around = side * (HALF_TURN / 2 + random.signed() * 0.45);
    const radius = trunkRadius(log, along);
    const stubRadius = radius * random.between(0.26, 0.4);
    const reach = random.between(0.7, 1.5);

    const outward = new Vector3(0, Math.cos(around), Math.sin(around));
    const tilt = new Vector3(random.between(0.4, 0.9), 0, 0).add(outward).normalize();
    const base = trunkAxis(log, along).addScaledVector(outward, radius * 0.55);
    const tip = base.clone().addScaledVector(tilt, radius * 0.45 + reach);

    builder.add(
      tube(
        [
          { radius: stubRadius, x: base.x, y: base.y, z: base.z },
          { radius: stubRadius * 0.55, x: tip.x, y: tip.y, z: tip.z },
        ],
        { radialSegments: STUB_SIDES[level] }
      ),
      { style: { shade: woodShade, slot: MaterialSlot.Deadwood } }
    );
  }
}

function addSplinters(builder: MeshBuilder, log: LogShape, level: CrossingDetailLevel): void {
  const { random } = log;

  const end = trunkAxis(log, log.length);
  const radius = trunkRadius(log, log.length);

  for (let splinter = 0; splinter < SPLINTERS[level]; splinter += 1) {
    const angle = (splinter / SPLINTERS[level]) * FULL_TURN + random.signed() * 0.4;
    const offset = radius * random.between(0.2, 0.55);

    const start: Triple = [end.x - 0.15, end.y + Math.cos(angle) * offset, end.z + Math.sin(angle) * offset];
    const length = random.between(0.25, 0.6);

    builder.add(cone(radius * random.between(0.18, 0.3), length, 4), {
      style: { shade: woodShade, slot: MaterialSlot.Deadwood },
      transform: segmentTransform(start, [start[0] + length, start[1] + random.signed() * 0.12, start[2]]),
    });
  }
}

function addRootPlate(builder: MeshBuilder, log: LogShape, level: CrossingDetailLevel): void {
  const { random } = log;

  const reach = FALLEN_LOG_ROOT_RADIUS * PLATE_REACH;
  const thickness = FALLEN_LOG_ROOT_RADIUS * PLATE_THICKNESS;
  const offset = random.next() * 60;

  const plate = deformShape(icosphere(1, SUBDIVISIONS[level]), (vertex) => {
    const angle = Math.atan2(vertex.z, vertex.y);
    const ragged = 1 + 0.18 * WOOD_NOISE.sample(Math.cos(angle) * 1.7 + offset, Math.sin(angle) * 1.7, 0.4);

    return [vertex.x * (thickness - 1), vertex.y * (reach * ragged - 1), vertex.z * (reach * ragged - 1)];
  });

  builder.add(facetShape(plate), {
    style: {
      shade: (point) => {
        return 0.7 + 0.2 * smoothstep(-0.5, 0.8, point.normal.y);
      },
      slot: (point) => {
        return point.normal.x < -0.35 ? MaterialSlot.Daub : MaterialSlot.Bark;
      },
    },
    transform: transformOf({ position: [-thickness * 0.35, FALLEN_LOG_ROOT_RADIUS * 0.9, 0] }),
  });

  for (let root = 0; root < ROOTS[level]; root += 1) {
    const angle = (root / ROOTS[level]) * FULL_TURN + random.signed() * 0.3;

    const rim = new Vector3(0, Math.cos(angle), Math.sin(angle));
    const direction = new Vector3(random.between(-0.6, -0.1), rim.y, rim.z).normalize();
    const base = new Vector3(-thickness * 0.35, FALLEN_LOG_ROOT_RADIUS * 0.9, 0).addScaledVector(rim, reach * 0.62);
    const tip = base.clone().addScaledVector(direction, random.between(0.5, 1.1));

    builder.add(
      tube(
        [
          { radius: thickness * 0.32, x: base.x, y: base.y, z: base.z },
          { radius: thickness * 0.08, x: tip.x, y: tip.y, z: tip.z },
        ],
        { radialSegments: STUB_SIDES[level] }
      ),
      { style: { shade: woodShade, slot: MaterialSlot.Bark } }
    );
  }
}

function fallenLog(variant: number, level: CrossingDetailLevel): MeshData {
  const random = createRandom(6200 + variant * 47);
  const log: LogShape = {
    bend: random.signed() * 0.18,
    length: FALLEN_LOG_LENGTHS[variant % FALLEN_LOG_LENGTHS.length],
    random,
  };

  const builder = new MeshBuilder();

  builder.add(trunk(log, level), { style: { shade: woodShade, slot: woodSlot } });
  addStubs(builder, log, level);
  addSplinters(builder, log, level);
  addRootPlate(builder, log, level);

  return builder.build();
}

export function buildFallenLogs(level: CrossingDetailLevel): MeshData[] {
  return Array.from({ length: FALLEN_LOG_VARIANTS }, (_, variant) => {
    return fallenLog(variant, level);
  });
}

export function fallenLogVariant(length: number, seed: number): number {
  const lengthIndex = Math.abs(length - FALLEN_LOG_LENGTHS[0]) <= Math.abs(length - FALLEN_LOG_LENGTHS[1]) ? 0 : 1;

  return lengthIndex + FALLEN_LOG_LENGTHS.length * (Math.floor(seed * 8) % 2);
}
