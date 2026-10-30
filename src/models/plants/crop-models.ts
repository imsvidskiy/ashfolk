import { Vector3 } from "three";
import type { CropKind } from "../../content/crops.ts";
import { FULL_TURN, hashToUnit, saturate } from "../../shared/math.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { MeshBuilder, type VertexStyle } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import type { Shape } from "../mesh/shape.ts";
import { cylinder, lathe, type TubePoint, tube } from "../mesh/shapes.ts";
import { segmentTransform, type Triple, transformOf } from "../mesh/transforms.ts";
import { plantSway } from "./tree-mesher.ts";
import { GOLDEN_ANGLE } from "./tree-structure.ts";

export const CROP_DETAIL_LEVELS: readonly CropDetailLevel[] = ["high", "low"];
export const CROP_HEAD_PART = 1;

export const CROP_HEIGHTS: Readonly<Record<CropKind, number>> = {
  barley: 0.82,
  beans: 0.58,
  carrots: 0.36,
  flax: 0.78,
  turnips: 0.32,
  wheat: 0.95,
};

const STALK_SIDES = 3;
const FENCE_POST_SPACING = 2.5;
const FENCE_POST_RADIUS = 0.06;
const FENCE_POST_SINK = 0.25;
const FENCE_POST_TOP = 0.95;
const FENCE_RAIL_RADIUS = 0.035;
const FENCE_RAIL_HEIGHTS: readonly number[] = [0.42, 0.8];

export type CropDetailLevel = "high" | "low";

interface LeafPlacement {
  readonly angle: number;
  readonly position: Triple;
  readonly radius: number;
  readonly stretch: Triple;
  readonly thickness: number;
  readonly tilt: number;
}

interface ClumpContext {
  readonly builder: MeshBuilder;
  readonly height: number;
  readonly level: CropDetailLevel;
}

type ClumpBuilder = (context: ClumpContext) => void;

const CLUMP_BUILDERS: Readonly<Record<CropKind, ClumpBuilder>> = {
  barley: addBarley,
  beans: addBeans,
  carrots: addCarrots,
  flax: addFlax,
  turnips: addTurnips,
  wheat: addWheat,
};

function plantStyle(context: ClumpContext, slot: MaterialSlotIndex, part: number): VertexStyle {
  return {
    part,
    shade: (point) => {
      return 0.72 + 0.28 * saturate(point.position.y / context.height);
    },
    slot,
    sway: (point) => {
      return plantSway(point.position.y, context.height);
    },
  };
}

function scatter(index: number, salt: number): number {
  return hashToUnit(index, salt, 5.3);
}

function stalkTop(index: number, height: number, lean: number): Triple {
  const angle = index * GOLDEN_ANGLE + scatter(index, 1) * 0.6;
  const reach = 0.05 + scatter(index, 2) * 0.06;
  const top = height * (0.88 + scatter(index, 3) * 0.12);

  return [Math.cos(angle) * (reach + lean * top), top, Math.sin(angle) * (reach + lean * top)];
}

function stalkBase(top: Triple): Triple {
  return [top[0] * 0.25, 0, top[2] * 0.25];
}

function addStalk(context: ClumpContext, points: readonly TubePoint[]): void {
  context.builder.add(tube(points, { radialSegments: STALK_SIDES }), {
    style: plantStyle(context, MaterialSlot.Leaf, 0),
  });
}

function straightStalk(base: Triple, top: Triple, radius: number): TubePoint[] {
  return [
    { radius, x: base[0], y: base[1], z: base[2] },
    { radius: radius * 0.7, x: top[0], y: top[1], z: top[2] },
  ];
}

function spindle(radius: number, length: number, segments: number): Shape {
  return lathe(
    [
      { radius: 0, y: 0 },
      { radius, y: length * 0.3 },
      { radius: radius * 0.75, y: length * 0.75 },
      { radius: 0, y: length },
    ],
    segments
  );
}

function bud(radius: number, thickness: number, segments: number): Shape {
  return lathe(
    [
      { radius: 0, y: -thickness },
      { radius, y: 0 },
      { radius: 0, y: thickness },
    ],
    segments
  );
}

function addLeafOnStalk(context: ClumpContext, from: Triple, leaf: LeafPlacement): void {
  const { builder, level } = context;

  addStalk(context, straightStalk(from, leaf.position, 0.004));
  builder.add(bud(leaf.radius, leaf.thickness, level === "high" ? 5 : 4), {
    style: plantStyle(context, MaterialSlot.Leaf, 0),
    transform: transformOf({ position: leaf.position, rotation: [0, -leaf.angle, leaf.tilt], scale: leaf.stretch }),
  });
}

function addWheat(context: ClumpContext): void {
  const stalks = context.level === "high" ? 5 : 3;
  const ear = spindle(0.02, 0.13, context.level === "high" ? 4 : 3);

  for (let stalk = 0; stalk < stalks; stalk += 1) {
    const top = stalkTop(stalk, context.height, 0.06);

    addStalk(context, straightStalk(stalkBase(top), top, 0.008));
    context.builder.add(ear, {
      style: plantStyle(context, MaterialSlot.Grain, CROP_HEAD_PART),
      transform: transformOf({ position: [top[0], top[1] - 0.025, top[2]] }),
    });
  }
}

function addBarley(context: ClumpContext): void {
  const stalks = context.level === "high" ? 5 : 3;
  const ear = spindle(0.018, 0.13, context.level === "high" ? 4 : 3);
  const awn = cylinder({ height: 0.12, radialSegments: 3, radiusBottom: 0.012, radiusTop: 0 });

  for (let stalk = 0; stalk < stalks; stalk += 1) {
    const top = stalkTop(stalk, context.height, 0.05);
    const base = stalkBase(top);
    const outward = new Vector3(top[0], 0, top[2]).normalize();
    const nod: Triple = [top[0] + outward.x * 0.07, top[1] - 0.05, top[2] + outward.z * 0.07];

    addStalk(context, [
      { radius: 0.008, x: base[0], y: base[1], z: base[2] },
      { radius: 0.0065, x: top[0], y: top[1], z: top[2] },
      { radius: 0.005, x: nod[0], y: nod[1], z: nod[2] },
    ]);

    const earEnd: Triple = [nod[0] + outward.x * 0.05, nod[1] - 0.12, nod[2] + outward.z * 0.05];
    const awnEnd: Triple = [earEnd[0] + outward.x * 0.03, earEnd[1] - 0.12, earEnd[2] + outward.z * 0.03];
    const head = plantStyle(context, MaterialSlot.Grain, CROP_HEAD_PART);

    context.builder.add(ear, {
      style: head,
      transform: segmentTransform(nod, earEnd),
    });

    if (context.level === "high") {
      context.builder.add(awn, {
        style: head,
        transform: segmentTransform(earEnd, awnEnd),
      });
    }
  }
}

function addFlax(context: ClumpContext): void {
  const stems = context.level === "high" ? 6 : 3;
  const flower = bud(0.03, 0.012, 5);

  for (let stem = 0; stem < stems; stem += 1) {
    const top = stalkTop(stem, context.height, 0.08);

    addStalk(context, straightStalk(stalkBase(top), top, 0.005));
    context.builder.add(flower, {
      style: plantStyle(context, MaterialSlot.Flax, CROP_HEAD_PART),
      transform: transformOf({ position: top }),
    });
  }
}

function frondAngle(index: number, count: number): number {
  return (index / count) * FULL_TURN + scatter(index, 7) * 0.5;
}

function frondPoints(index: number, count: number, height: number): TubePoint[] {
  const angle = frondAngle(index, count);
  const reach = 0.12 + scatter(index, 8) * 0.06;
  const rise = height * (0.85 + scatter(index, 9) * 0.15);

  return [
    { radius: 0.006, x: 0, y: 0, z: 0 },
    { radius: 0.005, x: Math.cos(angle) * reach * 0.4, y: rise * 0.6, z: Math.sin(angle) * reach * 0.4 },
    { radius: 0.004, x: Math.cos(angle) * reach, y: rise, z: Math.sin(angle) * reach },
  ];
}

function addCarrots(context: ClumpContext): void {
  const fronds = context.level === "high" ? 6 : 3;
  const leaf = plantStyle(context, MaterialSlot.Leaf, 0);
  const leaflet = bud(0.045, 0.012, 4);

  for (let frond = 0; frond < fronds; frond += 1) {
    const points = frondPoints(frond, fronds, context.height);

    addStalk(context, points);

    if (context.level === "low") {
      continue;
    }

    const angle = frondAngle(frond, fronds);

    for (const point of points.slice(1)) {
      context.builder.add(leaflet, {
        style: leaf,
        transform: transformOf({ position: [point.x, point.y, point.z], rotation: [0, -angle, 0.4] }),
      });
    }
  }

  context.builder.add(
    lathe(
      [
        { radius: 0, y: -0.04 },
        { radius: 0.03, y: -0.005 },
        { radius: 0.024, y: 0.03 },
        { radius: 0, y: 0.04 },
      ],
      context.level === "high" ? 5 : 4
    ),
    { style: plantStyle(context, MaterialSlot.Carrot, CROP_HEAD_PART) }
  );
}

function addTurnips(context: ClumpContext): void {
  const leaves = context.level === "high" ? 5 : 3;
  const crown: Triple = [0, 0.08, 0];

  addStalk(context, straightStalk([0, 0, 0], crown, 0.012));

  for (let leaf = 0; leaf < leaves; leaf += 1) {
    const angle = (leaf / leaves) * FULL_TURN + scatter(leaf, 11) * 0.4;

    addLeafOnStalk(context, crown, {
      angle,
      position: [Math.cos(angle) * 0.1, 0.1 + scatter(leaf, 12) * 0.12, Math.sin(angle) * 0.1],
      radius: 0.055,
      stretch: [2.2, 1, 1],
      thickness: 0.014,
      tilt: 0.65,
    });
  }

  context.builder.add(bud(0.065, 0.06, context.level === "high" ? 6 : 4), {
    style: plantStyle(context, MaterialSlot.Turnip, CROP_HEAD_PART),
    transform: transformOf({ position: [0, 0.02, 0] }),
  });
}

function addBeans(context: ClumpContext): void {
  const isHigh = context.level === "high";
  const stem: Triple = [0, context.height * 0.92, 0];
  const pods = plantStyle(context, MaterialSlot.Lichen, CROP_HEAD_PART);

  addStalk(context, straightStalk([0, 0, 0], stem, 0.012));

  const leaves = isHigh ? 6 : 3;

  for (let leaf = 0; leaf < leaves; leaf += 1) {
    const angle = leaf * GOLDEN_ANGLE;
    const height = context.height * (0.35 + (leaf / leaves) * 0.6);

    addLeafOnStalk(context, [0, height - 0.03, 0], {
      angle,
      position: [Math.cos(angle) * 0.08, height, Math.sin(angle) * 0.08],
      radius: 0.07,
      stretch: [1, 1, 1],
      thickness: 0.016,
      tilt: 0.3,
    });
  }

  const podCount = isHigh ? 4 : 2;
  const podShape = spindle(0.013, 0.12, 3);

  for (let pod = 0; pod < podCount; pod += 1) {
    const angle = pod * GOLDEN_ANGLE + 1.2;
    const height = context.height * (0.3 + (pod / podCount) * 0.4);
    const start: Triple = [Math.cos(angle) * 0.008, height, Math.sin(angle) * 0.008];
    const end: Triple = [Math.cos(angle) * 0.05, height - 0.11, Math.sin(angle) * 0.05];

    context.builder.add(podShape, { style: pods, transform: segmentTransform(start, end) });
  }
}

export function buildCropModel(kind: CropKind, level: CropDetailLevel): MeshData {
  const builder = new MeshBuilder();

  CLUMP_BUILDERS[kind]({ builder, height: CROP_HEIGHTS[kind], level });

  return builder.build();
}

export function buildFenceModel(length: number, level: CropDetailLevel): MeshData {
  const builder = new MeshBuilder({ slot: MaterialSlot.Wood });
  const sides = level === "high" ? 6 : 4;
  const posts = Math.max(1, Math.round(length / FENCE_POST_SPACING));

  for (let post = 0; post <= posts; post += 1) {
    const x = (post / posts) * length;

    builder.add(
      cylinder({
        height: FENCE_POST_TOP + FENCE_POST_SINK,
        radialSegments: sides,
        radiusBottom: FENCE_POST_RADIUS,
        radiusTop: FENCE_POST_RADIUS * 0.85,
      }),
      {
        style: {
          shade: (point) => {
            return 0.78 + 0.22 * saturate(point.position.y / FENCE_POST_TOP);
          },
        },
        transform: transformOf({ position: [x, -FENCE_POST_SINK, 0] }),
      }
    );
  }

  for (const height of FENCE_RAIL_HEIGHTS) {
    builder.add(
      cylinder({
        height: length,
        radialSegments: sides,
        radiusBottom: FENCE_RAIL_RADIUS,
        radiusTop: FENCE_RAIL_RADIUS,
      }),
      { style: { shade: 0.92 }, transform: segmentTransform([0, height, 0], [length, height, 0]) }
    );
  }

  return builder.build();
}
