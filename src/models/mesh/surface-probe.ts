import { type Matrix4, Vector3 } from "three";
import { segmentTransform } from "./transforms.ts";

const PARALLEL_LIMIT = 1e-12;
const firstEdge = new Vector3();
const secondEdge = new Vector3();
const fromFirst = new Vector3();
const perpendicular = new Vector3();
const across = new Vector3();

interface Surface {
  readonly indices: Uint32Array;
  readonly positions: Float32Array;
}

interface SurfaceHit {
  readonly distance: number;
  readonly normal: Vector3;
  readonly point: Vector3;
  readonly triangle: number;
}

type TriangleFilter = (triangle: number) => boolean;

type Corners = readonly [Vector3, Vector3, Vector3];

function everyTriangle(): boolean {
  return true;
}

function readCorners(surface: Surface, triangle: number, corners: Corners): void {
  const { indices, positions } = surface;
  const [first, second, third] = corners;

  const offset = triangle * 3;

  first.fromArray(positions, indices[offset] * 3);
  second.fromArray(positions, indices[offset + 1] * 3);
  third.fromArray(positions, indices[offset + 2] * 3);
}

function crossingDistance(origin: Vector3, direction: Vector3, corners: Corners): number | null {
  const [first, second, third] = corners;

  firstEdge.subVectors(second, first);
  secondEdge.subVectors(third, first);
  fromFirst.subVectors(origin, first);

  perpendicular.crossVectors(direction, secondEdge);
  across.crossVectors(fromFirst, firstEdge);

  const determinant = firstEdge.dot(perpendicular);

  if (Math.abs(determinant) < PARALLEL_LIMIT) {
    return null;
  }

  const firstWeight = fromFirst.dot(perpendicular) / determinant;
  const secondWeight = direction.dot(across) / determinant;

  if (firstWeight < 0 || secondWeight < 0 || firstWeight + secondWeight > 1) {
    return null;
  }

  const distance = secondEdge.dot(across) / determinant;

  if (distance <= 0) {
    return null;
  }

  return distance;
}

function normalAlong(corners: Corners, direction: Vector3): Vector3 {
  const [first, second, third] = corners;

  const normal = second.clone().sub(first).cross(third.clone().sub(first)).normalize();

  if (normal.dot(direction) < 0) {
    return normal.negate();
  }

  return normal;
}

export function outermostHit(
  surface: Surface,
  origin: Vector3,
  direction: Vector3,
  includes: TriangleFilter = everyTriangle
): SurfaceHit | null {
  const unit = direction.clone().normalize();
  const corners: Corners = [new Vector3(), new Vector3(), new Vector3()];

  let outermost: SurfaceHit | null = null;
  let farthest = 0;

  for (let triangle = 0; triangle < surface.indices.length / 3; triangle += 1) {
    if (!includes(triangle)) {
      continue;
    }

    readCorners(surface, triangle, corners);

    const distance = crossingDistance(origin, unit, corners);

    if (distance === null || distance <= farthest) {
      continue;
    }

    farthest = distance;
    outermost = {
      distance,
      normal: normalAlong(corners, unit),
      point: origin.clone().addScaledVector(unit, distance),
      triangle,
    };
  }

  return outermost;
}

export function surfaceTransform(hit: SurfaceHit, depth = 0): Matrix4 {
  const base = hit.point.clone().addScaledVector(hit.normal, -depth);
  const tip = base.clone().add(hit.normal);

  return segmentTransform(base.toArray(), tip.toArray());
}
