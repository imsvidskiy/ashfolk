import { type Matrix4, Vector3 } from "three";
import { alongPath, type DetailSteps, segmentsUpTo } from "../level-of-detail.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { MeshBuilder, SurfacePoint, VertexStyle } from "../mesh/mesh-builder.ts";
import { type Shape, transformShape } from "../mesh/shape.ts";
import { type BodySection, lengthwiseLoft, sphere } from "../mesh/shapes.ts";
import { outermostHit, surfaceTransform } from "../mesh/surface-probe.ts";
import { combine, SIDES, sideMirror, type TransformOptions, type Triple, transformOf } from "../mesh/transforms.ts";
import { type TubePoint, tube } from "../mesh/tubes.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import type { AnimalDetail } from "./animal-detail.ts";
import { legStyle } from "./quadruped-rigging.ts";
import { LEG_ENDS, type LegEnd, QuadrupedBone, type QuadrupedFrame } from "./quadruped-skeleton.ts";

type LegPoint = readonly [radius: number, y: number, z: number, inset?: number];

interface LegOptions {
  readonly blend: number;
  readonly detail: DetailSteps;
  readonly frame: QuadrupedFrame;
  readonly paths: Readonly<Record<LegEnd, readonly TubePoint[]>>;
  readonly seam: number;
  readonly segments: number;
  readonly slot: MaterialSlotIndex | ((point: SurfacePoint) => MaterialSlotIndex);
}

interface EyeOptions {
  readonly direction: Triple;
  readonly origin: Triple;
  readonly radius: number;
  readonly sink: number;
}

interface FaceOptions {
  readonly eyes: EyeOptions;
  readonly nose: Triple;
  readonly noseRadius: number;
}

interface EarOptions {
  readonly placement: TransformOptions;
  readonly seam: number;
  readonly stretch: Matrix4;
}

export function legPath(x: number, points: readonly LegPoint[]): TubePoint[] {
  return points.map(([radius, y, z, inset = 0]) => {
    return { radius, x: x - inset, y, z };
  });
}

export function addLegs(builder: MeshBuilder, options: LegOptions): void {
  const { blend, detail, frame, paths, seam, segments, slot } = options;

  const legs: Readonly<Record<LegEnd, Shape>> = {
    front: tube(alongPath(paths.front, detail), { radialSegments: segments }),
    hind: tube(alongPath(paths.hind, detail), { radialSegments: segments }),
  };

  for (const side of SIDES) {
    for (const end of LEG_ENDS) {
      const style: VertexStyle = { ...legStyle(frame, end, side, blend), slot };

      builder.add(legs[end], {
        seam,
        style,
        transform: sideMirror(side),
      });
    }
  }
}

export function bodyShape(sections: readonly BodySection[], detail: AnimalDetail): Shape {
  return lengthwiseLoft(sections, detail.segments + 2);
}

export function muzzleShape(points: readonly TubePoint[], detail: AnimalDetail, narrowing: number): Shape {
  const muzzle = tube(alongPath(points, detail), { hasEndCap: false, radialSegments: detail.segments });

  return transformShape(muzzle, transformOf({ scale: [narrowing, 1, 1] }));
}

export function hoofBelow(height: number): (point: SurfacePoint) => MaterialSlotIndex {
  return (point) => {
    return point.position.y < height ? MaterialSlot.Hoof : MaterialSlot.Coat;
  };
}

function addEyes(builder: MeshBuilder, head: Shape, options: EyeOptions): void {
  const { direction, origin, radius, sink } = options;

  const hit = outermostHit(head, new Vector3(...origin), new Vector3(...direction));

  if (hit === null) {
    return;
  }

  const eye = sphere(radius, 6, 4);
  const style = { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Eye };

  for (const side of SIDES) {
    builder.add(eye, {
      style,
      transform: combine(sideMirror(side), surfaceTransform(hit, radius * sink)),
    });
  }
}

export function addMuzzleFace(builder: MeshBuilder, head: Shape, detail: DetailSteps, options: FaceOptions): void {
  const { eyes, nose, noseRadius } = options;

  if (!detail.hasSmallParts) {
    return;
  }

  builder.add(sphere(noseRadius, 6, 4), {
    style: { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Hoof },
    transform: transformOf({ position: nose }),
  });
  addEyes(builder, head, eyes);
}

export function addEllipsoidEars(builder: MeshBuilder, detail: DetailSteps, options: EarOptions): void {
  const { placement, seam, stretch } = options;

  const ear = sphere(1, segmentsUpTo(detail, 6), 4);
  const style = { ...rigidStyle(QuadrupedBone.Head), slot: MaterialSlot.Coat };

  for (const side of SIDES) {
    builder.add(ear, { seam, style, transform: combine(sideMirror(side), transformOf(placement), stretch) });
  }
}
