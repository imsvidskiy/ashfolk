import {
  type BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  type Material,
  Mesh,
  Sphere,
  Uint32BufferAttribute,
  Vector3,
} from "three/webgpu";
import type { MeshData, VertexChannel } from "../models/mesh/mesh-data.ts";
import { GROWTH_FACTOR } from "../shared/growth.ts";

interface InterleavedField {
  readonly name: string;
  readonly size: number;
}

export function toInstancedGeometry(source: BufferGeometry): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();

  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute);
  }

  geometry.setIndex(source.getIndex());

  return geometry;
}

export function geometryFromMeshData(mesh: MeshData, channels: readonly VertexChannel[]): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(mesh.normals, 3));

  for (const channel of channels) {
    geometry.setAttribute(channel, new Float32BufferAttribute(mesh.channels[channel], 1));
  }

  geometry.setIndex(new Uint32BufferAttribute(mesh.indices, 1));

  const [minimumX, minimumY, minimumZ] = mesh.bounds.minimum;
  const [maximumX, maximumY, maximumZ] = mesh.bounds.maximum;

  const center = new Vector3((minimumX + maximumX) / 2, (minimumY + maximumY) / 2, (minimumZ + maximumZ) / 2);
  const radius = center.distanceTo(new Vector3(maximumX, maximumY, maximumZ));

  geometry.boundingSphere = new Sphere(center, radius);
  geometry.instanceCount = 0;

  return geometry;
}

export function writeVec4(target: Float32Array, offset: number, x: number, y: number, z: number, w: number): void {
  target[offset] = x;
  target[offset + 1] = y;
  target[offset + 2] = z;
  target[offset + 3] = w;
}

export class InterleavedInstances {
  readonly stride: number;
  readonly #fields: readonly InterleavedField[];
  readonly #geometry: InstancedBufferGeometry;
  #array: Float32Array;
  #buffer: InstancedInterleavedBuffer;

  constructor(geometry: InstancedBufferGeometry, fields: readonly InterleavedField[], capacity: number) {
    this.#geometry = geometry;
    this.#fields = fields;
    this.stride = fields.reduce((sum, field) => {
      return sum + field.size;
    }, 0);
    this.#array = new Float32Array(capacity * this.stride);
    this.#buffer = this.#create(this.#array);
  }

  get array(): Float32Array {
    return this.#array;
  }

  get capacity(): number {
    return this.#buffer.count;
  }

  ensureCapacity(count: number): void {
    if (count <= this.capacity) {
      return;
    }

    const next = new Float32Array(Math.ceil(count * GROWTH_FACTOR) * this.stride);

    next.set(this.#array);
    this.#array = next;
    this.#buffer = this.#create(next);
  }

  markUpdated(count: number): void {
    const buffer = this.#buffer;

    buffer.clearUpdateRanges();
    buffer.addUpdateRange(0, count * this.stride);
    buffer.needsUpdate = true;
  }

  #create(array: Float32Array): InstancedInterleavedBuffer {
    const buffer = new InstancedInterleavedBuffer(array, this.stride);

    buffer.setUsage(DynamicDrawUsage);

    let offset = 0;

    for (const field of this.#fields) {
      this.#geometry.setAttribute(field.name, new InterleavedBufferAttribute(buffer, field.size, offset));
      offset += field.size;
    }

    return buffer;
  }
}

export class InstanceBatch {
  readonly mesh: Mesh<InstancedBufferGeometry, Material>;
  readonly #instances: InterleavedInstances;
  #count = 0;

  constructor(
    geometry: InstancedBufferGeometry,
    material: Material,
    fields: readonly InterleavedField[],
    capacity: number
  ) {
    geometry.instanceCount = 0;
    this.#instances = new InterleavedInstances(geometry, fields, capacity);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  get count(): number {
    return this.#count;
  }

  begin(): void {
    this.#count = 0;
  }

  add(...parts: readonly ArrayLike<number>[]): void {
    this.#instances.ensureCapacity(this.#count + 1);

    let offset = this.#count * this.#instances.stride;

    for (const part of parts) {
      this.#instances.array.set(part, offset);
      offset += part.length;
    }

    this.#count += 1;
  }

  fill(sources: readonly ArrayLike<number>[]): void {
    const total = sources.reduce((sum, source) => {
      return sum + source.length;
    }, 0);

    this.#count = total / this.#instances.stride;
    this.#instances.ensureCapacity(this.#count);

    let offset = 0;

    for (const source of sources) {
      this.#instances.array.set(source, offset);
      offset += source.length;
    }

    this.commit();
  }

  commit(): void {
    this.mesh.geometry.instanceCount = this.#count;
    this.mesh.visible = this.#count > 0;

    if (this.#count > 0) {
      this.#instances.markUpdated(this.#count);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
