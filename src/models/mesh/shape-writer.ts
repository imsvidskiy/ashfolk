import type { Vector3 } from "three";
import { GrowableFloatArray, GrowableIndexArray } from "./growable-array.ts";
import type { Shape } from "./shape.ts";

export const POLE_RADIUS = 1e-5;

export type Ring = readonly number[];

export function connectRings(writer: ShapeWriter, lower: Ring, upper: Ring): void {
  const segments = Math.max(lower.length, upper.length);

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;

    if (lower.length === 1) {
      writer.triangle(lower[0], upper[segment], upper[next]);

      continue;
    }

    if (upper.length === 1) {
      writer.triangle(lower[segment], upper[0], lower[next]);

      continue;
    }

    writer.triangle(lower[segment], upper[segment], lower[next]);
    writer.triangle(lower[next], upper[segment], upper[next]);
  }
}

export function connectRingChain(writer: ShapeWriter, rings: readonly Ring[]): void {
  for (let index = 1; index < rings.length; index += 1) {
    connectRings(writer, rings[index - 1], rings[index]);
  }
}

export function capRing(writer: ShapeWriter, center: number, ring: Ring, isFacingForward: boolean): void {
  for (let segment = 0; segment < ring.length; segment += 1) {
    const next = (segment + 1) % ring.length;

    if (isFacingForward) {
      writer.triangle(center, ring[next], ring[segment]);

      continue;
    }

    writer.triangle(center, ring[segment], ring[next]);
  }
}

export function totalLengthOf(lengths: readonly number[]): number {
  const longest = lengths.reduce((maximum, length) => {
    return Math.max(maximum, length);
  }, 0);

  return Math.max(longest, POLE_RADIUS);
}

export class ShapeWriter {
  readonly #along = new GrowableFloatArray();
  readonly #around = new GrowableFloatArray();
  readonly #indices = new GrowableIndexArray();
  readonly #normals = new GrowableFloatArray();
  readonly #positions = new GrowableFloatArray();
  #vertexCount = 0;

  vertex(position: Vector3, normal: Vector3, along: number, around: number): number {
    this.#positions.pushThree(position.x, position.y, position.z);
    this.#normals.pushThree(normal.x, normal.y, normal.z);
    this.#along.push(along);
    this.#around.push(around);
    this.#vertexCount += 1;

    return this.#vertexCount - 1;
  }

  triangle(first: number, second: number, third: number): void {
    this.#indices.pushTriangle(first, second, third);
  }

  finish(): Shape {
    return {
      along: this.#along.toArray(),
      around: this.#around.toArray(),
      indices: this.#indices.toArray(),
      normals: this.#normals.toArray(),
      positions: this.#positions.toArray(),
    };
  }
}
