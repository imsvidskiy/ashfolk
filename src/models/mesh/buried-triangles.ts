import { boundsOf, channelRecord, type MeshData, type VertexChannel, vertexCount } from "./mesh-data.ts";
import type { Triple } from "./transforms.ts";

const RAY_DIRECTIONS: readonly Triple[] = [
  [0.5773, 0.6123, 0.5401],
  [-0.4364, 0.8018, -0.4082],
];

const PARALLEL_LIMIT = 1e-14;
const BURIED_MARGIN = 0.01;
const CORNERS = 3;
const TRIANGLE_STRIDE = 12;
const CLOSED_SOLIDS = new WeakMap<MeshData, boolean>();
const PACKED_SOLIDS = new WeakMap<MeshData, readonly Float64Array[]>();

interface BuriedTest {
  readonly buried: readonly Uint8Array[];
  readonly mesh: MeshData;
  readonly solids: readonly MeshData[];
}

function packedCrossing(positions: Float32Array, corners: readonly number[], direction: Triple): number[] {
  const [first, second, third] = corners;
  const [directionX, directionY, directionZ] = direction;

  const firstEdgeX = positions[second] - positions[first];
  const firstEdgeY = positions[second + 1] - positions[first + 1];
  const firstEdgeZ = positions[second + 2] - positions[first + 2];
  const secondEdgeX = positions[third] - positions[first];
  const secondEdgeY = positions[third + 1] - positions[first + 1];
  const secondEdgeZ = positions[third + 2] - positions[first + 2];

  const perpendicularX = directionY * secondEdgeZ - directionZ * secondEdgeY;
  const perpendicularY = directionZ * secondEdgeX - directionX * secondEdgeZ;
  const perpendicularZ = directionX * secondEdgeY - directionY * secondEdgeX;

  const determinant = firstEdgeX * perpendicularX + firstEdgeY * perpendicularY + firstEdgeZ * perpendicularZ;

  if (Math.abs(determinant) < PARALLEL_LIMIT) {
    return [];
  }

  return [
    positions[first],
    positions[first + 1],
    positions[first + 2],
    perpendicularX / determinant,
    perpendicularY / determinant,
    perpendicularZ / determinant,
    (firstEdgeY * directionZ - firstEdgeZ * directionY) / determinant,
    (firstEdgeZ * directionX - firstEdgeX * directionZ) / determinant,
    (firstEdgeX * directionY - firstEdgeY * directionX) / determinant,
    (firstEdgeY * secondEdgeZ - firstEdgeZ * secondEdgeY) / determinant,
    (firstEdgeZ * secondEdgeX - firstEdgeX * secondEdgeZ) / determinant,
    (firstEdgeX * secondEdgeY - firstEdgeY * secondEdgeX) / determinant,
  ];
}

function packedTriangles(solid: MeshData): readonly Float64Array[] {
  const known = PACKED_SOLIDS.get(solid);

  if (known !== undefined) {
    return known;
  }

  const { indices, positions } = solid;

  const packed = RAY_DIRECTIONS.map((direction) => {
    const values: number[] = [];

    for (let offset = 0; offset < indices.length; offset += CORNERS) {
      const corners = [indices[offset] * 3, indices[offset + 1] * 3, indices[offset + 2] * 3];

      values.push(...packedCrossing(positions, corners, direction));
    }

    return Float64Array.from(values);
  });

  PACKED_SOLIDS.set(solid, packed);

  return packed;
}

function crossings(packed: Float64Array, point: Triple): number {
  const [pointX, pointY, pointZ] = point;

  let count = 0;

  for (let offset = 0; offset < packed.length; offset += TRIANGLE_STRIDE) {
    const fromFirstX = pointX - packed[offset];
    const fromFirstY = pointY - packed[offset + 1];
    const fromFirstZ = pointZ - packed[offset + 2];

    const firstWeight =
      fromFirstX * packed[offset + 3] + fromFirstY * packed[offset + 4] + fromFirstZ * packed[offset + 5];

    if (firstWeight < 0 || firstWeight > 1) {
      continue;
    }

    const secondWeight =
      fromFirstX * packed[offset + 6] + fromFirstY * packed[offset + 7] + fromFirstZ * packed[offset + 8];

    if (secondWeight < 0 || firstWeight + secondWeight > 1) {
      continue;
    }

    const distance =
      fromFirstX * packed[offset + 9] + fromFirstY * packed[offset + 10] + fromFirstZ * packed[offset + 11];

    if (distance > 0) {
      count += 1;
    }
  }

  return count;
}

function isWithinBounds(solid: MeshData, point: Triple): boolean {
  const { maximum, minimum } = solid.bounds;

  return point.every((value, axis) => {
    return value > minimum[axis] && value < maximum[axis];
  });
}

export function isInsideSolid(solid: MeshData, point: Triple): boolean {
  if (!isWithinBounds(solid, point)) {
    return false;
  }

  return packedTriangles(solid).every((packed) => {
    return crossings(packed, point) % 2 === 1;
  });
}

function liftedVertex(mesh: MeshData, vertex: number, margin: number): Triple {
  const offset = vertex * 3;

  return [
    mesh.positions[offset] + mesh.normals[offset] * margin,
    mesh.positions[offset + 1] + mesh.normals[offset + 1] * margin,
    mesh.positions[offset + 2] + mesh.normals[offset + 2] * margin,
  ];
}

function middleOf(corners: readonly Triple[]): Triple {
  const [first, second, third] = corners;

  return [
    (first[0] + second[0] + third[0]) / CORNERS,
    (first[1] + second[1] + third[1]) / CORNERS,
    (first[2] + second[2] + third[2]) / CORNERS,
  ];
}

function isDeepInside(solid: MeshData, points: readonly Triple[]): boolean {
  return points.every((point) => {
    return isInsideSolid(solid, point);
  });
}

function buriedVertices(mesh: MeshData, solid: MeshData): Uint8Array {
  return Uint8Array.from({ length: vertexCount(mesh) }, (_, vertex) => {
    return isDeepInside(solid, [liftedVertex(mesh, vertex, 0), liftedVertex(mesh, vertex, BURIED_MARGIN)]) ? 1 : 0;
  });
}

function isBuried(test: BuriedTest, triangle: number): boolean {
  const { buried, mesh, solids } = test;

  const vertices = [0, 1, 2].map((corner) => {
    return mesh.indices[triangle * CORNERS + corner];
  });

  return solids.some((solid, index) => {
    if (
      !vertices.every((vertex) => {
        return buried[index][vertex] === 1;
      })
    ) {
      return false;
    }

    return isDeepInside(solid, [
      middleOf(
        vertices.map((vertex) => {
          return liftedVertex(mesh, vertex, 0);
        })
      ),
      middleOf(
        vertices.map((vertex) => {
          return liftedVertex(mesh, vertex, BURIED_MARGIN);
        })
      ),
    ]);
  });
}

function pickedChannel(mesh: MeshData, channel: VertexChannel, order: readonly number[]): Float32Array {
  return Float32Array.from(order, (vertex) => {
    return mesh.channels[channel][vertex];
  });
}

function keptTriangles(mesh: MeshData, keeps: (triangle: number) => boolean): MeshData {
  const remap = new Int32Array(vertexCount(mesh)).fill(-1);
  const indices: number[] = [];
  const order: number[] = [];

  for (let triangle = 0; triangle < mesh.indices.length / CORNERS; triangle += 1) {
    if (!keeps(triangle)) {
      continue;
    }

    for (let corner = 0; corner < CORNERS; corner += 1) {
      const vertex = mesh.indices[triangle * CORNERS + corner];

      if (remap[vertex] === -1) {
        remap[vertex] = order.length;
        order.push(vertex);
      }

      indices.push(remap[vertex]);
    }
  }

  const positions = new Float32Array(order.length * 3);
  const normals = new Float32Array(order.length * 3);

  for (const [index, vertex] of order.entries()) {
    positions.set(mesh.positions.subarray(vertex * 3, vertex * 3 + 3), index * 3);
    normals.set(mesh.normals.subarray(vertex * 3, vertex * 3 + 3), index * 3);
  }

  return {
    bounds: boundsOf(positions),
    channels: channelRecord((channel) => {
      return pickedChannel(mesh, channel, order);
    }),
    indices: Uint32Array.from(indices),
    normals,
    positions,
  };
}

export function isClosed(mesh: MeshData): boolean {
  const { indices } = mesh;

  const count = vertexCount(mesh);
  const edges = new Set<number>();

  for (let offset = 0; offset < indices.length; offset += CORNERS) {
    for (let corner = 0; corner < CORNERS; corner += 1) {
      edges.add(indices[offset + corner] * count + indices[offset + ((corner + 1) % CORNERS)]);
    }
  }

  for (const edge of edges) {
    const from = Math.floor(edge / count);
    const to = edge % count;

    if (!edges.has(to * count + from)) {
      return false;
    }
  }

  return indices.length > 0;
}

function rootOf(parents: Int32Array, vertex: number): number {
  let root = vertex;

  while (parents[root] !== root) {
    parents[root] = parents[parents[root]];
    root = parents[root];
  }

  return root;
}

export function shellsOf(mesh: MeshData): MeshData[] {
  const { indices } = mesh;

  const parents = Int32Array.from({ length: vertexCount(mesh) }, (_, vertex) => {
    return vertex;
  });
  const shells = new Map<number, Set<number>>();

  for (let offset = 0; offset < indices.length; offset += CORNERS) {
    const root = rootOf(parents, indices[offset]);

    parents[rootOf(parents, indices[offset + 1])] = root;
    parents[rootOf(parents, indices[offset + 2])] = root;
  }

  for (let triangle = 0; triangle < indices.length / CORNERS; triangle += 1) {
    const root = rootOf(parents, indices[triangle * CORNERS]);
    const shell = shells.get(root);

    if (shell === undefined) {
      shells.set(root, new Set([triangle]));

      continue;
    }

    shell.add(triangle);
  }

  return [...shells.values()].map((triangles) => {
    return keptTriangles(mesh, (triangle) => {
      return triangles.has(triangle);
    });
  });
}

function overlaps(mesh: MeshData, solid: MeshData): boolean {
  const { maximum, minimum } = mesh.bounds;

  return [0, 1, 2].every((axis) => {
    return maximum[axis] > solid.bounds.minimum[axis] && minimum[axis] < solid.bounds.maximum[axis];
  });
}

function isClosedSolid(solid: MeshData): boolean {
  const known = CLOSED_SOLIDS.get(solid);

  if (known !== undefined) {
    return known;
  }

  const isSolid = isClosed(solid);

  CLOSED_SOLIDS.set(solid, isSolid);

  return isSolid;
}

export function withoutBuriedTriangles(mesh: MeshData, solids: readonly MeshData[]): MeshData {
  const nearSolids = solids.filter((solid) => {
    return overlaps(mesh, solid) && isClosedSolid(solid);
  });

  if (nearSolids.length === 0) {
    return mesh;
  }

  const test: BuriedTest = {
    buried: nearSolids.map((solid) => {
      return buriedVertices(mesh, solid);
    }),
    mesh,
    solids: nearSolids,
  };

  return keptTriangles(mesh, (triangle) => {
    return !isBuried(test, triangle);
  });
}

export function withoutBuriedOverlaps(shells: readonly MeshData[]): MeshData[] {
  return shells.map((shell, index) => {
    return withoutBuriedTriangles(
      shell,
      shells.filter((_other, otherIndex) => {
        return otherIndex !== index;
      })
    );
  });
}
