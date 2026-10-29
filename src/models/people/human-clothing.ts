import { alongPath, segmentsAtLeast } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import { type MeshBuilder, resolveChannel, type SurfacePoint, type VertexStyle } from "../mesh/mesh-builder.ts";
import { deformShape, type Shape, type ShapeVertex } from "../mesh/shape.ts";
import { type LoftSection, loft, panel, sphere, torus, tube } from "../mesh/shapes.ts";
import { combine, transformOf } from "../mesh/transforms.ts";
import { triangleWave } from "../rig/curves.ts";
import { FOOT_SECTIONS, footTransform, forEachSide } from "./human-anatomy.ts";
import { type HumanDetail, trimmedRing, trimSegments } from "./human-detail.ts";
import { FLEXIBLE_TORSO_STYLE, legStyle, skirtStyle } from "./human-rigging.ts";

const WAIST_LINE = 0.95;

const TUNIC: readonly LoftSection[] = [
  { radiusX: 0, radiusZ: 0, y: 0.75 },
  { radiusX: 0.13, radiusZ: 0.09, y: 0.72 },
  { centerZ: -0.006, radiusX: 0.205, radiusZ: 0.14, y: 0.7 },
  { centerZ: -0.004, radiusX: 0.205, radiusZ: 0.152, y: 0.78 },
  { centerZ: -0.004, radiusX: 0.204, radiusZ: 0.156, y: 0.86 },
  { centerZ: -0.008, radiusX: 0.2, radiusZ: 0.15, y: 0.93 },
  { centerZ: -0.004, radiusX: 0.176, radiusZ: 0.124, y: 0.99 },
  { centerZ: 0.008, radiusX: 0.167, radiusZ: 0.124, y: 1.05 },
  { centerZ: 0.01, radiusX: 0.168, radiusZ: 0.12, y: 1.12 },
  { centerZ: 0.01, radiusX: 0.178, radiusZ: 0.128, y: 1.2 },
  { centerZ: 0.018, radiusX: 0.192, radiusZ: 0.142, y: 1.28 },
  { centerZ: 0.006, radiusX: 0.202, radiusZ: 0.134, y: 1.35 },
  { centerZ: -0.012, radiusX: 0.198, radiusZ: 0.118, y: 1.41 },
  { centerZ: -0.012, radiusX: 0.13, radiusZ: 0.085, y: 1.445 },
  { centerZ: -0.01, radiusX: 0.075, radiusZ: 0.066, y: 1.462 },
  { centerZ: -0.01, radiusX: 0, radiusZ: 0, y: 1.468 },
];

const DRESS: readonly LoftSection[] = [
  { radiusX: 0, radiusZ: 0, y: 0.56 },
  { radiusX: 0.17, radiusZ: 0.14, y: 0.53 },
  { radiusX: 0.235, radiusZ: 0.19, y: 0.49 },
  { radiusX: 0.226, radiusZ: 0.18, y: 0.6 },
  { centerZ: -0.004, radiusX: 0.214, radiusZ: 0.168, y: 0.75 },
  { centerZ: -0.008, radiusX: 0.206, radiusZ: 0.158, y: 0.88 },
  { centerZ: -0.01, radiusX: 0.198, radiusZ: 0.146, y: 0.95 },
  { radiusX: 0.152, radiusZ: 0.108, y: 1.03 },
  { centerZ: 0.012, radiusX: 0.152, radiusZ: 0.11, y: 1.12 },
  { centerZ: 0.018, radiusX: 0.164, radiusZ: 0.126, y: 1.22 },
  { centerZ: 0.026, radiusX: 0.174, radiusZ: 0.142, y: 1.29 },
  { centerZ: 0.016, radiusX: 0.176, radiusZ: 0.13, y: 1.35 },
  { radiusX: 0.15, radiusZ: 0.1, y: 1.37 },
  { radiusX: 0, radiusZ: 0, y: 1.38 },
];

const LOINCLOTH: readonly LoftSection[] = [
  { radiusX: 0, radiusZ: 0, y: 0.83 },
  { radiusX: 0.12, radiusZ: 0.09, y: 0.8 },
  { centerZ: -0.004, radiusX: 0.19, radiusZ: 0.142, y: 0.78 },
  { centerZ: -0.006, radiusX: 0.19, radiusZ: 0.144, y: 0.86 },
  { centerZ: -0.01, radiusX: 0.188, radiusZ: 0.138, y: 0.94 },
  { centerZ: -0.006, radiusX: 0.165, radiusZ: 0.115, y: 1 },
  { radiusX: 0.12, radiusZ: 0.08, y: 1.02 },
  { radiusX: 0, radiusZ: 0, y: 1.03 },
];

const WRAP_SKIRT: readonly LoftSection[] = [
  { radiusX: 0, radiusZ: 0, y: 0.66 },
  { radiusX: 0.13, radiusZ: 0.1, y: 0.63 },
  { centerZ: -0.004, radiusX: 0.2, radiusZ: 0.15, y: 0.61 },
  { centerZ: -0.004, radiusX: 0.204, radiusZ: 0.156, y: 0.75 },
  { centerZ: -0.008, radiusX: 0.2, radiusZ: 0.15, y: 0.9 },
  { centerZ: -0.008, radiusX: 0.17, radiusZ: 0.118, y: 0.98 },
  { radiusX: 0.165, radiusZ: 0.112, y: 1.03 },
  { radiusX: 0.12, radiusZ: 0.08, y: 1.045 },
  { radiusX: 0, radiusZ: 0, y: 1.05 },
];

const CAPE: readonly LoftSection[] = [
  { centerZ: -0.02, radiusX: 0, radiusZ: 0, y: 1.3 },
  { centerZ: -0.022, radiusX: 0.14, radiusZ: 0.1, y: 1.27 },
  { centerZ: -0.026, radiusX: 0.236, radiusZ: 0.152, y: 1.25 },
  { centerZ: -0.02, radiusX: 0.236, radiusZ: 0.148, y: 1.32 },
  { centerZ: -0.016, radiusX: 0.226, radiusZ: 0.136, y: 1.39 },
  { centerZ: -0.014, radiusX: 0.168, radiusZ: 0.108, y: 1.44 },
  { centerZ: -0.01, radiusX: 0.09, radiusZ: 0.074, y: 1.47 },
  { centerZ: -0.01, radiusX: 0, radiusZ: 0, y: 1.483 },
];

const CLOAK: readonly LoftSection[] = [
  { centerZ: -0.04, radiusX: 0.27, radiusZ: 0.22, y: 0.42 },
  { centerZ: -0.04, radiusX: 0.25, radiusZ: 0.2, y: 0.7 },
  { centerZ: -0.03, radiusX: 0.23, radiusZ: 0.17, y: 1 },
  { centerZ: -0.02, radiusX: 0.23, radiusZ: 0.15, y: 1.3 },
  { centerZ: -0.015, radiusX: 0.21, radiusZ: 0.13, y: 1.42 },
  { centerZ: -0.01, radiusX: 0.12, radiusZ: 0.09, y: 1.47 },
];

interface Belt {
  readonly depthRatio: number;
  readonly radius: number;
  readonly y: number;
}

function jaggedEdge(shape: Shape, isEdge: (vertex: ShapeVertex) => boolean, teeth: number, depth: number): Shape {
  return deformShape(shape, (vertex) => {
    if (!isEdge(vertex)) {
      return [0, 0, 0];
    }

    return [0, -depth * triangleWave(vertex.around * teeth), 0];
  });
}

function jaggedHem(shape: Shape, belowY: number, teeth: number, depth: number): Shape {
  return jaggedEdge(
    shape,
    (vertex) => {
      return vertex.y <= belowY;
    },
    teeth,
    depth
  );
}

function jaggedTop(shape: Shape, aboveY: number, teeth: number, depth: number): Shape {
  return jaggedEdge(
    shape,
    (vertex) => {
      return vertex.y >= aboveY;
    },
    teeth,
    depth
  );
}

function garmentChannel(point: SurfacePoint, lower: VertexStyle, channel: "boneA" | "boneB" | "boneWeight"): number {
  const style = point.position.y >= WAIST_LINE ? FLEXIBLE_TORSO_STYLE : lower;

  return resolveChannel(style[channel], 0, point);
}

function garmentStyle(followsLegs: number, hemLine = 0.55): VertexStyle {
  const lower = skirtStyle(followsLegs, hemLine);

  return {
    boneA: (point) => {
      return garmentChannel(point, lower, "boneA");
    },
    boneB: (point) => {
      return garmentChannel(point, lower, "boneB");
    },
    boneWeight: (point) => {
      return garmentChannel(point, lower, "boneWeight");
    },
  };
}

function addBelt(builder: MeshBuilder, detail: HumanDetail, belt: Belt): void {
  const { depthRatio, radius, y } = belt;

  builder.add(trimmedRing(detail, radius, 0.012, 14), {
    style: { ...FLEXIBLE_TORSO_STYLE, slot: MaterialSlot.Accent },
    transform: transformOf({ position: [0, y, -0.004], scale: [1, 1, depthRatio] }),
  });
}

export function addTunic(builder: MeshBuilder, detail: HumanDetail): void {
  const shape = jaggedHem(loft(alongPath(TUNIC, detail), detail.torsoSegments), 0.73, 14, 0.035);

  builder.add(shape, { style: { ...garmentStyle(0.55), slot: MaterialSlot.Fur } });
  addBelt(builder, detail, { depthRatio: 0.75, radius: 0.176, y: 1.02 });
}

export function addDress(builder: MeshBuilder, detail: HumanDetail): void {
  const shape = jaggedHem(loft(alongPath(DRESS, detail), detail.torsoSegments), 0.535, 22, 0.03);

  builder.add(shape, { style: { ...garmentStyle(0.6, 0.5), slot: MaterialSlot.Hide } });
  addBelt(builder, detail, { depthRatio: 0.72, radius: 0.158, y: 1.03 });

  forEachSide((_side, mirror) => {
    builder.add(
      tube(
        [
          { radius: 0.016, x: 0.1, y: 1.33, z: 0.1 },
          { radius: 0.016, x: 0.12, y: 1.445, z: 0.03 },
          { radius: 0.016, x: 0.12, y: 1.445, z: -0.06 },
          { radius: 0.016, x: 0.1, y: 1.33, z: -0.1 },
        ],
        { radialSegments: trimSegments(detail, 5) }
      ),
      { style: { ...FLEXIBLE_TORSO_STYLE, slot: MaterialSlot.Hide }, transform: mirror }
    );
  });
}

export function addLoincloth(builder: MeshBuilder, detail: HumanDetail): void {
  const shape = jaggedHem(loft(alongPath(LOINCLOTH, detail), detail.torsoSegments), 0.81, 8, 0.06);

  builder.add(shape, { style: { ...garmentStyle(0.5, 0.75), slot: MaterialSlot.Hide } });
  addBelt(builder, detail, { depthRatio: 0.72, radius: 0.171, y: 0.995 });
}

export function addWrap(builder: MeshBuilder, detail: HumanDetail): void {
  const shape = jaggedHem(loft(alongPath(WRAP_SKIRT, detail), detail.torsoSegments), 0.64, 6, 0.07);

  builder.add(shape, { style: { ...garmentStyle(0.6, 0.6), slot: MaterialSlot.Hide } });
  builder.add(torus(1, 0.09, trimSegments(detail, 24), trimSegments(detail, 5)), {
    style: { ...FLEXIBLE_TORSO_STYLE, slot: MaterialSlot.Hide },
    transform: transformOf({ position: [0.01, 1.215, -0.006], rotation: [0, 0, 0.92], scale: [0.29, 0.29, 0.13] }),
  });
}

export function addCape(builder: MeshBuilder, detail: HumanDetail): void {
  const shape = jaggedHem(loft(alongPath(CAPE, detail), detail.torsoSegments), 1.28, 12, 0.045);

  builder.add(shape, { style: { ...FLEXIBLE_TORSO_STYLE, slot: MaterialSlot.Fur } });
}

export function addCloak(builder: MeshBuilder, detail: HumanDetail): void {
  const shape = panel({
    angularSegments: segmentsAtLeast(detail, 6, detail.torsoSegments - 4),
    endAngle: Math.PI * 2.12,
    sections: alongPath(CLOAK, detail),
    startAngle: Math.PI * 0.88,
    thickness: 0.022,
  });

  builder.add(jaggedHem(shape, 0.45, 9, 0.05), { style: { ...garmentStyle(0.35, 0.45), slot: MaterialSlot.Fur } });

  if (!detail.hasSmallParts) {
    return;
  }

  builder.add(sphere(0.018, 6, 4), {
    style: { ...FLEXIBLE_TORSO_STYLE, slot: MaterialSlot.Bone },
    transform: transformOf({ position: [0, 1.42, 0.085] }),
  });
}

export function addBoots(builder: MeshBuilder, detail: HumanDetail): void {
  forEachSide((side, mirror) => {
    const style = { ...legStyle(side), slot: MaterialSlot.Fur };
    const wrap = loft(
      [
        { radiusX: 0, radiusZ: 0, y: 0.05 },
        { centerZ: -0.008, radiusX: 0.04, radiusZ: 0.042, y: 0.06 },
        { centerZ: -0.008, radiusX: 0.042, radiusZ: 0.044, y: 0.18 },
        { centerZ: -0.006, radiusX: 0.048, radiusZ: 0.05, y: 0.29 },
        { centerZ: -0.006, radiusX: 0.02, radiusZ: 0.02, y: 0.3 },
        { centerZ: -0.006, radiusX: 0, radiusZ: 0, y: 0.302 },
      ],
      detail.limbSegments
    );

    builder.add(loft(alongPath(FOOT_SECTIONS, detail), detail.limbSegments), {
      style,
      transform: combine(footTransform(side), transformOf({ position: [0, -0.003, -0.003], scale: [1.16, 1.1, 1.14] })),
    });
    builder.add(jaggedTop(wrap, 0.28, 7, 0.025), {
      style,
      transform: combine(mirror, transformOf({ position: [0.1, 0, 0] })),
    });
  });
}
