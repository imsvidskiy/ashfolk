import { Vector3 } from "three";
import { type MeshData, VERTEX_CHANNELS, vertexCount } from "../mesh/mesh-data.ts";
import { type Shape, shapeVertexCount } from "../mesh/shape.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { type MeshPiece, vertexKey } from "./mesh-connectivity.ts";

const NORMAL_TOLERANCE = 1e-3;
const SELF_HIT = 1e-3;

const ENCLOSING_DIRECTIONS: readonly Vector3[] = [
  [1, 0.03, 0.02],
  [-1, 0.02, -0.03],
  [0.02, 1, 0.03],
  [-0.03, -1, 0.02],
  [0.03, 0.02, 1],
  [-0.02, 0.03, -1],
  [1, 1, 1],
  [-1, 1, 1],
  [1, -1, 1],
  [1, 1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [1, -1, -1],
  [-1, -1, -1],
].map((direction) => {
  return new Vector3(...direction).normalize();
});

interface IndexedGeometry {
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
}

interface EdgeUse {
  count: number;
  height: number;
  middle: Vector3;
}

function geometryProblems(geometry: IndexedGeometry, count: number): string[] {
  const problems: string[] = [];

  if (geometry.indices.length % 3 !== 0) {
    problems.push("index count is not a multiple of three");
  }

  if (
    geometry.indices.some((index) => {
      return index >= count;
    })
  ) {
    problems.push("an index points past the last vertex");
  }

  if (
    geometry.positions.some((value) => {
      return !Number.isFinite(value);
    })
  ) {
    problems.push("a position is not finite");
  }

  for (let offset = 0; offset < geometry.normals.length; offset += 3) {
    const length = Math.hypot(geometry.normals[offset], geometry.normals[offset + 1], geometry.normals[offset + 2]);

    if (Math.abs(length - 1) > NORMAL_TOLERANCE) {
      problems.push(`normal ${offset / 3} has length ${length}`);

      break;
    }
  }

  return problems;
}

export function shapeProblems(shape: Shape): string[] {
  const count = shapeVertexCount(shape);

  const problems = geometryProblems(shape, count);

  if (shape.along.length !== count || shape.around.length !== count) {
    problems.push("surface parameters do not match the vertex count");
  }

  if (
    [...shape.along, ...shape.around].some((value) => {
      return value < 0 || value > 1;
    })
  ) {
    problems.push("a surface parameter is outside 0..1");
  }

  return problems;
}

export function meshProblems(mesh: MeshData): string[] {
  const count = vertexCount(mesh);

  const problems = geometryProblems(mesh, count);

  for (const channel of VERTEX_CHANNELS) {
    if (mesh.channels[channel].length !== count) {
      problems.push(`channel ${channel} does not match the vertex count`);
    }

    if (
      mesh.channels[channel].some((value) => {
        return !Number.isFinite(value);
      })
    ) {
      problems.push(`channel ${channel} has a value that is not finite`);
    }
  }

  return problems;
}

function edgeUses(mesh: MeshData): Map<string, EdgeUse> {
  const uses = new Map<string, EdgeUse>();

  for (let corner = 0; corner < mesh.indices.length; corner += 3) {
    for (let side = 0; side < 3; side += 1) {
      const first = mesh.indices[corner + side];
      const second = mesh.indices[corner + ((side + 1) % 3)];

      const from = vertexKey(mesh, first);
      const to = vertexKey(mesh, second);

      if (from === to) {
        continue;
      }

      const edge = from < to ? `${from}|${to}` : `${to}|${from}`;
      const height = Math.max(mesh.positions[first * 3 + 1], mesh.positions[second * 3 + 1]);

      const use = uses.get(edge);
      const middle = new Vector3()
        .fromArray(mesh.positions, first * 3)
        .add(new Vector3().fromArray(mesh.positions, second * 3))
        .multiplyScalar(0.5);

      uses.set(edge, { count: use === undefined ? 1 : use.count + 1, height, middle });
    }
  }

  return uses;
}

function openEdges(mesh: MeshData): EdgeUse[] {
  return [...edgeUses(mesh).values()].filter((use) => {
    return use.count % 2 === 1;
  });
}

export function openEdgeCount(mesh: MeshData): number {
  return openEdges(mesh).length;
}

export function highestOpenEdge(mesh: MeshData): number {
  return openEdges(mesh).reduce((highest, edge) => {
    return Math.max(highest, edge.height);
  }, Number.NEGATIVE_INFINITY);
}

function isEnclosed(mesh: MeshData, point: Vector3): boolean {
  return ENCLOSING_DIRECTIONS.every((direction) => {
    const hit = outermostHit(mesh, point, direction);

    return hit !== null && hit.distance > SELF_HIT;
  });
}

export function highestExposedOpenEdge(mesh: MeshData): number {
  return openEdges(mesh)
    .filter((edge) => {
      return !isEnclosed(mesh, edge.middle);
    })
    .reduce((highest, edge) => {
      return Math.max(highest, edge.height);
    }, Number.NEGATIVE_INFINITY);
}

export function thinnestPiece(mesh: MeshData, pieces: readonly MeshPiece[]): number {
  return pieces.reduce((thinnest, piece) => {
    return Math.min(thinnest, pieceThickness(mesh, piece));
  }, Number.POSITIVE_INFINITY);
}

function pieceThickness(mesh: MeshData, piece: MeshPiece): number {
  let volume = 0;
  let area = 0;

  for (const triangle of piece.triangles) {
    const [first, second, third] = [0, 1, 2].map((corner) => {
      return mesh.indices[triangle * 3 + corner] * 3;
    });

    const firstPoint = new Vector3().fromArray(mesh.positions, first);
    const secondPoint = new Vector3().fromArray(mesh.positions, second);
    const thirdPoint = new Vector3().fromArray(mesh.positions, third);

    volume += firstPoint.dot(secondPoint.clone().cross(thirdPoint)) / 6;
    area += secondPoint.clone().sub(firstPoint).cross(thirdPoint.clone().sub(firstPoint)).length() / 2;
  }

  return area === 0 ? 0 : (2 * Math.abs(volume)) / area;
}

export function verticesWhere(mesh: MeshData, accepts: (vertex: number) => boolean): number[] {
  return Array.from({ length: vertexCount(mesh) }, (_, vertex) => {
    return vertex;
  }).filter(accepts);
}

export function signedVolume(shape: Pick<Shape, "indices" | "positions">): number {
  const { indices, positions } = shape;

  let volume = 0;

  for (let corner = 0; corner < indices.length; corner += 3) {
    const first = indices[corner] * 3;
    const second = indices[corner + 1] * 3;
    const third = indices[corner + 2] * 3;

    const crossX = positions[second + 1] * positions[third + 2] - positions[second + 2] * positions[third + 1];
    const crossY = positions[second + 2] * positions[third] - positions[second] * positions[third + 2];
    const crossZ = positions[second] * positions[third + 1] - positions[second + 1] * positions[third];

    volume += positions[first] * crossX + positions[first + 1] * crossY + positions[first + 2] * crossZ;
  }

  return volume / 6;
}
