import { Vector3 } from "three";
import { FULL_TURN } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import type { AnimalPose } from "../../world/agent-poses.ts";
import { alongPath, segmentsAtLeast } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder } from "../mesh/mesh-builder.ts";
import { deformShape, type Shape, transformShape } from "../mesh/shape.ts";
import { type BodySection, type LoftSection, lengthwiseLoft, loft, sphere } from "../mesh/shapes.ts";
import { outermostHit, surfaceTransform } from "../mesh/surface-probe.ts";
import { combine, SIDES, sideMirror, type Triple, transformOf } from "../mesh/transforms.ts";
import { type TubePoint, tube } from "../mesh/tubes.ts";
import { degrees, wave } from "../rig/curves.ts";
import type { Pose } from "../rig/pose.ts";
import { chainStyle, createChain, rigidStyle } from "../rig/skin-weights.ts";
import type { AnimalDetail } from "./animal-detail.ts";
import type { GaitStyle } from "./quadruped-clips.ts";
import { addLegs, hoofBelow, legPath } from "./quadruped-parts.ts";
import { bodyStyle, neckStyle, tailStyle } from "./quadruped-rigging.ts";
import { FIRST_EXTRA_BONE, type LegEnd, QuadrupedBone, type QuadrupedFrame } from "./quadruped-skeleton.ts";

const MammothBone = {
  TrunkBase: FIRST_EXTRA_BONE,
  TrunkMiddle: FIRST_EXTRA_BONE + 1,
  TrunkTip: FIRST_EXTRA_BONE + 2,
} as const;

const TRUNK_BASE: Triple = [0, 2.45, 1.85];
const TRUNK_MIDDLE: Triple = [0, 1.78, 2.02];
const TRUNK_TIP: Triple = [0, 1.12, 2.04];

export const MAMMOTH_FRAME: QuadrupedFrame = {
  bodyContacts: [
    { bone: QuadrupedBone.Chest, position: [0, 1.25, 0.35] },
    { bone: QuadrupedBone.Pelvis, position: [0, 1.3, -0.9] },
    { bone: QuadrupedBone.Chest, position: [0.9, 2.3, 0.3] },
    { bone: QuadrupedBone.Chest, position: [-0.9, 2.3, 0.3] },
    { bone: QuadrupedBone.Pelvis, position: [0.86, 2.15, -0.9] },
    { bone: QuadrupedBone.Pelvis, position: [-0.86, 2.15, -0.9] },
    { bone: QuadrupedBone.Head, position: [0.5, 2.9, 1.45] },
    { bone: QuadrupedBone.Head, position: [-0.5, 2.9, 1.45] },
  ],
  chest: [0, 2.35, 0.45],
  extraBones: [
    { joint: TRUNK_BASE, name: "trunkBase", parent: QuadrupedBone.Head },
    { joint: TRUNK_MIDDLE, name: "trunkMiddle", parent: MammothBone.TrunkBase },
    { joint: TRUNK_TIP, name: "trunkTip", parent: MammothBone.TrunkMiddle },
  ],
  frontHoof: [0.45, 0, 0.66],
  frontLeg: [
    [0.45, 2.1, 0.62],
    [0.45, 1.25, 0.6],
    [0.45, 0.55, 0.64],
  ],
  head: [0, 2.7, 1.3],
  hindHoof: [0.48, 0, -0.98],
  hindLeg: [
    [0.48, 2, -1],
    [0.48, 1.2, -0.85],
    [0.48, 0.55, -1.02],
  ],
  neck: [0, 2.55, 1],
  pelvis: [0, 2.15, -1],
  spine: [0, 2.25, -0.35],
  tail: [0, 2.15, -1.55],
};

export const MAMMOTH_GAIT: GaitStyle = {
  deadHeadRoll: 0,
  grazeReach: degrees(28),
  headBob: degrees(3),
  leap: 0,
  lowerFlex: degrees(38),
  runKind: "amble",
  runSwing: degrees(24),
  tailSwish: degrees(18),
  walkSwing: degrees(16),
};

const HEM_HEIGHT = 1.16;

const HEAD: readonly BodySection[] = [
  { centerY: 2.72, halfHeight: 0, halfWidth: 0, z: 0.42 },
  { centerY: 2.72, halfHeight: 0.5, halfWidth: 0.48, z: 0.55 },
  { centerY: 2.8, halfHeight: 0.64, halfWidth: 0.55, z: 0.85 },
  { centerY: 2.96, halfHeight: 0.74, halfWidth: 0.55, z: 1.1 },
  { centerY: 3.01, halfHeight: 0.76, halfWidth: 0.52, z: 1.35 },
  { centerY: 2.93, halfHeight: 0.68, halfWidth: 0.47, z: 1.6 },
  { centerY: 2.76, halfHeight: 0.52, halfWidth: 0.38, z: 1.8 },
  { centerY: 2.62, halfHeight: 0.33, halfWidth: 0.25, z: 1.93 },
  { centerY: 2.58, halfHeight: 0, halfWidth: 0, z: 1.98 },
];

const FUR_NOISE = createVolumeNoise(createRandom(7171));
const FUR_DEPTH = 0.035;
const HEM_DEPTH = 0.1;
const STRAND_DEPTH = 0.13;
const BOXINESS = 2.5;
const BODY_SEAM = 0.3;
const HEAD_SEAM = 0.22;
const LEG_SEAM = 0.26;
const TAIL_SEAM = 0.12;
const TRUNK_SEAM = 0.18;
const EAR_SEAM = 0.08;
const BLEND = 0.2;

const LEGS: Readonly<Record<LegEnd, readonly TubePoint[]>> = {
  front: legPath(0.45, [
    [0.24, 2.25, 0.6],
    [0.37, 1.7, 0.6],
    [0.32, 1.25, 0.6],
    [0.27, 0.6, 0.63],
    [0.28, 0.14, 0.66],
    [0.3, 0, 0.66],
  ]),
  hind: legPath(0.48, [
    [0.26, 2.15, -0.98],
    [0.38, 1.66, -0.93],
    [0.31, 1.2, -0.86],
    [0.26, 0.6, -1],
    [0.27, 0.14, -0.98],
    [0.29, 0, -0.98],
  ]),
};

const TRUNK_STYLE = chainStyle(
  createChain(
    [QuadrupedBone.Head, MammothBone.TrunkBase, MammothBone.TrunkMiddle, MammothBone.TrunkTip],
    [
      { axis: [0, -0.6, 0.3], blend: 0.1, position: TRUNK_BASE },
      { axis: [0, -1, 0.1], blend: 0.12, position: TRUNK_MIDDLE },
      { axis: [0, -1, 0.05], blend: 0.1, position: TRUNK_TIP },
    ]
  )
);

const TRUNK: readonly TubePoint[] = [
  { radius: 0.24, x: 0, y: 2.8, z: 1.62 },
  { radius: 0.21, x: 0, y: 2.56, z: 1.9 },
  { radius: 0.17, x: 0, y: 2.15, z: 2.02 },
  { radius: 0.13, x: 0, y: 1.65, z: 2.04 },
  { radius: 0.1, x: 0, y: 1.18, z: 2.04 },
  { radius: 0.08, x: 0, y: 0.98, z: 2.12 },
  { radius: 0.065, x: 0, y: 0.92, z: 2.24 },
];

const EYE_RADIUS = 0.045;
const EAR_SIZE: Triple = [0.27, 0.07, 0.2];
const HEAD_CURVATURE = 0.7;

const TAIL: readonly TubePoint[] = [
  { radius: 0.13, x: 0, y: 2.48, z: -1.36 },
  { radius: 0.09, x: 0, y: 2.36, z: -1.62 },
  { radius: 0.06, x: 0, y: 2.1, z: -1.72 },
  { radius: 0.05, x: 0, y: 1.86, z: -1.74 },
  { radius: 0.085, x: 0, y: 1.72, z: -1.74 },
  { radius: 0.07, x: 0, y: 1.58, z: -1.73 },
  { radius: 0, x: 0, y: 1.48, z: -1.72 },
];

interface BodyRing {
  readonly back: number;
  readonly front: number;
  readonly halfWidth: number;
  readonly y: number;
}

const BODY_RINGS: readonly BodyRing[] = [
  { back: -1.22, front: 0.98, halfWidth: 0.78, y: HEM_HEIGHT },
  { back: -1.42, front: 1.14, halfWidth: 0.9, y: 1.4 },
  { back: -1.56, front: 1.24, halfWidth: 0.94, y: 1.84 },
  { back: -1.58, front: 1.28, halfWidth: 0.92, y: 2.3 },
  { back: -1.45, front: 1.22, halfWidth: 0.86, y: 2.7 },
  { back: -1.05, front: 1.1, halfWidth: 0.74, y: 3.05 },
  { back: -0.55, front: 0.98, halfWidth: 0.6, y: 3.32 },
  { back: -0.1, front: 0.84, halfWidth: 0.44, y: 3.52 },
  { back: 0.18, front: 0.66, halfWidth: 0.25, y: 3.64 },
];

function boxy(around: number): number {
  const angle = around * FULL_TURN;

  return (Math.abs(Math.cos(angle)) ** BOXINESS + Math.abs(Math.sin(angle)) ** BOXINESS) ** (-1 / BOXINESS);
}

function ringSection(ring: BodyRing): LoftSection {
  return {
    centerZ: (ring.back + ring.front) / 2,
    radiusX: ring.halfWidth,
    radiusZ: (ring.front - ring.back) / 2,
    ripple: boxy,
    y: ring.y,
  };
}

function bodyShape(detail: AnimalDetail): Shape {
  const segments = detail.segments * 3 + 6;
  const shape = loft(
    alongPath(
      [
        { centerZ: -0.13, radiusX: 0, radiusZ: 0, y: 1.54 },
        { centerZ: -0.13, radiusX: 0.6, radiusZ: 0.9, y: 1.36 },
        ...BODY_RINGS.map(ringSection),
        { centerZ: 0.42, radiusX: 0, radiusZ: 0, y: 3.68 },
      ],
      detail
    ),
    segments
  );

  return deformShape(shape, (vertex) => {
    if (Math.abs(vertex.y - HEM_HEIGHT) < 1e-4) {
      const strand = Math.round(vertex.around * segments) % 2;
      const shag = Math.abs(FUR_NOISE.sample(vertex.x * 3, 0, vertex.z * 3));

      return [
        vertex.normalX * 0.04 * strand,
        -HEM_DEPTH - STRAND_DEPTH * strand - 0.05 * shag,
        vertex.normalZ * 0.04 * strand,
      ];
    }

    const fur = FUR_DEPTH * FUR_NOISE.fractal(vertex.x * 2.2, vertex.y * 2.2, vertex.z * 2.2, { octaves: 2 });

    return [vertex.normalX * fur, vertex.normalY * fur, vertex.normalZ * fur];
  });
}

function headShape(detail: AnimalDetail): Shape {
  return deformShape(lengthwiseLoft(alongPath(HEAD, detail), detail.segments + 4), (vertex) => {
    const fur = FUR_DEPTH * 0.8 * FUR_NOISE.fractal(vertex.x * 2.6 + 9, vertex.y * 2.6, vertex.z * 2.6, { octaves: 2 });

    return [vertex.normalX * fur, vertex.normalY * fur, vertex.normalZ * fur];
  });
}

function earShape(detail: AnimalDetail): Shape {
  const { segments } = detail;

  const flap = transformShape(
    sphere(1, segments, segmentsAtLeast(detail, 4, segments - 4)),
    transformOf({ scale: EAR_SIZE })
  );

  return deformShape(flap, (vertex) => {
    return [0, -(vertex.x * vertex.x + vertex.z * vertex.z) / (2 * HEAD_CURVATURE), 0];
  });
}

function addFace(builder: MeshBuilder, head: Shape, detail: AnimalDetail): void {
  const style = rigidStyle(QuadrupedBone.Head);
  const eyeHit = outermostHit(head, new Vector3(0, 2.92, 1.5), new Vector3(1, -0.05, 0.75));
  const earHit = outermostHit(head, new Vector3(0, 3.02, 1.12), new Vector3(1, 0.12, -0.2));
  const eyeShape = sphere(EYE_RADIUS, 6, 4);
  const flap = earShape(detail);
  const eyeStyle = { ...style, slot: MaterialSlot.Eye };
  const earStyle = { ...style, slot: MaterialSlot.Coat };

  for (const side of SIDES) {
    const mirror = sideMirror(side);

    if (eyeHit !== null && detail.hasSmallParts) {
      builder.add(eyeShape, {
        style: eyeStyle,
        transform: combine(mirror, surfaceTransform(eyeHit, EYE_RADIUS * 0.65)),
      });
    }

    if (earHit !== null) {
      builder.add(flap, {
        seam: EAR_SEAM,
        style: earStyle,
        transform: combine(mirror, surfaceTransform(earHit, 0.005)),
      });
    }
  }
}

function addHead(builder: MeshBuilder, detail: AnimalDetail): void {
  const head = headShape(detail);

  builder.add(head, { seam: HEAD_SEAM, style: { ...neckStyle(MAMMOTH_FRAME, 0.25), slot: MaterialSlot.Coat } });
  builder.add(tube(alongPath(TRUNK, detail), { radialSegments: detail.segments }), {
    seam: TRUNK_SEAM,
    style: { ...TRUNK_STYLE, slot: MaterialSlot.Coat },
  });
  addFace(builder, head, detail);
}

function tuskPath(length: number): TubePoint[] {
  return [
    { radius: 0.085, x: 0.16, y: 2.64, z: 1.66 },
    { radius: 0.085, x: 0.28, y: 2.45, z: 1.86 },
    { radius: 0.08, x: 0.34, y: 2.45 - 0.48 * length, z: 1.86 + 0.32 * length },
    { radius: 0.07, x: 0.34 + 0.14 * length, y: 2.45 - 0.78 * length, z: 1.86 + 0.82 * length },
    { radius: 0.055, x: 0.34 + 0.16 * length, y: 2.45 - 0.72 * length, z: 1.86 + 1.3 * length },
    { radius: 0.035, x: 0.34 + 0.02 * length, y: 2.45 - 0.42 * length, z: 1.86 + 1.55 * length },
    { radius: 0, x: 0.34 - 0.14 * length, y: 2.45 - 0.12 * length, z: 1.86 + 1.5 * length },
  ];
}

function addTusks(builder: MeshBuilder, detail: AnimalDetail, length: number): void {
  const style = { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Tusk };
  const tusk = tube(tuskPath(length), {
    hasEndCap: false,
    radialSegments: segmentsAtLeast(detail, 5, detail.segments - 2),
  });

  for (const side of SIDES) {
    builder.add(tusk, {
      style,
      transform: sideMirror(side),
    });
  }
}

export function addShortTusks(builder: MeshBuilder, detail: AnimalDetail): void {
  addTusks(builder, detail, 0.55);
}

export function addLongTusks(builder: MeshBuilder, detail: AnimalDetail): void {
  addTusks(builder, detail, 1);
}

export function addMammothBody(builder: MeshBuilder, detail: AnimalDetail): void {
  builder.add(bodyShape(detail), {
    seam: BODY_SEAM,
    style: { ...bodyStyle(MAMMOTH_FRAME, 0.5), slot: MaterialSlot.Coat },
  });
  addHead(builder, detail);
  addLegs(builder, {
    blend: BLEND,
    detail,
    frame: MAMMOTH_FRAME,
    paths: LEGS,
    seam: LEG_SEAM,
    segments: detail.segments,
    slot: hoofBelow(0.05),
  });
  builder.add(tube(TAIL, { radialSegments: segmentsAtLeast(detail, 5, detail.segments - 4) }), {
    seam: TAIL_SEAM,
    style: { ...tailStyle(MAMMOTH_FRAME, 0.15), slot: MaterialSlot.Coat },
  });
}

export function moveMammothTrunk(pose: Pose, clip: AnimalPose, phase: number): void {
  if (clip === "graze") {
    pose.rotate(MammothBone.TrunkBase, degrees(8), 0, 0);
    pose.rotate(MammothBone.TrunkMiddle, degrees(22) + degrees(10) * wave(phase * 3), 0, 0);
    pose.rotate(MammothBone.TrunkTip, degrees(48) + degrees(15) * wave(phase * 3, 0.2), 0, 0);

    return;
  }

  if (clip === "dead") {
    pose.rotate(MammothBone.TrunkMiddle, degrees(25), 0, 0);

    return;
  }

  pose.rotate(MammothBone.TrunkBase, -degrees(6) * wave(phase), degrees(4) * wave(phase, 0.25), 0);
  pose.rotate(MammothBone.TrunkMiddle, degrees(10) + degrees(8) * wave(phase, 0.1), 0, 0);
  pose.rotate(MammothBone.TrunkTip, degrees(18) + degrees(12) * wave(phase, 0.2), 0, 0);
}
