import { segmentsAtLeast, segmentsUpTo } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder, SurfacePoint } from "../mesh/mesh-builder.ts";
import type { Shape } from "../mesh/shape.ts";
import { type BodySection, type TubePoint, tube } from "../mesh/shapes.ts";
import { SIDES, sideMirror, transformOf } from "../mesh/transforms.ts";
import { degrees } from "../rig/curves.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import type { AnimalDetail } from "./animal-detail.ts";
import type { GaitStyle } from "./quadruped-clips.ts";
import {
  addEllipsoidEars,
  addLegs,
  addMuzzleFace,
  bodyShape,
  hoofBelow,
  legPath,
  muzzleShape,
} from "./quadruped-parts.ts";
import { bodyStyle, neckStyle, tailStyle } from "./quadruped-rigging.ts";
import { QuadrupedBone, type QuadrupedFrame } from "./quadruped-skeleton.ts";

export const IBEX_FRAME: QuadrupedFrame = {
  bodyContacts: [
    { bone: QuadrupedBone.Chest, position: [0, 0.6, 0.18] },
    { bone: QuadrupedBone.Pelvis, position: [0, 0.62, -0.4] },
    { bone: QuadrupedBone.Chest, position: [0.18, 0.84, 0.18] },
    { bone: QuadrupedBone.Chest, position: [-0.18, 0.84, 0.18] },
    { bone: QuadrupedBone.Pelvis, position: [0.18, 0.84, -0.4] },
    { bone: QuadrupedBone.Pelvis, position: [-0.18, 0.84, -0.4] },
    { bone: QuadrupedBone.Head, position: [0.07, 1.24, 0.72] },
    { bone: QuadrupedBone.Head, position: [-0.07, 1.24, 0.72] },
  ],
  chest: [0, 0.86, 0.22],
  extraBones: [],
  frontHoof: [0.13, 0, 0.345],
  frontLeg: [
    [0.13, 0.76, 0.32],
    [0.13, 0.5, 0.3],
    [0.13, 0.24, 0.33],
  ],
  head: [0, 1.22, 0.6],
  hindHoof: [0.13, 0, -0.455],
  hindLeg: [
    [0.13, 0.8, -0.44],
    [0.13, 0.52, -0.3],
    [0.13, 0.3, -0.5],
  ],
  neck: [0, 0.96, 0.4],
  pelvis: [0, 0.84, -0.42],
  spine: [0, 0.83, -0.1],
  tail: [0, 0.92, -0.62],
};

export const IBEX_GAIT: GaitStyle = {
  deadHeadRoll: -degrees(40),
  grazeReach: degrees(62),
  headBob: degrees(4),
  leap: 0,
  lowerFlex: degrees(52),
  runKind: "gallop",
  runSwing: degrees(36),
  tailSwish: degrees(12),
  walkSwing: degrees(20),
};

const BODY: readonly BodySection[] = [
  { centerY: 0.88, halfHeight: 0, halfWidth: 0, z: -0.66 },
  { centerY: 0.88, halfHeight: 0.1, halfWidth: 0.09, z: -0.63 },
  { centerY: 0.86, halfHeight: 0.19, halfWidth: 0.17, z: -0.52 },
  { centerY: 0.84, halfHeight: 0.21, halfWidth: 0.19, z: -0.32 },
  { centerY: 0.83, halfHeight: 0.22, halfWidth: 0.19, z: -0.06 },
  { centerY: 0.86, halfHeight: 0.24, halfWidth: 0.19, z: 0.18 },
  { centerY: 0.9, halfHeight: 0.22, halfWidth: 0.16, z: 0.36 },
  { centerY: 0.94, halfHeight: 0.16, halfWidth: 0.12, z: 0.46 },
  { centerY: 0.96, halfHeight: 0, halfWidth: 0, z: 0.52 },
];

const LEGS: Readonly<Record<"front" | "hind", readonly TubePoint[]>> = {
  front: legPath(0.125, [
    [0.045, 0.88, 0.32, 0.01],
    [0.09, 0.72, 0.315],
    [0.07, 0.6, 0.31],
    [0.058, 0.5, 0.3],
    [0.046, 0.34, 0.32],
    [0.04, 0.24, 0.33],
    [0.033, 0.1, 0.34],
    [0.036, 0.07, 0.345],
    [0.044, 0, 0.35],
  ]),
  hind: legPath(0.125, [
    [0.05, 0.9, -0.44, 0.01],
    [0.112, 0.72, -0.4],
    [0.085, 0.6, -0.34],
    [0.065, 0.52, -0.3],
    [0.052, 0.42, -0.4],
    [0.045, 0.3, -0.5],
    [0.034, 0.1, -0.46],
    [0.036, 0.07, -0.455],
    [0.044, 0, -0.45],
  ]),
};

const BODY_SEAM = 0.08;
const NECK_SEAM = 0.07;
const HEAD_SEAM = 0.05;
const LEG_SEAM = 0.08;
const TAIL_SEAM = 0.03;
const EAR_SEAM = 0.02;
const BEARD_SEAM = 0.03;
const BLEND = 0.06;
const EAR = transformOf({ position: [0, 0.055, 0], scale: [0.03, 0.068, 0.012] });

const TAIL: readonly TubePoint[] = [
  { radius: 0.042, x: 0, y: 0.91, z: -0.57 },
  { radius: 0.038, x: 0, y: 0.94, z: -0.66 },
  { radius: 0.026, x: 0, y: 0.98, z: -0.71 },
  { radius: 0, x: 0, y: 1.01, z: -0.73 },
];

const BEARD: readonly TubePoint[] = [
  { radius: 0.028, x: 0, y: 1.165, z: 0.78 },
  { radius: 0.032, x: 0, y: 1.11, z: 0.795 },
  { radius: 0.024, x: 0, y: 1.05, z: 0.805 },
  { radius: 0, x: 0, y: 0.99, z: 0.8 },
];

function coatSlot(point: SurfacePoint): number {
  const { y, z } = point.position;

  const isBelly = y < 0.68 && z > -0.5 && z < 0.4;
  const isRump = z < -0.6;

  return isBelly || isRump ? MaterialSlot.CoatLight : MaterialSlot.Coat;
}

function headShape(detail: AnimalDetail): Shape {
  return muzzleShape(
    [
      { radius: 0, x: 0, y: 1.278, z: 0.47 },
      { radius: 0.064, x: 0, y: 1.28, z: 0.5 },
      { radius: 0.085, x: 0, y: 1.28, z: 0.55 },
      { radius: 0.09, x: 0, y: 1.27, z: 0.63 },
      { radius: 0.07, x: 0, y: 1.21, z: 0.74 },
      { radius: 0.05, x: 0, y: 1.15, z: 0.83 },
      { radius: 0.042, x: 0, y: 1.13, z: 0.87 },
      { radius: 0, x: 0, y: 1.125, z: 0.89 },
    ],
    detail,
    0.8
  );
}

function addHead(builder: MeshBuilder, detail: AnimalDetail): void {
  const shape = headShape(detail);

  builder.add(shape, { seam: HEAD_SEAM, style: { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Coat } });
  addMuzzleFace(builder, shape, detail, {
    eyes: { direction: [1, 0.45, 0.12], origin: [0, 1.26, 0.65], radius: 0.016, sink: 0.5 },
    nose: [0, 1.13, 0.875],
    noseRadius: 0.026,
  });
  addEllipsoidEars(builder, detail, {
    placement: { position: [0.045, 1.3, 0.56], rotation: [0.2, 0, -1.25] },
    seam: EAR_SEAM,
    stretch: EAR,
  });
}

export function addIbexBody(builder: MeshBuilder, detail: AnimalDetail): void {
  const { segments } = detail;

  builder.add(bodyShape(BODY, detail), {
    seam: BODY_SEAM,
    style: { ...bodyStyle(IBEX_FRAME, 0.14), slot: coatSlot },
  });
  builder.add(
    tube(
      [
        { radius: 0.15, x: 0, y: 0.92, z: 0.34 },
        { radius: 0.13, x: 0, y: 1.04, z: 0.45 },
        { radius: 0.1, x: 0, y: 1.18, z: 0.54 },
        { radius: 0.088, x: 0, y: 1.27, z: 0.58 },
      ],
      { radialSegments: segments }
    ),
    {
      seam: NECK_SEAM,
      style: { ...neckStyle(IBEX_FRAME, 0.09), slot: MaterialSlot.Coat },
      transform: transformOf({ scale: [0.85, 1, 1] }),
    }
  );
  addHead(builder, detail);
  addLegs(builder, {
    blend: BLEND,
    detail,
    frame: IBEX_FRAME,
    paths: LEGS,
    seam: LEG_SEAM,
    segments: segmentsAtLeast(detail, 5, segments - 2),
    slot: hoofBelow(0.075),
  });
  builder.add(tube(TAIL, { radialSegments: segmentsUpTo(detail, 5) }), {
    seam: TAIL_SEAM,
    style: { ...tailStyle(IBEX_FRAME, 0.04), slot: MaterialSlot.Coat },
  });
}

function hornPath(length: number): TubePoint[] {
  return [
    { radius: 0.036, x: 0.04, y: 1.3, z: 0.6 },
    { radius: 0.034, x: 0.055, y: 1.3 + 0.13 * length, z: 0.58 - 0.03 * length },
    { radius: 0.03, x: 0.07, y: 1.3 + 0.24 * length, z: 0.58 - 0.12 * length },
    { radius: 0.024, x: 0.085, y: 1.3 + 0.29 * length, z: 0.58 - 0.25 * length },
    { radius: 0.016, x: 0.095, y: 1.3 + 0.26 * length, z: 0.58 - 0.37 * length },
    { radius: 0, x: 0.1, y: 1.3 + 0.17 * length, z: 0.58 - 0.44 * length },
  ];
}

function addHorns(builder: MeshBuilder, detail: AnimalDetail, length: number): void {
  const style = { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Horn };
  const horn = tube(hornPath(length), {
    hasEndCap: false,
    radialSegments: segmentsAtLeast(detail, 5, detail.segments - 3),
  });

  for (const side of SIDES) {
    builder.add(horn, {
      style,
      transform: sideMirror(side),
    });
  }
}

export function addShortHorns(builder: MeshBuilder, detail: AnimalDetail): void {
  addHorns(builder, detail, 0.45);
}

export function addLongHorns(builder: MeshBuilder, detail: AnimalDetail): void {
  addHorns(builder, detail, 1.15);
  builder.add(tube(BEARD, { radialSegments: segmentsUpTo(detail, 5) }), {
    seam: BEARD_SEAM,
    style: { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Coat },
  });
  builder.addSeamReference(headShape(detail));
}
