import { smoothstep } from "../../shared/math.ts";
import type { Triple } from "./transforms.ts";

const INSIDE_TOLERANCE = 1e-4;
const SEAM_EPSILON = 1e-4;
const SHORTEST_SUM = 0.3;
const ROUNDING_SLACK = 1e-9;
const barycentric = new Float64Array(3);

export interface SeamSurface {
  readonly firstTriangle: number;
  readonly firstVertex: number;
  readonly isReference: boolean;
  readonly reach: number;
  readonly triangleCount: number;
  readonly vertexCount: number;
}

interface SeamGeometry {
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
}

interface PreparedSurface {
  readonly maximum: readonly [number, number, number];
  readonly minimum: readonly [number, number, number];
  readonly sphereCenters: Float32Array;
  readonly sphereRadii: Float32Array;
  readonly surface: SeamSurface;
}

interface Nearest {
  readonly distance: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly side: number;
  readonly triangle: number;
}

interface Blend {
  readonly isReference: boolean;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly weight: number;
}

function prepareSurface(geometry: SeamGeometry, surface: SeamSurface): PreparedSurface {
  const { indices, positions } = geometry;

  const minimum: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const maximum: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const sphereCenters = new Float32Array(surface.triangleCount * 3);
  const sphereRadii = new Float32Array(surface.triangleCount);

  for (let vertex = surface.firstVertex; vertex < surface.firstVertex + surface.vertexCount; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], positions[vertex * 3 + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[vertex * 3 + axis]);
    }
  }

  for (let triangle = 0; triangle < surface.triangleCount; triangle += 1) {
    const corner = (surface.firstTriangle + triangle) * 3;

    for (let axis = 0; axis < 3; axis += 1) {
      sphereCenters[triangle * 3 + axis] =
        (positions[indices[corner] * 3 + axis] +
          positions[indices[corner + 1] * 3 + axis] +
          positions[indices[corner + 2] * 3 + axis]) /
        3;
    }

    let radius = 0;

    for (let side = 0; side < 3; side += 1) {
      const vertex = indices[corner + side] * 3;

      radius = Math.max(
        radius,
        Math.hypot(
          positions[vertex] - sphereCenters[triangle * 3],
          positions[vertex + 1] - sphereCenters[triangle * 3 + 1],
          positions[vertex + 2] - sphereCenters[triangle * 3 + 2]
        )
      );
    }

    sphereRadii[triangle] = radius;
  }

  return { maximum, minimum, sphereCenters, sphereRadii, surface };
}

function isNearBounds(prepared: PreparedSurface, x: number, y: number, z: number, margin: number): boolean {
  const { maximum, minimum } = prepared;

  return (
    x >= minimum[0] - margin &&
    x <= maximum[0] + margin &&
    y >= minimum[1] - margin &&
    y <= maximum[1] + margin &&
    z >= minimum[2] - margin &&
    z <= maximum[2] + margin
  );
}

function boundsOverlap(first: PreparedSurface, second: PreparedSurface, margin: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (first.minimum[axis] - margin > second.maximum[axis] || second.minimum[axis] - margin > first.maximum[axis]) {
      return false;
    }
  }

  return true;
}

function setWeights(first: number, second: number, third: number): void {
  barycentric[0] = first;
  barycentric[1] = second;
  barycentric[2] = third;
}

function closestWeights(
  positions: Float32Array,
  indices: Uint32Array,
  offset: number,
  x: number,
  y: number,
  z: number
): void {
  const first = indices[offset] * 3;
  const second = indices[offset + 1] * 3;
  const third = indices[offset + 2] * 3;

  const edgeAX = positions[second] - positions[first];
  const edgeAY = positions[second + 1] - positions[first + 1];
  const edgeAZ = positions[second + 2] - positions[first + 2];
  const edgeBX = positions[third] - positions[first];
  const edgeBY = positions[third + 1] - positions[first + 1];
  const edgeBZ = positions[third + 2] - positions[first + 2];
  const fromFirstX = x - positions[first];
  const fromFirstY = y - positions[first + 1];
  const fromFirstZ = z - positions[first + 2];

  const firstDot = edgeAX * fromFirstX + edgeAY * fromFirstY + edgeAZ * fromFirstZ;
  const secondDot = edgeBX * fromFirstX + edgeBY * fromFirstY + edgeBZ * fromFirstZ;

  if (firstDot <= 0 && secondDot <= 0) {
    setWeights(1, 0, 0);

    return;
  }

  const fromSecondX = x - positions[second];
  const fromSecondY = y - positions[second + 1];
  const fromSecondZ = z - positions[second + 2];

  const thirdDot = edgeAX * fromSecondX + edgeAY * fromSecondY + edgeAZ * fromSecondZ;
  const fourthDot = edgeBX * fromSecondX + edgeBY * fromSecondY + edgeBZ * fromSecondZ;

  if (thirdDot >= 0 && fourthDot <= thirdDot) {
    setWeights(0, 1, 0);

    return;
  }

  const thirdArea = firstDot * fourthDot - thirdDot * secondDot;

  if (thirdArea <= 0 && firstDot >= 0 && thirdDot <= 0) {
    const along = firstDot / (firstDot - thirdDot);

    setWeights(1 - along, along, 0);

    return;
  }

  const fromThirdX = x - positions[third];
  const fromThirdY = y - positions[third + 1];
  const fromThirdZ = z - positions[third + 2];

  const fifthDot = edgeAX * fromThirdX + edgeAY * fromThirdY + edgeAZ * fromThirdZ;
  const sixthDot = edgeBX * fromThirdX + edgeBY * fromThirdY + edgeBZ * fromThirdZ;

  if (sixthDot >= 0 && fifthDot <= sixthDot) {
    setWeights(0, 0, 1);

    return;
  }

  const secondArea = fifthDot * secondDot - firstDot * sixthDot;

  if (secondArea <= 0 && secondDot >= 0 && sixthDot <= 0) {
    const along = secondDot / (secondDot - sixthDot);

    setWeights(1 - along, 0, along);

    return;
  }

  const firstArea = thirdDot * sixthDot - fifthDot * fourthDot;

  if (firstArea <= 0 && fourthDot - thirdDot >= 0 && fifthDot - sixthDot >= 0) {
    const along = (fourthDot - thirdDot) / (fourthDot - thirdDot + (fifthDot - sixthDot));

    setWeights(0, 1 - along, along);

    return;
  }

  const total = 1 / (firstArea + secondArea + thirdArea);

  setWeights(1 - (secondArea + thirdArea) * total, secondArea * total, thirdArea * total);
}

function exceeds(x: number, y: number, z: number, offset: number, limit: number): boolean {
  const rough = Math.sqrt(x * x + y * y + z * z) - offset;

  if (rough > limit + ROUNDING_SLACK) {
    return true;
  }

  if (rough < limit - ROUNDING_SLACK) {
    return false;
  }

  return Math.hypot(x, y, z) - offset > limit;
}

function nearestOnSurface(
  geometry: SeamGeometry,
  prepared: PreparedSurface,
  x: number,
  y: number,
  z: number,
  reach: number
): Nearest | null {
  const { indices, normals, positions } = geometry;
  const { sphereCenters, sphereRadii, surface } = prepared;

  let best = reach;
  let nearest: Nearest | null = null;

  for (let triangle = 0; triangle < surface.triangleCount; triangle += 1) {
    const centerX = x - sphereCenters[triangle * 3];
    const centerY = y - sphereCenters[triangle * 3 + 1];
    const centerZ = z - sphereCenters[triangle * 3 + 2];

    if (exceeds(centerX, centerY, centerZ, sphereRadii[triangle], best)) {
      continue;
    }

    const corner = (surface.firstTriangle + triangle) * 3;

    closestWeights(positions, indices, corner, x, y, z);

    let pointX = 0;
    let pointY = 0;
    let pointZ = 0;
    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;

    for (let side = 0; side < 3; side += 1) {
      const vertex = indices[corner + side] * 3;
      const weight = barycentric[side];

      pointX += positions[vertex] * weight;
      pointY += positions[vertex + 1] * weight;
      pointZ += positions[vertex + 2] * weight;
      normalX += normals[vertex] * weight;
      normalY += normals[vertex + 1] * weight;
      normalZ += normals[vertex + 2] * weight;
    }

    if (exceeds(x - pointX, y - pointY, z - pointZ, 0, best)) {
      continue;
    }

    const distance = Math.hypot(x - pointX, y - pointY, z - pointZ);

    const length = Math.hypot(normalX, normalY, normalZ);

    if (length === 0) {
      continue;
    }

    best = distance;
    nearest = {
      distance,
      normalX: normalX / length,
      normalY: normalY / length,
      normalZ: normalZ / length,
      side: ((x - pointX) * normalX + (y - pointY) * normalY + (z - pointZ) * normalZ) / length,
      triangle: surface.firstTriangle + triangle,
    };
  }

  return nearest;
}

function sideOf(geometry: SeamGeometry, owner: PreparedSurface, vertex: number, sides: Map<number, number>): number {
  const known = sides.get(vertex);

  if (known !== undefined) {
    return known;
  }

  const { positions } = geometry;

  const nearest = nearestOnSurface(
    geometry,
    owner,
    positions[vertex * 3],
    positions[vertex * 3 + 1],
    positions[vertex * 3 + 2],
    Number.POSITIVE_INFINITY
  );

  const side = nearest === null ? Number.POSITIVE_INFINITY : nearest.side;

  sides.set(vertex, side);

  return side;
}

function straddles(
  geometry: SeamGeometry,
  owner: PreparedSurface,
  triangle: number,
  sides: Map<number, number>
): boolean {
  let hasInside = false;
  let hasOutside = false;

  for (let corner = 0; corner < 3; corner += 1) {
    const side = sideOf(geometry, owner, geometry.indices[triangle * 3 + corner], sides);

    if (Math.abs(side) <= SEAM_EPSILON) {
      return true;
    }

    if (side < 0) {
      hasInside = true;
    } else {
      hasOutside = true;
    }
  }

  return hasInside && hasOutside;
}

function collectBlends(
  geometry: SeamGeometry,
  owner: PreparedSurface,
  other: PreparedSurface,
  blends: Map<number, Blend>,
  hidden: Set<number>
): void {
  const { positions } = geometry;
  const { firstVertex, reach, vertexCount } = owner.surface;

  const sides = new Map<number, number>();

  for (let vertex = firstVertex; vertex < firstVertex + vertexCount; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];

    if (hidden.has(vertex) || !isNearBounds(other, x, y, z, reach)) {
      continue;
    }

    const nearest = nearestOnSurface(geometry, other, x, y, z, reach);

    if (nearest === null) {
      continue;
    }

    if (nearest.side < -INSIDE_TOLERANCE) {
      hidden.add(vertex);
      blends.delete(vertex);

      continue;
    }

    const known = blends.get(vertex);
    const weight = smoothstep(reach, 0, nearest.distance);

    if ((known !== undefined && known.weight >= weight) || !straddles(geometry, owner, nearest.triangle, sides)) {
      continue;
    }

    blends.set(vertex, {
      isReference: other.surface.isReference,
      normalX: nearest.normalX,
      normalY: nearest.normalY,
      normalZ: nearest.normalZ,
      weight,
    });
  }
}

function seamNormal(normals: Float32Array, offset: number, blend: Blend): Triple | null {
  if (blend.isReference) {
    return [blend.normalX, blend.normalY, blend.normalZ];
  }

  const sumX = normals[offset] + blend.normalX;
  const sumY = normals[offset + 1] + blend.normalY;
  const sumZ = normals[offset + 2] + blend.normalZ;

  const length = Math.hypot(sumX, sumY, sumZ);

  if (length < SHORTEST_SUM) {
    return null;
  }

  return [sumX / length, sumY / length, sumZ / length];
}

function applyBlends(normals: Float32Array, blends: ReadonlyMap<number, Blend>): void {
  for (const [vertex, blend] of blends) {
    const offset = vertex * 3;

    const target = seamNormal(normals, offset, blend);

    if (target === null) {
      continue;
    }

    const blendedX = normals[offset] + (target[0] - normals[offset]) * blend.weight;
    const blendedY = normals[offset + 1] + (target[1] - normals[offset + 1]) * blend.weight;
    const blendedZ = normals[offset + 2] + (target[2] - normals[offset + 2]) * blend.weight;

    const length = Math.hypot(blendedX, blendedY, blendedZ);

    normals[offset] = blendedX / length;
    normals[offset + 1] = blendedY / length;
    normals[offset + 2] = blendedZ / length;
  }
}

export function blendSeamNormals(geometry: SeamGeometry, surfaces: readonly SeamSurface[]): void {
  const prepared = surfaces.map((surface) => {
    return prepareSurface(geometry, surface);
  });
  const blends = new Map<number, Blend>();
  const hidden = new Set<number>();

  for (const [index, owner] of prepared.entries()) {
    if (owner.surface.isReference) {
      continue;
    }

    for (const [otherIndex, other] of prepared.entries()) {
      if (otherIndex === index || !boundsOverlap(owner, other, owner.surface.reach)) {
        continue;
      }

      collectBlends(geometry, owner, other, blends, hidden);
    }
  }

  applyBlends(geometry.normals, blends);
}
