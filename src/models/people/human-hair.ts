import { lerp, smoothstep } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { alongPath, segmentsAtLeast } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder } from "../mesh/mesh-builder.ts";
import { deformShape, type Shape, type ShapeVertex } from "../mesh/shape.ts";
import { type LoftSection, loft, panel, sphere, type TubePoint, tube } from "../mesh/shapes.ts";
import { combine, transformOf } from "../mesh/transforms.ts";
import { triangleWave } from "../rig/curves.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import { forEachSide, HEAD_AXIS_Z, HEAD_CROWN, HEAD_SECTIONS } from "./human-anatomy.ts";
import { type HumanDetail, trimmedRing } from "./human-detail.ts";
import { headToChestStyle } from "./human-rigging.ts";
import { HumanBone } from "./human-skeleton.ts";

const HAIR = { ...rigidStyle(HumanBone.Head), slot: MaterialSlot.Hair };
const HAIR_NOISE = createVolumeNoise(createRandom(911));
const HEAD_PROFILE = HEAD_SECTIONS.slice(2, -1);
const CURTAIN_START = Math.PI * 1.04;
const CURTAIN_END = Math.PI * 1.96;
const CURTAIN_THICKNESS = 0.03;
const CURTAIN_BOTTOM = 1.37;
const SHELL_BOTTOM = 1.555;
const BEARD_TUCK = 0.02;

const BEARD_SECTIONS: readonly LoftSection[] = [
  { centerZ: 0.052, radiusX: 0, radiusZ: 0, y: 1.5 },
  { centerZ: 0.054, radiusX: 0.034, radiusZ: 0.03, y: 1.51 },
  { centerZ: 0.03, radiusX: 0.071, radiusZ: 0.08, y: 1.545 },
  { centerZ: 0.013, radiusX: 0.092, radiusZ: 0.103, y: 1.58 },
  { centerZ: 0.003, radiusX: 0.101, radiusZ: 0.112, y: 1.62 },
  { centerZ: 0.003, radiusX: 0, radiusZ: 0, y: 1.63 },
];

const FULL_BEARD_SECTIONS: readonly LoftSection[] = [
  { centerZ: 0.072, radiusX: 0, radiusZ: 0, y: 1.39 },
  { centerZ: 0.074, radiusX: 0.03, radiusZ: 0.022, y: 1.41 },
  { centerZ: 0.072, radiusX: 0.058, radiusZ: 0.042, y: 1.46 },
  { centerZ: 0.058, radiusX: 0.072, radiusZ: 0.062, y: 1.505 },
  { centerZ: 0.03, radiusX: 0.078, radiusZ: 0.084, y: 1.545 },
  ...BEARD_SECTIONS.slice(3),
];

const SIDE_COVERAGE = hairlineCoverage(1.75, 1.585);

interface ShellOptions {
  readonly coverage: (vertex: ShapeVertex) => number;
  readonly offset: number;
  readonly roughness: number;
}

interface CurtainRing {
  readonly flare: number;
  readonly y: number;
}

const CURTAIN_RINGS: readonly CurtainRing[] = [
  { flare: 0, y: 1.7 },
  { flare: 0, y: 1.64 },
  { flare: 0.006, y: 1.56 },
  { flare: 0.018, y: 1.47 },
  { flare: 0.03, y: 1.41 },
  { flare: 0.034, y: CURTAIN_BOTTOM },
];

const LOW_CURTAIN_RINGS: readonly CurtainRing[] = [
  { flare: 0, y: 1.7 },
  { flare: 0.006, y: 1.56 },
  { flare: 0.034, y: CURTAIN_BOTTOM },
];

function sectionAt(sections: readonly LoftSection[], y: number): LoftSection {
  const upperIndex = sections.findIndex((section) => {
    return section.y >= y;
  });

  if (upperIndex <= 0) {
    return sections[0];
  }

  const lower = sections[upperIndex - 1];
  const upper = sections[upperIndex];

  const { centerZ: lowerCenter = 0 } = lower;
  const { centerZ: upperCenter = 0 } = upper;

  const amount = (y - lower.y) / (upper.y - lower.y);

  return {
    centerZ: lerp(lowerCenter, upperCenter, amount),
    radiusX: lerp(lower.radiusX, upper.radiusX, amount),
    radiusZ: lerp(lower.radiusZ, upper.radiusZ, amount),
    y,
  };
}

function grown(section: LoftSection, offset: number): LoftSection {
  return { ...section, radiusX: section.radiusX + offset, radiusZ: section.radiusZ + offset };
}

function headShell(detail: HumanDetail, options: ShellOptions): Shape {
  const { coverage, offset, roughness } = options;

  const bottomSection = sectionAt(HEAD_PROFILE, SHELL_BOTTOM + 0.006);

  const { centerZ = 0 } = bottomSection;

  const sections: LoftSection[] = [
    { centerZ, radiusX: 0, radiusZ: 0, y: SHELL_BOTTOM },
    grown(bottomSection, offset),
    ...HEAD_PROFILE.filter((section) => {
      return section.y > SHELL_BOTTOM + 0.012;
    }).map((section) => {
      return grown(section, offset);
    }),
    { centerZ: -0.012, radiusX: 0, radiusZ: 0, y: HEAD_CROWN + offset },
  ];
  const shell = loft(alongPath(sections, detail), detail.headSegments + 2);

  return deformShape(shell, (vertex) => {
    const { centerZ: axisZ = 0 } = sectionAt(HEAD_PROFILE, Math.min(vertex.y, HEAD_CROWN - 0.01));

    const covered = coverage(vertex);
    const texture = roughness * HAIR_NOISE.fractal(vertex.x * 38, vertex.y * 38, vertex.z * 38, { octaves: 2 });
    const tuck = (offset + 0.012) * (1 - covered);
    const alongNormal = texture * covered - tuck * smoothstep(1.6, 1.68, vertex.y);
    const inward = tuck * (1 - smoothstep(1.6, 1.68, vertex.y));
    const offsetZ = vertex.z - axisZ;
    const distance = Math.max(Math.hypot(vertex.x, offsetZ), 1e-6);

    return [
      vertex.normalX * alongNormal - (vertex.x / distance) * inward,
      vertex.normalY * alongNormal,
      vertex.normalZ * alongNormal - (offsetZ / distance) * inward,
    ];
  });
}

function frontness(vertex: ShapeVertex): number {
  const forward = vertex.z - HEAD_AXIS_Z;
  const length = Math.hypot(vertex.x, forward);

  if (length === 0) {
    return 0;
  }

  return Math.max(0, forward / length);
}

function hairlineCoverage(front: number, side: number): (vertex: ShapeVertex) => number {
  return (vertex) => {
    const amount = frontness(vertex);
    const hairline = lerp(side, front, amount ** 1.6);

    return smoothstep(hairline - 0.006, hairline + 0.006, vertex.y);
  };
}

function capShell(detail: HumanDetail, offset: number, front = 1.688, side = 1.585): Shape {
  return headShell(detail, { coverage: hairlineCoverage(front, side), offset, roughness: 0.004 });
}

export function addShortHair(builder: MeshBuilder, detail: HumanDetail): void {
  builder.add(capShell(detail, 0.012), { style: HAIR });
}

export function addWildHair(builder: MeshBuilder, detail: HumanDetail): void {
  const shell = headShell(detail, {
    coverage: hairlineCoverage(1.672, 1.57),
    offset: 0.026,
    roughness: 0.022,
  });

  builder.add(shell, { style: HAIR });
}

function ringCoverage(vertex: ShapeVertex): number {
  const sides = SIDE_COVERAGE(vertex);
  const balding = 1 - smoothstep(1.655, 1.67, vertex.y);

  return sides * balding * (1 - frontness(vertex) ** 2);
}

export function addFringeHair(builder: MeshBuilder, detail: HumanDetail): void {
  const shell = headShell(detail, { coverage: ringCoverage, offset: 0.01, roughness: 0.006 });

  builder.add(shell, { style: HAIR });
}

function curtainSection(ring: CurtainRing, strands: number): LoftSection {
  const { centerZ = 0, radiusX, radiusZ } = sectionAt(HEAD_PROFILE, Math.max(ring.y, 1.62));

  const reach = 0.014 - CURTAIN_THICKNESS / 2 + ring.flare;

  return {
    centerZ: centerZ - ring.flare * 0.8,
    radiusX: radiusX + reach,
    radiusZ: radiusZ + reach,
    ripple: (around) => {
      return 1 + 0.035 * Math.abs(Math.sin(around * Math.PI * strands)) * smoothstep(1.66, 1.5, ring.y);
    },
    y: ring.y,
  };
}

function curtainShape(detail: HumanDetail): Shape {
  const strands = detail.hasFineDetails ? 7 : 5;
  const rings = detail.hasFineDetails ? CURTAIN_RINGS : LOW_CURTAIN_RINGS;
  const curtain = panel({
    angularSegments: detail.hasFineDetails ? 14 : 8,
    endAngle: CURTAIN_END,
    sections: rings
      .map((ring) => {
        return curtainSection(ring, strands);
      })
      .reverse(),
    startAngle: CURTAIN_START,
    thickness: CURTAIN_THICKNESS,
  });

  return deformShape(curtain, (vertex) => {
    if (vertex.y > CURTAIN_BOTTOM + 0.01) {
      return [0, 0, 0];
    }

    return [0, -0.05 * triangleWave(vertex.around * strands + 0.5), 0];
  });
}

export function addLongHair(builder: MeshBuilder, detail: HumanDetail): void {
  builder.add(capShell(detail, 0.014, 1.688, 1.56), { style: HAIR });
  builder.add(curtainShape(detail), { style: { ...headToChestStyle(1.56, 1.4), slot: MaterialSlot.Hair } });
}

function braidPath(): TubePoint[] {
  const points: TubePoint[] = [];
  const count = 14;

  for (let index = 0; index <= count; index += 1) {
    const amount = index / count;
    const bulge = index % 2 === 0 ? 1 : 0.72;

    points.push({
      radius: lerp(0.024, 0.016, amount) * bulge,
      x: lerp(0.088, 0.122, amount),
      y: lerp(1.61, 1.3, amount),
      z: lerp(-0.01, 0.092, amount ** 0.8),
    });
  }

  return points;
}

export function addBraids(builder: MeshBuilder, detail: HumanDetail): void {
  const braid = alongPath(braidPath(), detail);
  const style = { ...headToChestStyle(1.58, 1.42), slot: MaterialSlot.Hair };

  builder.add(capShell(detail, 0.012), { style: HAIR });

  forEachSide((_side, mirror) => {
    builder.add(tube(braid, { radialSegments: segmentsAtLeast(detail, 5, detail.limbSegments - 2) }), {
      style,
      transform: mirror,
    });
    builder.add(trimmedRing(detail, 0.016, 0.006, 8), {
      style: { ...style, slot: MaterialSlot.Accent },
      transform: combine(mirror, transformOf({ position: [0.12, 1.325, 0.088], rotation: [0.3, 0, 0] })),
    });
  });
}

export function addBun(builder: MeshBuilder, detail: HumanDetail): void {
  builder.add(capShell(detail, 0.012, 1.7, 1.575), { style: HAIR });
  builder.add(sphere(0.05, detail.headSegments, segmentsAtLeast(detail, 6, 4)), {
    style: HAIR,
    transform: transformOf({ position: [0, 1.722, -0.088], scale: [1, 0.86, 0.92] }),
  });

  if (!detail.hasSmallParts) {
    return;
  }

  builder.add(
    tube(
      [
        { radius: 0.005, x: -0.07, y: 1.74, z: -0.08 },
        { radius: 0.005, x: 0.07, y: 1.71, z: -0.095 },
      ],
      { radialSegments: 4 }
    ),
    {
      style: { ...rigidStyle(HumanBone.Head), slot: MaterialSlot.Bone },
    }
  );
}

export function addPonytail(builder: MeshBuilder, detail: HumanDetail): void {
  builder.add(capShell(detail, 0.012), { style: HAIR });
  builder.add(
    tube(
      [
        { radius: 0.03, x: 0, y: 1.69, z: -0.1 },
        { radius: 0.034, x: 0, y: 1.63, z: -0.135 },
        { radius: 0.029, x: 0, y: 1.54, z: -0.15 },
        { radius: 0.018, x: 0, y: 1.46, z: -0.15 },
        { radius: 0, x: 0, y: 1.41, z: -0.145 },
      ],
      { hasEndCap: false, radialSegments: segmentsAtLeast(detail, 5, detail.limbSegments - 2) }
    ),
    { style: { ...headToChestStyle(1.62, 1.46), slot: MaterialSlot.Hair } }
  );
  builder.add(trimmedRing(detail, 0.03, 0.007, 8), {
    style: { ...rigidStyle(HumanBone.Head), slot: MaterialSlot.Accent },
    transform: transformOf({ position: [0, 1.672, -0.112], rotation: [1.2, 0, 0] }),
  });
}

function beardCoverage(vertex: ShapeVertex): number {
  const front = smoothstep(-0.03, 0.02, vertex.z);
  const below = 1 - smoothstep(1.598, 1.61, vertex.y);
  const lip =
    smoothstep(0.03, 0.022, Math.abs(vertex.x)) *
    smoothstep(1.553, 1.558, vertex.y) *
    smoothstep(1.578, 1.572, vertex.y);

  return front * below * (1 - lip);
}

function beardShell(detail: HumanDetail, sections: readonly LoftSection[]): Shape {
  return deformShape(loft(alongPath(sections, detail), detail.headSegments), (vertex) => {
    const { centerZ = 0 } = sectionAt(sections, vertex.y);

    const tuck = BEARD_TUCK * (1 - beardCoverage(vertex));
    const offsetZ = vertex.z - centerZ;
    const distance = Math.hypot(vertex.x, offsetZ);

    if (distance === 0) {
      return [0, 0, 0];
    }

    return [(-vertex.x / distance) * tuck, 0, (-offsetZ / distance) * tuck];
  });
}

export function addShortBeard(builder: MeshBuilder, detail: HumanDetail): void {
  builder.add(beardShell(detail, BEARD_SECTIONS), { style: HAIR });
}

export function addFullBeard(builder: MeshBuilder, detail: HumanDetail): void {
  builder.add(beardShell(detail, FULL_BEARD_SECTIONS), { style: HAIR });
}
