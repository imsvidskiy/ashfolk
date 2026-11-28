import { clamp, lerp } from "../shared/math.ts";
import type { Point } from "../world/crossings.ts";

export class RiverCourse {
  readonly length: number;
  readonly #lengths: readonly number[];
  readonly #points: readonly Point[];

  constructor(points: readonly Point[]) {
    const lengths = [0];
    let length = 0;

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];

      length += Math.hypot(current.x - previous.x, current.z - previous.z);
      lengths.push(length);
    }

    this.#points = points;
    this.#lengths = lengths;
    this.length = length;
  }

  pointAt(along: number): Point {
    const distance = clamp(along, 0, this.length);
    const index = this.#segmentAt(distance);
    const span = this.#lengths[index + 1] - this.#lengths[index];
    const amount = span > 0 ? (distance - this.#lengths[index]) / span : 0;
    const start = this.#points[index];
    const end = this.#points[index + 1];

    return { x: lerp(start.x, end.x, amount), z: lerp(start.z, end.z, amount) };
  }

  nearestTo(point: Point): { along: number; distance: number } {
    let best = { along: 0, distance: Number.POSITIVE_INFINITY };

    for (let index = 1; index < this.#points.length; index += 1) {
      const start = this.#points[index - 1];
      const end = this.#points[index];

      const segmentX = end.x - start.x;
      const segmentZ = end.z - start.z;
      const lengthSquared = Math.max(1e-6, segmentX * segmentX + segmentZ * segmentZ);
      const amount = clamp(((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared, 0, 1);
      const distance = Math.hypot(start.x + segmentX * amount - point.x, start.z + segmentZ * amount - point.z);

      if (distance < best.distance) {
        best = { along: lerp(this.#lengths[index - 1], this.#lengths[index], amount), distance };
      }
    }

    return best;
  }

  #segmentAt(distance: number): number {
    let low = 0;
    let high = this.#lengths.length - 1;

    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);

      if (this.#lengths[middle] <= distance) {
        low = middle;
      } else {
        high = middle;
      }
    }

    return low;
  }
}
