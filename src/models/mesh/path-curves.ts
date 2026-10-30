import type { BodySection, LoftSection } from "./shapes.ts";
import type { TubePoint } from "./tubes.ts";

const CENTRIPETAL = 0.5;
const SHORTEST_KNOT = 1e-6;

type Vector = readonly number[];

function knotStep(from: Vector, to: Vector): number {
  const distance = Math.hypot(
    ...from.map((value, index) => {
      return to[index] - value;
    })
  );

  return Math.max(distance ** CENTRIPETAL, SHORTEST_KNOT);
}

function blend(from: Vector, to: Vector, start: number, end: number, time: number): number[] {
  const share = (time - start) / (end - start);

  return from.map((value, index) => {
    return value + (to[index] - value) * share;
  });
}

function extended(vectors: readonly Vector[], index: number): Vector {
  if (index < 0) {
    return blend(vectors[1], vectors[0], 0, 1, 2);
  }

  if (index >= vectors.length) {
    const [beforeLast, last] = vectors.slice(-2);

    return blend(beforeLast, last, 0, 1, 2);
  }

  return vectors[index];
}

function curvePoint(vectors: readonly Vector[], index: number, share: number): number[] {
  const previous = extended(vectors, index - 1);
  const from = vectors[index];
  const to = vectors[index + 1];
  const next = extended(vectors, index + 2);

  const firstKnot = knotStep(previous, from);
  const secondKnot = firstKnot + knotStep(from, to);
  const thirdKnot = secondKnot + knotStep(to, next);
  const time = firstKnot + (secondKnot - firstKnot) * share;

  const first = blend(previous, from, 0, firstKnot, time);
  const second = blend(from, to, firstKnot, secondKnot, time);
  const third = blend(to, next, secondKnot, thirdKnot, time);
  const lower = blend(first, second, 0, secondKnot, time);
  const upper = blend(second, third, firstKnot, thirdKnot, time);

  return blend(lower, upper, firstKnot, secondKnot, time);
}

function keepRadiiOpen(point: number[], from: Vector, to: Vector, share: number, radii: readonly number[]): number[] {
  for (const component of radii) {
    if (point[component] < Math.min(from[component], to[component])) {
      point[component] = from[component] + (to[component] - from[component]) * share;
    }
  }

  return point;
}

function curveVectors(vectors: readonly Vector[], steps: number, radii: readonly number[]): Vector[] {
  const curved: Vector[] = [];

  for (const [index, vector] of vectors.entries()) {
    curved.push(vector);

    for (let step = 1; step < steps && index < vectors.length - 1; step += 1) {
      const share = step / steps;

      curved.push(keepRadiiOpen(curvePoint(vectors, index, share), vectors[index], vectors[index + 1], share, radii));
    }
  }

  return curved;
}

function isCurved(count: number, steps: number): boolean {
  return steps > 1 && count > 2;
}

export function curveTube(points: readonly TubePoint[], steps: number): TubePoint[] {
  if (!isCurved(points.length, steps)) {
    return [...points];
  }

  const vectors = points.map(({ radius, x, y, z }) => {
    return [x, y, z, radius];
  });

  return curveVectors(vectors, steps, [3]).map(([x, y, z, radius]) => {
    return { radius, x, y, z };
  });
}

export function curveSections(sections: readonly LoftSection[], steps: number): LoftSection[] {
  if (!isCurved(sections.length, steps)) {
    return [...sections];
  }

  const vectors = sections.map(({ centerX = 0, centerZ = 0, radiusX, radiusZ, y }) => {
    return [centerX, y, centerZ, radiusX, radiusZ];
  });

  return curveVectors(vectors, steps, [3, 4]).map(([centerX, y, centerZ, radiusX, radiusZ]) => {
    return {
      centerX,
      centerZ,
      radiusX,
      radiusZ,
      y,
    };
  });
}

export function curveBodySections(sections: readonly BodySection[], steps: number): BodySection[] {
  if (!isCurved(sections.length, steps)) {
    return [...sections];
  }

  const vectors = sections.map(({ centerX = 0, centerY, halfHeight, halfWidth, z }) => {
    return [centerX, centerY, z, halfHeight, halfWidth];
  });

  return curveVectors(vectors, steps, [3, 4]).map(([centerX, centerY, z, halfHeight, halfWidth]) => {
    return {
      centerX,
      centerY,
      halfHeight,
      halfWidth,
      z,
    };
  });
}
