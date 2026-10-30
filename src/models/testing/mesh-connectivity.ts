import type { MeshData } from "../mesh/mesh-data.ts";
import type { Triple } from "../mesh/transforms.ts";

export const TOUCHING = 0.01;

const POSITION_GRID = 1e4;
const RAY_DIRECTION: Triple = [0.577_31, 0.577_43, 0.577_37];
const RAY_EPSILON = 1e-9;
const GROUND_HEIGHT = 0;

type Corners = readonly [Triple, Triple, Triple];

export interface MeshPiece {
  readonly maximum: Triple;
  readonly minimum: Triple;
  readonly triangles: readonly number[];
  readonly vertices: readonly number[];
}

type PieceAnchor = (piece: MeshPiece) => boolean;

function pointOf(mesh: MeshData, vertex: number): Triple {
  const offset = vertex * 3;

  return [mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]];
}

function subtract(first: Triple, second: Triple): Triple {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function add(first: Triple, second: Triple): Triple {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function scale(point: Triple, factor: number): Triple {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

function dot(first: Triple, second: Triple): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross(first: Triple, second: Triple): Triple {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function distanceSquared(first: Triple, second: Triple): number {
  const difference = subtract(first, second);

  return dot(difference, difference);
}

export function vertexKey(mesh: MeshData, vertex: number): string {
  return pointOf(mesh, vertex)
    .map((value) => {
      return Math.round(value * POSITION_GRID);
    })
    .join(",");
}

export function isTorso(piece: MeshPiece): boolean {
  return piece.vertices.includes(0);
}

function joinSharedPositions(mesh: MeshData, sets: DisjointSets, count: number): void {
  const firstAtPosition = new Map<string, number>();

  for (let vertex = 0; vertex < count; vertex += 1) {
    const key = vertexKey(mesh, vertex);

    const first = firstAtPosition.get(key);

    if (first === undefined) {
      firstAtPosition.set(key, vertex);

      continue;
    }

    sets.join(first, vertex);
  }
}

function joinTriangles(mesh: MeshData, sets: DisjointSets): void {
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    sets.join(mesh.indices[offset], mesh.indices[offset + 1]);
    sets.join(mesh.indices[offset], mesh.indices[offset + 2]);
  }
}

function groupBy(count: number, rootOf: (item: number) => number): Map<number, number[]> {
  const groups = new Map<number, number[]>();

  for (let item = 0; item < count; item += 1) {
    const root = rootOf(item);

    const group = groups.get(root);

    if (group === undefined) {
      groups.set(root, [item]);

      continue;
    }

    group.push(item);
  }

  return groups;
}

function groupAt(groups: ReadonlyMap<number, number[]>, root: number): number[] {
  const group = groups.get(root);

  if (group === undefined) {
    throw new Error(`Nothing was joined under ${root}`);
  }

  return group;
}

function pieceFrom(mesh: MeshData, vertices: readonly number[], triangles: readonly number[]): MeshPiece {
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

  for (const vertex of vertices) {
    const point = pointOf(mesh, vertex);

    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
  }

  return { maximum, minimum, triangles, vertices };
}

export function meshPieces(mesh: MeshData): MeshPiece[] {
  const count = mesh.positions.length / 3;

  const sets = new DisjointSets(count);

  joinTriangles(mesh, sets);
  joinSharedPositions(mesh, sets, count);

  const verticesByRoot = groupBy(count, (vertex) => {
    return sets.find(vertex);
  });
  const trianglesByRoot = groupBy(mesh.indices.length / 3, (triangle) => {
    return sets.find(mesh.indices[triangle * 3]);
  });

  return [...trianglesByRoot.entries()].map(([root, triangles]) => {
    return pieceFrom(mesh, groupAt(verticesByRoot, root), triangles);
  });
}

function triangleCorners(mesh: MeshData, triangle: number): Corners {
  return [
    pointOf(mesh, mesh.indices[triangle * 3]),
    pointOf(mesh, mesh.indices[triangle * 3 + 1]),
    pointOf(mesh, mesh.indices[triangle * 3 + 2]),
  ];
}

function closestPointOnTriangle(point: Triple, corners: Corners): Triple {
  const [first, second, third] = corners;

  const firstEdge = subtract(second, first);
  const secondEdge = subtract(third, first);
  const fromFirst = subtract(point, first);
  const fromSecond = subtract(point, second);
  const fromThird = subtract(point, third);

  const firstDot = dot(firstEdge, fromFirst);
  const secondDot = dot(secondEdge, fromFirst);
  const thirdDot = dot(firstEdge, fromSecond);
  const fourthDot = dot(secondEdge, fromSecond);
  const fifthDot = dot(firstEdge, fromThird);
  const sixthDot = dot(secondEdge, fromThird);

  if (firstDot <= 0 && secondDot <= 0) {
    return first;
  }

  if (fourthDot <= thirdDot && thirdDot >= 0) {
    return second;
  }

  if (fifthDot <= sixthDot && sixthDot >= 0) {
    return third;
  }

  const thirdArea = firstDot * fourthDot - thirdDot * secondDot;
  const secondArea = fifthDot * secondDot - firstDot * sixthDot;
  const firstArea = thirdDot * sixthDot - fifthDot * fourthDot;

  if (thirdArea <= 0 && thirdDot <= 0 && firstDot >= 0) {
    return add(first, scale(firstEdge, firstDot / (firstDot - thirdDot)));
  }

  if (secondArea <= 0 && sixthDot <= 0 && secondDot >= 0) {
    return add(first, scale(secondEdge, secondDot / (secondDot - sixthDot)));
  }

  if (firstArea <= 0 && fourthDot >= thirdDot && fifthDot >= sixthDot) {
    const along = (fourthDot - thirdDot) / (fourthDot - thirdDot + (fifthDot - sixthDot));

    return add(second, scale(subtract(third, second), along));
  }

  const total = 1 / (firstArea + secondArea + thirdArea);

  return add(first, add(scale(firstEdge, secondArea * total), scale(secondEdge, thirdArea * total)));
}

function rayCrossesTriangle(origin: Triple, corners: Corners): boolean {
  const [first, second, third] = corners;

  const firstEdge = subtract(second, first);
  const secondEdge = subtract(third, first);
  const fromFirst = subtract(origin, first);

  const perpendicular = cross(RAY_DIRECTION, secondEdge);
  const across = cross(fromFirst, firstEdge);

  const determinant = dot(firstEdge, perpendicular);

  if (Math.abs(determinant) < RAY_EPSILON) {
    return false;
  }

  const firstWeight = dot(fromFirst, perpendicular) / determinant;
  const secondWeight = dot(RAY_DIRECTION, across) / determinant;

  if (firstWeight < 0 || secondWeight < 0 || firstWeight + secondWeight > 1) {
    return false;
  }

  return dot(secondEdge, across) / determinant > RAY_EPSILON;
}

export function isInsidePiece(mesh: MeshData, piece: MeshPiece, point: Triple): boolean {
  const crossings = piece.triangles.filter((triangle) => {
    return rayCrossesTriangle(point, triangleCorners(mesh, triangle));
  });

  return crossings.length % 2 === 1;
}

function isNearPiece(mesh: MeshData, piece: MeshPiece, point: Triple, tolerance: number): boolean {
  const limit = tolerance * tolerance;

  return piece.triangles.some((triangle) => {
    const closest = closestPointOnTriangle(point, triangleCorners(mesh, triangle));

    return distanceSquared(point, closest) <= limit;
  });
}

function isWithinBounds(piece: MeshPiece, point: Triple, margin: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (point[axis] < piece.minimum[axis] - margin || point[axis] > piece.maximum[axis] + margin) {
      return false;
    }
  }

  return true;
}

function boundsOverlap(first: MeshPiece, second: MeshPiece, margin: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (first.minimum[axis] - margin > second.maximum[axis] || second.minimum[axis] - margin > first.maximum[axis]) {
      return false;
    }
  }

  return true;
}

function samplePoints(mesh: MeshData, piece: MeshPiece): Triple[] {
  const corners = piece.vertices.map((vertex) => {
    return pointOf(mesh, vertex);
  });
  const centers = piece.triangles.map((triangle) => {
    const [first, second, third] = triangleCorners(mesh, triangle);

    return scale(add(first, add(second, third)), 1 / 3);
  });

  return [...corners, ...centers];
}

function reaches(mesh: MeshData, from: MeshPiece, to: MeshPiece, tolerance: number): boolean {
  return samplePoints(mesh, from).some((point) => {
    if (!isWithinBounds(to, point, tolerance)) {
      return false;
    }

    if (isNearPiece(mesh, to, point, tolerance)) {
      return true;
    }

    return isInsidePiece(mesh, to, point);
  });
}

export function piecesTouch(mesh: MeshData, first: MeshPiece, second: MeshPiece, tolerance: number): boolean {
  if (!boundsOverlap(first, second, tolerance)) {
    return false;
  }

  if (reaches(mesh, first, second, tolerance)) {
    return true;
  }

  return reaches(mesh, second, first, tolerance);
}

function restsOnGround(tolerance: number): PieceAnchor {
  return (piece) => {
    return piece.minimum[1] <= GROUND_HEIGHT + tolerance;
  };
}

export function detachedPieces(
  mesh: MeshData,
  tolerance: number,
  isAnchor: PieceAnchor = restsOnGround(tolerance)
): MeshPiece[] {
  const pieces = meshPieces(mesh);

  const attached = new Set(
    pieces.flatMap((piece, index) => {
      return isAnchor(piece) ? [index] : [];
    })
  );

  const waiting = [...attached];

  for (let current = waiting.pop(); current !== undefined; current = waiting.pop()) {
    const from = pieces[current];

    for (const [index, piece] of pieces.entries()) {
      if (attached.has(index) || !piecesTouch(mesh, from, piece, tolerance)) {
        continue;
      }

      attached.add(index);
      waiting.push(index);
    }
  }

  return pieces.filter((_, index) => {
    return !attached.has(index);
  });
}

function describePiece(mesh: MeshData, piece: MeshPiece): string {
  const parts = new Set(
    piece.vertices.map((vertex) => {
      return mesh.channels.part[vertex];
    })
  );
  const slots = new Set(
    piece.vertices.map((vertex) => {
      return mesh.channels.slot[vertex];
    })
  );

  function range(axis: number): string {
    return `${piece.minimum[axis].toFixed(2)}..${piece.maximum[axis].toFixed(2)}`;
  }

  return `${piece.triangles.length} triangles of part ${[...parts].join("/")} slot ${[...slots].join("/")} at x ${range(0)} y ${range(1)} z ${range(2)}`;
}

export function loosePieces(
  mesh: MeshData,
  tolerance = TOUCHING,
  isAnchor: PieceAnchor = restsOnGround(tolerance)
): string[] {
  return detachedPieces(mesh, tolerance, isAnchor).map((piece) => {
    return describePiece(mesh, piece);
  });
}

class DisjointSets {
  readonly #parents: Int32Array;

  constructor(size: number) {
    this.#parents = Int32Array.from({ length: size }, (_, index) => {
      return index;
    });
  }

  find(element: number): number {
    let root = element;

    while (this.#parents[root] !== root) {
      root = this.#parents[root];
    }

    let current = element;

    while (this.#parents[current] !== root) {
      const next = this.#parents[current];

      this.#parents[current] = root;
      current = next;
    }

    return root;
  }

  join(first: number, second: number): void {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);

    if (firstRoot !== secondRoot) {
      this.#parents[secondRoot] = firstRoot;
    }
  }
}
