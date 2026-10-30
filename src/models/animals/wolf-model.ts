import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { segmentsAtLeast, segmentsUpTo } from "../level-of-detail.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { MeshBuilder, SurfacePoint } from "../mesh/mesh-builder.ts";
import { deformShape, type Shape, transformShape } from "../mesh/shape.ts";
import { type BodySection, cone, sphere } from "../mesh/shapes.ts";
import { combine, SIDES, sideMirror, type Triple, transformOf } from "../mesh/transforms.ts";
import { type TubePoint, tube } from "../mesh/tubes.ts";
import { degrees } from "../rig/curves.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import type { AnimalDetail } from "./animal-detail.ts";
import type { GaitStyle } from "./quadruped-clips.ts";
import { addLegs, addMuzzleFace, bodyShape, legPath, muzzleShape } from "./quadruped-parts.ts";
import { bodyStyle, legStyle, neckStyle, tailStyle } from "./quadruped-rigging.ts";
import { LEG_ENDS, type LegEnd, QuadrupedBone, type QuadrupedFrame } from "./quadruped-skeleton.ts";

export const WOLF_FRAME: QuadrupedFrame = {
  bodyContacts: [
    { bone: QuadrupedBone.Chest, position: [0, 0.6, 0.25] },
    { bone: QuadrupedBone.Pelvis, position: [0, 0.62, -0.45] },
    { bone: QuadrupedBone.Chest, position: [0.15, 0.8, 0.25] },
    { bone: QuadrupedBone.Chest, position: [-0.15, 0.8, 0.25] },
    { bone: QuadrupedBone.Pelvis, position: [0.14, 0.8, -0.45] },
    { bone: QuadrupedBone.Pelvis, position: [-0.14, 0.8, -0.45] },
    { bone: QuadrupedBone.Head, position: [0.08, 1.02, 0.7] },
    { bone: QuadrupedBone.Head, position: [-0.08, 1.02, 0.7] },
  ],
  chest: [0, 0.82, 0.26],
  extraBones: [],
  frontHoof: [0.11, 0, 0.39],
  frontLeg: [
    [0.11, 0.72, 0.36],
    [0.11, 0.44, 0.34],
    [0.11, 0.14, 0.37],
  ],
  head: [0, 1.02, 0.64],
  hindHoof: [0.11, 0, -0.54],
  hindLeg: [
    [0.11, 0.76, -0.5],
    [0.11, 0.48, -0.36],
    [0.11, 0.2, -0.56],
  ],
  neck: [0, 0.88, 0.46],
  pelvis: [0, 0.8, -0.48],
  spine: [0, 0.79, -0.12],
  tail: [0, 0.84, -0.66],
};

export const WOLF_GAIT: GaitStyle = {
  deadHeadRoll: 0,
  grazeReach: degrees(55),
  headBob: degrees(3),
  leap: 0,
  lowerFlex: degrees(55),
  runKind: "gallop",
  runSwing: degrees(42),
  tailSwish: degrees(8),
  walkSwing: degrees(27),
};

const BODY: readonly BodySection[] = [
  { centerY: 0.82, halfHeight: 0, halfWidth: 0, z: -0.7 },
  { centerY: 0.82, halfHeight: 0.09, halfWidth: 0.08, z: -0.67 },
  { centerY: 0.81, halfHeight: 0.16, halfWidth: 0.13, z: -0.56 },
  { centerY: 0.8, halfHeight: 0.17, halfWidth: 0.14, z: -0.36 },
  { centerY: 0.8, halfHeight: 0.16, halfWidth: 0.13, z: -0.12 },
  { centerY: 0.81, halfHeight: 0.2, halfWidth: 0.15, z: 0.14 },
  { centerY: 0.84, halfHeight: 0.22, halfWidth: 0.15, z: 0.34 },
  { centerY: 0.87, halfHeight: 0.16, halfWidth: 0.11, z: 0.47 },
  { centerY: 0.89, halfHeight: 0, halfWidth: 0, z: 0.53 },
];

const LEGS: Readonly<Record<LegEnd, readonly TubePoint[]>> = {
  front: legPath(0.11, [
    [0.035, 0.84, 0.36, 0.005],
    [0.072, 0.68, 0.355],
    [0.056, 0.56, 0.35],
    [0.044, 0.44, 0.34],
    [0.034, 0.26, 0.36],
    [0.031, 0.14, 0.37],
    [0.033, 0.06, 0.38],
    [0.022, 0.03, 0.385],
  ]),
  hind: legPath(0.11, [
    [0.04, 0.86, -0.48, 0.03],
    [0.085, 0.7, -0.46],
    [0.062, 0.58, -0.42],
    [0.047, 0.48, -0.36],
    [0.04, 0.36, -0.46],
    [0.034, 0.2, -0.56],
    [0.033, 0.06, -0.54],
    [0.022, 0.03, -0.535],
  ]),
};

const PAWS: Readonly<Record<LegEnd, Triple>> = {
  front: [0.11, 0.026, 0.405],
  hind: [0.11, 0.026, -0.515],
};

const BODY_SEAM = 0.08;
const NECK_SEAM = 0.07;
const HEAD_SEAM = 0.05;
const LEG_SEAM = 0.07;
const PAW_SEAM = 0.04;
const TAIL_SEAM = 0.05;
const EAR_SEAM = 0.02;
const RUFF_SEAM = 0.08;
const BLEND = 0.05;

const TAIL: readonly TubePoint[] = [
  { radius: 0.06, x: 0, y: 0.84, z: -0.58 },
  { radius: 0.055, x: 0, y: 0.82, z: -0.68 },
  { radius: 0.07, x: 0, y: 0.74, z: -0.77 },
  { radius: 0.075, x: 0, y: 0.6, z: -0.83 },
  { radius: 0.055, x: 0, y: 0.47, z: -0.86 },
  { radius: 0, x: 0, y: 0.38, z: -0.86 },
];

const RUFF: readonly TubePoint[] = [
  { radius: 0.11, x: 0, y: 0.79, z: 0.32 },
  { radius: 0.19, x: 0, y: 0.84, z: 0.39 },
  { radius: 0.2, x: 0, y: 0.91, z: 0.47 },
  { radius: 0.16, x: 0, y: 0.98, z: 0.55 },
  { radius: 0.1, x: 0, y: 1.02, z: 0.6 },
];

const RUFF_NOISE = createVolumeNoise(createRandom(5353));

function coatSlot(point: SurfacePoint): MaterialSlotIndex {
  const { y, z } = point.position;

  const isBelly = y < 0.7 && z > -0.55 && z < 0.45;

  return isBelly ? MaterialSlot.CoatLight : MaterialSlot.Coat;
}

function addPaws(builder: MeshBuilder, detail: AnimalDetail, segments: number): void {
  const paw = sphere(0.042, segments, segmentsAtLeast(detail, 4, segments - 2));

  for (const side of SIDES) {
    for (const end of LEG_ENDS) {
      builder.add(paw, {
        seam: PAW_SEAM,
        style: { ...legStyle(WOLF_FRAME, end, side, BLEND), slot: MaterialSlot.Coat },
        transform: combine(sideMirror(side), transformOf({ position: PAWS[end], scale: [0.88, 0.62, 1.45] })),
      });
    }
  }
}

function neckShape(detail: AnimalDetail): Shape {
  const neck = tube(
    [
      { radius: 0.14, x: 0, y: 0.84, z: 0.38 },
      { radius: 0.125, x: 0, y: 0.92, z: 0.5 },
      { radius: 0.105, x: 0, y: 1.02, z: 0.6 },
    ],
    { radialSegments: detail.segments }
  );

  return transformShape(neck, transformOf({ scale: [0.9, 1, 1] }));
}

function headShape(detail: AnimalDetail): Shape {
  return muzzleShape(
    [
      { radius: 0, x: 0, y: 1.045, z: 0.49 },
      { radius: 0.075, x: 0, y: 1.05, z: 0.52 },
      { radius: 0.1, x: 0, y: 1.05, z: 0.57 },
      { radius: 0.105, x: 0, y: 1.05, z: 0.65 },
      { radius: 0.07, x: 0, y: 1.0, z: 0.76 },
      { radius: 0.045, x: 0, y: 0.97, z: 0.86 },
      { radius: 0.038, x: 0, y: 0.96, z: 0.9 },
      { radius: 0, x: 0, y: 0.958, z: 0.915 },
    ],
    detail,
    0.88
  );
}

function addHead(builder: MeshBuilder, detail: AnimalDetail): void {
  const head = rigidStyle(QuadrupedBone.Head);
  const shape = headShape(detail);

  builder.add(shape, {
    seam: HEAD_SEAM,
    style: {
      ...head,
      slot: (point) => {
        return point.position.y < 0.99 && point.position.z > 0.7 ? MaterialSlot.CoatLight : MaterialSlot.Coat;
      },
    },
  });
  addMuzzleFace(builder, shape, detail, {
    eyes: { direction: [1, 0.7, 0.35], origin: [0, 1.04, 0.68], radius: 0.016, sink: 0.5 },
    nose: [0, 0.97, 0.905],
    noseRadius: 0.026,
  });

  const ear = cone(0.045, 0.13, segmentsUpTo(detail, 5));
  const earStyle = { ...head, slot: MaterialSlot.Coat };

  for (const side of SIDES) {
    builder.add(ear, {
      seam: EAR_SEAM,
      style: earStyle,
      transform: combine(
        sideMirror(side),
        transformOf({ position: [0.05, 1.105, 0.6], rotation: [-0.2, 0, -0.3], scale: [1, 1, 0.45] })
      ),
    });
  }
}

export function addWolfBody(builder: MeshBuilder, detail: AnimalDetail): void {
  const legSegments = segmentsAtLeast(detail, 5, detail.segments - 2);

  builder.add(bodyShape(BODY, detail), { seam: BODY_SEAM, style: { ...bodyStyle(WOLF_FRAME, 0.14), slot: coatSlot } });
  builder.add(neckShape(detail), {
    seam: NECK_SEAM,
    style: { ...neckStyle(WOLF_FRAME, 0.09), slot: MaterialSlot.Coat },
  });
  addHead(builder, detail);
  addLegs(builder, {
    blend: BLEND,
    detail,
    frame: WOLF_FRAME,
    paths: LEGS,
    seam: LEG_SEAM,
    segments: legSegments,
    slot: MaterialSlot.Coat,
  });
  addPaws(builder, detail, segmentsAtLeast(detail, 5, detail.segments - 4));
  builder.add(tube(TAIL, { hasEndCap: false, radialSegments: segmentsAtLeast(detail, 5, detail.segments - 3) }), {
    seam: TAIL_SEAM,
    style: {
      ...tailStyle(WOLF_FRAME, 0.05),
      slot: (point) => {
        return point.position.y < 0.5 ? MaterialSlot.CoatLight : MaterialSlot.Coat;
      },
    },
  });
}

function ruffShape(detail: AnimalDetail): Shape {
  const sleeve = transformShape(
    tube(RUFF, { radialSegments: detail.segments + 4 }),
    transformOf({ scale: [0.95, 1, 1] })
  );

  return deformShape(sleeve, (vertex) => {
    const shag = 0.018 * RUFF_NOISE.fractal(vertex.x * 22, vertex.y * 22, vertex.z * 22, { octaves: 2 });
    const fullness = Math.sin(Math.PI * vertex.along);

    return [vertex.normalX * shag * fullness, vertex.normalY * shag * fullness, vertex.normalZ * shag * fullness];
  });
}

export function addRuff(builder: MeshBuilder, detail: AnimalDetail): void {
  builder.add(ruffShape(detail), {
    seam: RUFF_SEAM,
    style: {
      ...neckStyle(WOLF_FRAME, 0.09),
      slot: (point) => {
        return point.position.z > 0.5 && point.position.y < 0.86 ? MaterialSlot.CoatLight : MaterialSlot.Coat;
      },
    },
  });
  builder.addSeamReference(bodyShape(BODY, detail));
  builder.addSeamReference(neckShape(detail));
  builder.addSeamReference(headShape(detail));
}
