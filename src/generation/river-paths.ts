import { lerp } from "../shared/math.ts";
import type { RiverPoint } from "../world/water.ts";

const SMOOTHING_PASSES = 2;

export function interpolatePoint(start: RiverPoint, end: RiverPoint, amount: number): RiverPoint {
  return {
    depth: lerp(start.depth, end.depth, amount),
    flow: lerp(start.flow, end.flow, amount),
    surface: lerp(start.surface, end.surface, amount),
    width: lerp(start.width, end.width, amount),
    x: lerp(start.x, end.x, amount),
    z: lerp(start.z, end.z, amount),
  };
}

function chaikinPass(points: readonly RiverPoint[]): RiverPoint[] {
  const first = points.at(0);
  const last = points.at(-1);

  if (points.length < 3 || first === undefined || last === undefined) {
    return [...points];
  }

  const smoothed: RiverPoint[] = [first];

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];

    smoothed.push(interpolatePoint(start, end, 0.25), interpolatePoint(start, end, 0.75));
  }

  smoothed.push(last);

  return smoothed;
}

export function smoothRiverPath(points: readonly RiverPoint[]): RiverPoint[] {
  let current = [...points];

  for (let iteration = 0; iteration < SMOOTHING_PASSES; iteration += 1) {
    current = chaikinPass(current);
  }

  return current;
}

export function makeSurfaceDescend(points: RiverPoint[], minimumDrop: number): void {
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const previous = points[pointIndex - 1];
    const current = points[pointIndex];

    current.surface = Math.min(current.surface, previous.surface - minimumDrop);
  }
}
