import { Vector3 } from "three";
import { FULL_TURN } from "../../shared/math.ts";
import { segmentsAtLeast, segmentsUpTo } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder, SurfacePoint } from "../mesh/mesh-builder.ts";
import type { Shape } from "../mesh/shape.ts";
import { type BodySection, pointAlong, sphere, type TubePoint, tube } from "../mesh/shapes.ts";
import { outermostHit, surfaceTransform } from "../mesh/surface-probe.ts";
import { combine, SIDES, sideMirror, type Triple, transformOf } from "../mesh/transforms.ts";
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

export const DEER_FRAME: QuadrupedFrame = {
  bodyContacts: [
    { bone: QuadrupedBone.Chest, position: [0, 0.8, 0.2] },
    { bone: QuadrupedBone.Pelvis, position: [0, 0.82, -0.45] },
    { bone: QuadrupedBone.Chest, position: [0.17, 1.02, 0.2] },
    { bone: QuadrupedBone.Chest, position: [-0.17, 1.02, 0.2] },
    { bone: QuadrupedBone.Pelvis, position: [0.17, 1.02, -0.45] },
    { bone: QuadrupedBone.Pelvis, position: [-0.17, 1.02, -0.45] },
    { bone: QuadrupedBone.Head, position: [0.07, 1.62, 0.95] },
    { bone: QuadrupedBone.Head, position: [-0.07, 1.62, 0.95] },
  ],
  chest: [0, 1.06, 0.3],
  extraBones: [],
  frontHoof: [0.12, 0, 0.445],
  frontLeg: [
    [0.12, 0.98, 0.42],
    [0.12, 0.7, 0.38],
    [0.12, 0.38, 0.42],
  ],
  head: [0, 1.6, 0.8],
  hindHoof: [0.12, 0, -0.565],
  hindLeg: [
    [0.12, 0.98, -0.52],
    [0.12, 0.66, -0.36],
    [0.12, 0.44, -0.62],
  ],
  neck: [0, 1.16, 0.56],
  pelvis: [0, 1.06, -0.5],
  spine: [0, 1.04, -0.12],
  tail: [0, 1.1, -0.78],
};

export const DEER_GAIT: GaitStyle = {
  deadHeadRoll: -degrees(55),
  grazeReach: degrees(70),
  headBob: degrees(4),
  leap: 0,
  lowerFlex: degrees(55),
  runKind: "gallop",
  runSwing: degrees(38),
  tailSwish: degrees(14),
  walkSwing: degrees(20),
};

const BODY: readonly BodySection[] = [
  { centerY: 1.08, halfHeight: 0, halfWidth: 0, z: -0.8 },
  { centerY: 1.08, halfHeight: 0.1, halfWidth: 0.08, z: -0.765 },
  { centerY: 1.04, halfHeight: 0.19, halfWidth: 0.15, z: -0.64 },
  { centerY: 1.02, halfHeight: 0.21, halfWidth: 0.165, z: -0.45 },
  { centerY: 1, halfHeight: 0.21, halfWidth: 0.155, z: -0.15 },
  { centerY: 1.02, halfHeight: 0.23, halfWidth: 0.165, z: 0.15 },
  { centerY: 1.06, halfHeight: 0.24, halfWidth: 0.155, z: 0.38 },
  { centerY: 1.1, halfHeight: 0.2, halfWidth: 0.12, z: 0.52 },
  { centerY: 1.12, halfHeight: 0, halfWidth: 0, z: 0.6 },
];

const LEGS: Readonly<Record<"front" | "hind", readonly TubePoint[]>> = {
  front: legPath(0.115, [
    [0.05, 1.04, 0.42],
    [0.078, 0.9, 0.41],
    [0.056, 0.78, 0.39],
    [0.046, 0.7, 0.38],
    [0.036, 0.5, 0.41],
    [0.03, 0.38, 0.42],
    [0.022, 0.13, 0.44],
    [0.025, 0.075, 0.445],
    [0.033, 0, 0.45],
  ]),
  hind: legPath(0.12, [
    [0.06, 1.04, -0.5],
    [0.105, 0.88, -0.46],
    [0.075, 0.76, -0.41],
    [0.054, 0.67, -0.37],
    [0.042, 0.55, -0.5],
    [0.033, 0.44, -0.62],
    [0.022, 0.13, -0.57],
    [0.025, 0.075, -0.565],
    [0.033, 0, -0.56],
  ]),
};

const BODY_SEAM = 0.09;
const NECK_SEAM = 0.07;
const HEAD_SEAM = 0.05;
const LEG_SEAM = 0.08;
const TAIL_SEAM = 0.03;
const EAR_SEAM = 0.02;
const BLEND = 0.06;
const EAR = transformOf({ position: [0, 0.075, 0], scale: [0.036, 0.085, 0.014] });

const TAIL: readonly TubePoint[] = [
  { radius: 0.045, x: 0, y: 1.1, z: -0.7 },
  { radius: 0.045, x: 0, y: 1.1, z: -0.79 },
  { radius: 0.034, x: 0, y: 1.03, z: -0.86 },
  { radius: 0, x: 0, y: 0.95, z: -0.88 },
];

const TINE_RADIUS = 0.014;
const SPOT_COUNT = 14;
const SPOT_RAY_HEIGHT = 1;
const SPOT_FLATNESS = transformOf({ scale: [1, 0.5, 1] });

interface AntlerTine {
  readonly along: number;
  readonly reach: Triple;
}

const ANTLER_TINES: readonly AntlerTine[] = [
  { along: 0.27, reach: [0.02, 0.05, 0.14] },
  { along: 0.48, reach: [0.04, 0.05, 0.13] },
  { along: 0.66, reach: [0.06, 0.12, 0.07] },
];

function coatSlot(point: SurfacePoint): number {
  const { y, z } = point.position;

  const isBelly = y < 0.9 && z > -0.62 && z < 0.5;
  const isRump = z < -0.7;

  return isBelly || isRump ? MaterialSlot.CoatLight : MaterialSlot.Coat;
}

function headShape(detail: AnimalDetail): Shape {
  return muzzleShape(
    [
      { radius: 0, x: 0, y: 1.66, z: 0.67 },
      { radius: 0.062, x: 0, y: 1.665, z: 0.7 },
      { radius: 0.084, x: 0, y: 1.665, z: 0.75 },
      { radius: 0.088, x: 0, y: 1.665, z: 0.85 },
      { radius: 0.066, x: 0, y: 1.6, z: 0.98 },
      { radius: 0.046, x: 0, y: 1.535, z: 1.08 },
      { radius: 0.04, x: 0, y: 1.505, z: 1.14 },
      { radius: 0, x: 0, y: 1.495, z: 1.165 },
    ],
    detail,
    0.78
  );
}

function addHead(builder: MeshBuilder, detail: AnimalDetail): void {
  const shape = headShape(detail);

  builder.add(shape, { seam: HEAD_SEAM, style: { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Coat } });
  addMuzzleFace(builder, shape, detail, {
    eyes: { direction: [1, 0.25, 0.35], origin: [0, 1.64, 0.88], radius: 0.016, sink: 0.5 },
    nose: [0, 1.508, 1.148],
    noseRadius: 0.026,
  });
  addEllipsoidEars(builder, detail, {
    placement: { position: [0.042, 1.7, 0.78], rotation: [-0.5, 0.2, -0.9] },
    seam: EAR_SEAM,
    stretch: EAR,
  });
}

export function addDeerBody(builder: MeshBuilder, detail: AnimalDetail): void {
  const { segments } = detail;

  builder.add(bodyShape(BODY, detail), {
    seam: BODY_SEAM,
    style: { ...bodyStyle(DEER_FRAME, 0.14), slot: coatSlot },
  });
  builder.add(
    tube(
      [
        { radius: 0.12, x: 0, y: 1.1, z: 0.42 },
        { radius: 0.1, x: 0, y: 1.28, z: 0.6 },
        { radius: 0.082, x: 0, y: 1.48, z: 0.73 },
        { radius: 0.076, x: 0, y: 1.63, z: 0.8 },
      ],
      { radialSegments: segments }
    ),
    {
      seam: NECK_SEAM,
      style: {
        ...neckStyle(DEER_FRAME, 0.09),
        slot: (point) => {
          return point.position.z > 0.62 && point.position.y < 1.45 ? MaterialSlot.CoatLight : MaterialSlot.Coat;
        },
      },
      transform: transformOf({ scale: [0.82, 1, 1] }),
    }
  );
  addHead(builder, detail);
  addLegs(builder, {
    blend: BLEND,
    detail,
    frame: DEER_FRAME,
    paths: LEGS,
    seam: LEG_SEAM,
    segments: segmentsAtLeast(detail, 5, segments - 2),
    slot: hoofBelow(0.07),
  });
  builder.add(tube(TAIL, { radialSegments: segmentsUpTo(detail, 5) }), {
    seam: TAIL_SEAM,
    style: { ...tailStyle(DEER_FRAME, 0.04), slot: MaterialSlot.CoatLight },
  });
}

function antlerBeam(scale: number): TubePoint[] {
  return [
    { radius: 0.027, x: 0.035, y: 1.69, z: 0.8 },
    { radius: 0.024, x: 0.05, y: 1.74, z: 0.8 },
    { radius: 0.021, x: 0.12, y: 1.74 + 0.18 * scale, z: 0.8 - 0.06 * scale },
    { radius: 0.017, x: 0.12 + 0.08 * scale, y: 1.74 + 0.34 * scale, z: 0.8 - 0.14 * scale },
    { radius: 0.012, x: 0.12 + 0.12 * scale, y: 1.74 + 0.48 * scale, z: 0.8 - 0.2 * scale },
    { radius: 0, x: 0.12 + 0.1 * scale, y: 1.74 + 0.58 * scale, z: 0.8 - 0.18 * scale },
  ];
}

function antlerTine(beam: readonly TubePoint[], tine: AntlerTine, scale: number): TubePoint[] {
  const root = pointAlong(beam, tine.along);
  const [x, y, z] = tine.reach;

  return [
    { radius: Math.min(TINE_RADIUS, root.radius), x: root.x, y: root.y, z: root.z },
    { radius: 0, x: root.x + x * scale, y: root.y + y * scale, z: root.z + z * scale },
  ];
}

function addAntlers(builder: MeshBuilder, detail: AnimalDetail, scale: number): void {
  const style = { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Antler };
  const beam = antlerBeam(scale);
  const beamShape = tube(beam, { radialSegments: segmentsAtLeast(detail, 4, detail.segments - 3) });
  const tines = ANTLER_TINES.map((tine) => {
    return tube(antlerTine(beam, tine, scale), { radialSegments: 4 });
  });

  for (const side of SIDES) {
    const mirror = sideMirror(side);

    builder.add(beamShape, { style, transform: mirror });

    for (const tine of tines) {
      builder.add(tine, { style, transform: mirror });
    }
  }
}

export function addSmallAntlers(builder: MeshBuilder, detail: AnimalDetail): void {
  addAntlers(builder, detail, 0.72);
}

export function addLargeAntlers(builder: MeshBuilder, detail: AnimalDetail): void {
  addAntlers(builder, detail, 1.1);
}

export function addFawnSpots(builder: MeshBuilder, detail: AnimalDetail): void {
  if (!detail.hasSmallParts) {
    return;
  }

  const style = { ...bodyStyle(DEER_FRAME, 0.14), slot: MaterialSlot.CoatLight };
  const body = bodyShape(BODY, detail);
  const spot = sphere(0.022, 5, 3);

  for (let index = 0; index < SPOT_COUNT; index += 1) {
    const side = index % 2 === 0 ? 1 : -1;
    const z = -0.55 + (Math.floor(index / 2) / 6) * 0.95;
    const angle = (index * 0.37) % 1;

    const across = new Vector3(
      side * (0.07 + 0.05 * angle),
      1.2 + 0.03 * Math.cos(angle * FULL_TURN) - SPOT_RAY_HEIGHT,
      0
    );

    const hit = outermostHit(body, new Vector3(0, SPOT_RAY_HEIGHT, z), across);

    if (hit === null) {
      continue;
    }

    builder.add(spot, { style, transform: combine(surfaceTransform(hit), SPOT_FLATNESS) });
  }
}
