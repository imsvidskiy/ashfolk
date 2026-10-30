import { Matrix3, type Matrix4, Vector3 } from "three";

export interface Shape {
  readonly along: Float32Array;
  readonly around: Float32Array;
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
}

export interface ShapeVertex {
  readonly along: number;
  readonly around: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type Deformation = (vertex: ShapeVertex) => readonly [number, number, number];

type Displacement = (vertex: ShapeVertex) => number;

export function shapeVertexCount(shape: Shape): number {
  return shape.positions.length / 3;
}

export function readShapeVertex(shape: Shape, index: number): ShapeVertex {
  const offset = index * 3;

  return {
    along: shape.along[index],
    around: shape.around[index],
    normalX: shape.normals[offset],
    normalY: shape.normals[offset + 1],
    normalZ: shape.normals[offset + 2],
    x: shape.positions[offset],
    y: shape.positions[offset + 1],
    z: shape.positions[offset + 2],
  };
}

export function computeSmoothNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let corner = 0; corner < indices.length; corner += 3) {
    const first = indices[corner] * 3;
    const second = indices[corner + 1] * 3;
    const third = indices[corner + 2] * 3;

    const edgeAX = positions[second] - positions[first];
    const edgeAY = positions[second + 1] - positions[first + 1];
    const edgeAZ = positions[second + 2] - positions[first + 2];
    const edgeBX = positions[third] - positions[first];
    const edgeBY = positions[third + 1] - positions[first + 1];
    const edgeBZ = positions[third + 2] - positions[first + 2];

    const faceX = edgeAY * edgeBZ - edgeAZ * edgeBY;
    const faceY = edgeAZ * edgeBX - edgeAX * edgeBZ;
    const faceZ = edgeAX * edgeBY - edgeAY * edgeBX;

    addVector(normals, first, faceX, faceY, faceZ);
    addVector(normals, second, faceX, faceY, faceZ);
    addVector(normals, third, faceX, faceY, faceZ);
  }

  normalizeVectors(normals);

  return normals;
}

function addVector(vectors: Float32Array, offset: number, x: number, y: number, z: number): void {
  vectors[offset] += x;
  vectors[offset + 1] += y;
  vectors[offset + 2] += z;
}

function normalizeVectors(vectors: Float32Array): void {
  for (let offset = 0; offset < vectors.length; offset += 3) {
    const length = Math.hypot(vectors[offset], vectors[offset + 1], vectors[offset + 2]);

    if (length === 0) {
      vectors[offset + 1] = 1;

      continue;
    }

    vectors[offset] /= length;
    vectors[offset + 1] /= length;
    vectors[offset + 2] /= length;
  }
}

export function facetShape(shape: Shape): Shape {
  const cornerCount = shape.indices.length;

  const positions = new Float32Array(cornerCount * 3);
  const along = new Float32Array(cornerCount);
  const around = new Float32Array(cornerCount);
  const indices = new Uint32Array(cornerCount);

  for (let corner = 0; corner < cornerCount; corner += 1) {
    const source = shape.indices[corner];

    positions[corner * 3] = shape.positions[source * 3];
    positions[corner * 3 + 1] = shape.positions[source * 3 + 1];
    positions[corner * 3 + 2] = shape.positions[source * 3 + 2];
    along[corner] = shape.along[source];
    around[corner] = shape.around[source];
    indices[corner] = corner;
  }

  return { along, around, indices, normals: computeSmoothNormals(positions, indices), positions };
}

export function deformShape(shape: Shape, deformation: Deformation): Shape {
  const positions = new Float32Array(shape.positions);

  for (let index = 0; index < shapeVertexCount(shape); index += 1) {
    const [offsetX, offsetY, offsetZ] = deformation(readShapeVertex(shape, index));

    positions[index * 3] += offsetX;
    positions[index * 3 + 1] += offsetY;
    positions[index * 3 + 2] += offsetZ;
  }

  return { ...shape, normals: computeSmoothNormals(positions, shape.indices), positions };
}

export function displaceShape(shape: Shape, displacement: Displacement, normalSoftness: number): Shape {
  const positions = new Float32Array(shape.positions);

  for (let index = 0; index < shapeVertexCount(shape); index += 1) {
    const vertex = readShapeVertex(shape, index);
    const offset = displacement(vertex);

    positions[index * 3] += vertex.normalX * offset;
    positions[index * 3 + 1] += vertex.normalY * offset;
    positions[index * 3 + 2] += vertex.normalZ * offset;
  }

  const normals = computeSmoothNormals(positions, shape.indices);

  blendNormals(normals, shape.normals, normalSoftness);

  return { along: shape.along, around: shape.around, indices: shape.indices, normals, positions };
}

function blendNormals(normals: Float32Array, target: Float32Array, amount: number): void {
  for (let offset = 0; offset < normals.length; offset += 1) {
    normals[offset] += (target[offset] - normals[offset]) * amount;
  }

  normalizeVectors(normals);
}

export function transformShape(shape: Shape, matrix: Matrix4): Shape {
  const positions = new Float32Array(shape.positions.length);
  const normals = new Float32Array(shape.normals.length);
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  const point = new Vector3();

  for (let offset = 0; offset < positions.length; offset += 3) {
    point.set(shape.positions[offset], shape.positions[offset + 1], shape.positions[offset + 2]).applyMatrix4(matrix);
    point.toArray(positions, offset);
    point
      .set(shape.normals[offset], shape.normals[offset + 1], shape.normals[offset + 2])
      .applyMatrix3(normalMatrix)
      .normalize();
    point.toArray(normals, offset);
  }

  if (matrix.determinant() >= 0) {
    return { ...shape, normals, positions };
  }

  const indices = new Uint32Array(shape.indices);

  for (let corner = 0; corner < indices.length; corner += 3) {
    indices[corner + 1] = shape.indices[corner + 2];
    indices[corner + 2] = shape.indices[corner + 1];
  }

  return { ...shape, indices, normals, positions };
}
