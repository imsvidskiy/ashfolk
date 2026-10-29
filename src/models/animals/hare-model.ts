import type { AnimalPose } from "../../world/agent-poses.ts";
import { alongPath, segmentsAtLeast, segmentsUpTo } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder, SurfacePoint, VertexStyle } from "../mesh/mesh-builder.ts";
import type { Shape } from "../mesh/shape.ts";
import { type BodySection, type TubePoint, tube } from "../mesh/shapes.ts";
import { combine, SIDES, sideMirror, transformOf } from "../mesh/transforms.ts";
import { degrees, wave } from "../rig/curves.ts";
import type { Pose } from "../rig/pose.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import type { AnimalDetail } from "./animal-detail.ts";
import type { GaitStyle } from "./quadruped-clips.ts";
import { addLegs, addMuzzleFace, bodyShape, legPath, muzzleShape } from "./quadruped-parts.ts";
import { bodyStyle, legStyle, neckStyle, tailStyle } from "./quadruped-rigging.ts";
import { FIRST_EXTRA_BONE, QuadrupedBone, type QuadrupedFrame } from "./quadruped-skeleton.ts";

export const HARE_FRAME: QuadrupedFrame = {
  bodyContacts: [
    { bone: QuadrupedBone.Chest, position: [0, 0.11, 0.08] },
    { bone: QuadrupedBone.Pelvis, position: [0, 0.09, -0.16] },
    { bone: QuadrupedBone.Chest, position: [0.075, 0.21, 0.08] },
    { bone: QuadrupedBone.Chest, position: [-0.075, 0.21, 0.08] },
    { bone: QuadrupedBone.Pelvis, position: [0.1, 0.21, -0.16] },
    { bone: QuadrupedBone.Pelvis, position: [-0.1, 0.21, -0.16] },
    { bone: QuadrupedBone.Head, position: [0.045, 0.31, 0.21] },
    { bone: QuadrupedBone.Head, position: [-0.045, 0.31, 0.21] },
  ],
  chest: [0, 0.2, 0.09],
  extraBones: [{ joint: [0, 0.34, 0.185], name: "ears", parent: QuadrupedBone.Head }],
  frontHoof: [0.045, 0, 0.14],
  frontLeg: [
    [0.045, 0.17, 0.12],
    [0.045, 0.1, 0.125],
    [0.045, 0.035, 0.13],
  ],
  head: [0, 0.3, 0.18],
  hindHoof: [0.075, 0, -0.13],
  hindLeg: [
    [0.07, 0.19, -0.15],
    [0.075, 0.1, -0.085],
    [0.075, 0.045, -0.2],
  ],
  neck: [0, 0.25, 0.14],
  pelvis: [0, 0.2, -0.15],
  spine: [0, 0.21, -0.03],
  tail: [0, 0.24, -0.27],
};

export const HARE_GAIT: GaitStyle = {
  deadHeadRoll: -degrees(20),
  grazeReach: degrees(42),
  headBob: degrees(5),
  leap: 1.5,
  lowerFlex: degrees(60),
  runKind: "hop",
  runSwing: degrees(52),
  tailSwish: degrees(4),
  walkSwing: degrees(24),
};

const EARS_BONE = FIRST_EXTRA_BONE;

const BODY: readonly BodySection[] = [
  { centerY: 0.21, halfHeight: 0, halfWidth: 0, z: -0.295 },
  { centerY: 0.205, halfHeight: 0.07, halfWidth: 0.06, z: -0.282 },
  { centerY: 0.2, halfHeight: 0.112, halfWidth: 0.095, z: -0.235 },
  { centerY: 0.205, halfHeight: 0.12, halfWidth: 0.1, z: -0.16 },
  { centerY: 0.21, halfHeight: 0.105, halfWidth: 0.085, z: -0.05 },
  { centerY: 0.205, halfHeight: 0.1, halfWidth: 0.08, z: 0.05 },
  { centerY: 0.215, halfHeight: 0.082, halfWidth: 0.068, z: 0.125 },
  { centerY: 0.235, halfHeight: 0, halfWidth: 0, z: 0.165 },
];

const LEGS: Readonly<Record<"front" | "hind", readonly TubePoint[]>> = {
  front: legPath(0.045, [
    [0.024, 0.2, 0.115, 0.005],
    [0.03, 0.15, 0.12],
    [0.022, 0.1, 0.125],
    [0.017, 0.06, 0.13],
    [0.016, 0.03, 0.132],
    [0.013, 0.014, 0.135],
  ]),
  hind: legPath(0.07, [
    [0.03, 0.24, -0.15, 0.02],
    [0.062, 0.18, -0.14],
    [0.05, 0.12, -0.1],
    [0.032, 0.09, -0.12],
    [0.024, 0.06, -0.18],
    [0.02, 0.04, -0.2],
  ]),
};

const FRONT_PAW: readonly TubePoint[] = [
  { radius: 0.014, x: 0.045, y: 0.022, z: 0.128 },
  { radius: 0.016, x: 0.045, y: 0.014, z: 0.145 },
  { radius: 0.012, x: 0.045, y: 0.012, z: 0.165 },
  { radius: 0, x: 0.045, y: 0.013, z: 0.172 },
];

const HIND_FOOT: readonly TubePoint[] = [
  { radius: 0.02, x: 0.075, y: 0.045, z: -0.208 },
  { radius: 0.021, x: 0.075, y: 0.024, z: -0.17 },
  { radius: 0.018, x: 0.075, y: 0.016, z: -0.11 },
  { radius: 0.014, x: 0.075, y: 0.014, z: -0.06 },
  { radius: 0, x: 0.075, y: 0.016, z: -0.045 },
];

const NECK: readonly TubePoint[] = [
  { radius: 0.072, x: 0, y: 0.22, z: 0.09 },
  { radius: 0.06, x: 0, y: 0.26, z: 0.14 },
  { radius: 0.05, x: 0, y: 0.295, z: 0.17 },
];

const HEAD: readonly TubePoint[] = [
  { radius: 0, x: 0, y: 0.318, z: 0.125 },
  { radius: 0.046, x: 0, y: 0.322, z: 0.14 },
  { radius: 0.062, x: 0, y: 0.322, z: 0.175 },
  { radius: 0.058, x: 0, y: 0.314, z: 0.212 },
  { radius: 0.044, x: 0, y: 0.302, z: 0.248 },
  { radius: 0.03, x: 0, y: 0.295, z: 0.272 },
  { radius: 0, x: 0, y: 0.293, z: 0.284 },
];

const EAR: readonly TubePoint[] = [
  { radius: 0.015, x: 0, y: -0.01, z: 0 },
  { radius: 0.025, x: 0, y: 0.06, z: 0 },
  { radius: 0.025, x: 0, y: 0.13, z: 0 },
  { radius: 0.017, x: 0, y: 0.19, z: 0 },
  { radius: 0, x: 0, y: 0.215, z: 0 },
];

const TAIL: readonly TubePoint[] = [
  { radius: 0.022, x: 0, y: 0.235, z: -0.265 },
  { radius: 0.038, x: 0, y: 0.245, z: -0.29 },
  { radius: 0.03, x: 0, y: 0.25, z: -0.315 },
  { radius: 0, x: 0, y: 0.252, z: -0.33 },
];

const EAR_TIP_HEIGHT = 0.5;
const BELLY_HEIGHT = 0.13;
const MUZZLE_DEPTH = 0.25;
const BODY_SEAM = 0.03;
const NECK_SEAM = 0.025;
const HEAD_SEAM = 0.02;
const LEG_SEAM = 0.02;
const PAW_SEAM = 0.012;
const EAR_SEAM = 0.008;
const TAIL_SEAM = 0.015;
const BLEND = 0.02;

function coatSlot(point: SurfacePoint): number {
  const { y, z } = point.position;

  const isBelly = y < BELLY_HEIGHT && z > -0.22 && z < 0.13;

  return isBelly ? MaterialSlot.CoatLight : MaterialSlot.Coat;
}

function headShape(detail: AnimalDetail): Shape {
  return muzzleShape(HEAD, detail, 0.82);
}

function addEars(builder: MeshBuilder, detail: AnimalDetail): void {
  const ear = tube(alongPath(EAR, detail), { radialSegments: segmentsUpTo(detail, 6) });
  const style: VertexStyle = {
    ...rigidStyle(EARS_BONE),
    slot: (point) => {
      return point.position.y > EAR_TIP_HEIGHT ? MaterialSlot.Hoof : MaterialSlot.Coat;
    },
  };

  for (const side of SIDES) {
    builder.add(ear, {
      seam: EAR_SEAM,
      style,
      transform: combine(
        sideMirror(side),
        transformOf({ position: [0.022, 0.335, 0.185], rotation: [-0.32, 0, -0.16], scale: [1, 1, 0.42] })
      ),
    });
  }
}

function addHead(builder: MeshBuilder, detail: AnimalDetail): void {
  const shape = headShape(detail);

  builder.add(shape, {
    seam: HEAD_SEAM,
    style: {
      ...rigidStyle(QuadrupedBone.Head),
      slot: (point) => {
        return point.position.y < 0.3 && point.position.z > MUZZLE_DEPTH ? MaterialSlot.CoatLight : MaterialSlot.Coat;
      },
    },
  });
  addMuzzleFace(builder, shape, detail, {
    eyes: { direction: [1, 0.4, 0.2], origin: [0, 0.33, 0.2], radius: 0.015, sink: 0.4 },
    nose: [0, 0.298, 0.278],
    noseRadius: 0.01,
  });
  addEars(builder, detail);
}

function addFeet(builder: MeshBuilder, detail: AnimalDetail): void {
  const segments = segmentsAtLeast(detail, 4, detail.segments - 2);

  const paw = tube(alongPath(FRONT_PAW, detail), { radialSegments: segments });
  const foot = tube(alongPath(HIND_FOOT, detail), { radialSegments: segments });

  for (const side of SIDES) {
    builder.add(paw, {
      seam: PAW_SEAM,
      style: { ...legStyle(HARE_FRAME, "front", side, BLEND), slot: MaterialSlot.CoatLight },
      transform: sideMirror(side),
    });
    builder.add(foot, {
      seam: PAW_SEAM,
      style: { ...legStyle(HARE_FRAME, "hind", side, BLEND), slot: MaterialSlot.CoatLight },
      transform: sideMirror(side),
    });
  }
}

export function addHareBody(builder: MeshBuilder, detail: AnimalDetail): void {
  builder.add(bodyShape(BODY, detail), {
    seam: BODY_SEAM,
    style: { ...bodyStyle(HARE_FRAME, 0.05), slot: coatSlot },
  });
  builder.add(tube(NECK, { radialSegments: detail.segments }), {
    seam: NECK_SEAM,
    style: { ...neckStyle(HARE_FRAME, 0.03), slot: MaterialSlot.Coat },
  });
  addHead(builder, detail);
  addLegs(builder, {
    blend: BLEND,
    detail,
    frame: HARE_FRAME,
    paths: LEGS,
    seam: LEG_SEAM,
    segments: segmentsAtLeast(detail, 4, detail.segments - 2),
    slot: MaterialSlot.Coat,
  });
  addFeet(builder, detail);
  builder.add(tube(alongPath(TAIL, detail), { radialSegments: segmentsAtLeast(detail, 4, detail.segments - 2) }), {
    seam: TAIL_SEAM,
    style: { ...tailStyle(HARE_FRAME, 0.02), slot: MaterialSlot.CoatLight },
  });
}

export function moveHareEars(pose: Pose, clip: AnimalPose, phase: number): void {
  if (clip === "run" || clip === "charge") {
    pose.rotate(EARS_BONE, -degrees(55), 0, 0);

    return;
  }

  if (clip === "dead" || clip === "fall") {
    pose.rotate(EARS_BONE, -degrees(70), 0, 0);

    return;
  }

  if (clip === "walk") {
    pose.rotate(EARS_BONE, -degrees(18) + degrees(4) * wave(phase), 0, 0);

    return;
  }

  pose.rotate(EARS_BONE, -degrees(35) + degrees(6) * wave(phase * 4), degrees(5) * wave(phase * 3, 0.3), 0);
}
