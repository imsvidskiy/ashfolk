import { clamp, hashToUnit, lerp, smoothstep } from "../shared/math.ts";
import type { RiverPoint } from "../world/water.ts";

const MEANDER_PER_WIDTH = 0.6;
const LEAST_MEANDER = 2;
const MOST_MEANDER = 5;
const MEANDER_FADE = 25;
const LONG_MEANDER = 90;
const SHORT_MEANDER = 37;
const SHORT_MEANDER_SHARE = 0.35;
const MEANDER_SALT = 41.7;
const MEANDER_ROOM_SPREAD = 20;
const KERNEL_REACH = 3;

export interface RiverShaping {
  readonly meanderRoom: (point: RiverPoint, acrossX: number, acrossZ: number) => number;
  readonly pathSpread: number;
  readonly seed: number;
  readonly spacing: number;
}

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

export function makeSurfaceDescend(points: RiverPoint[], minimumDrop: number): void {
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const previous = points[pointIndex - 1];
    const current = points[pointIndex];

    current.surface = Math.min(current.surface, previous.surface - minimumDrop);
  }
}

function resampleRiverPath(points: readonly RiverPoint[], spacing: number): RiverPoint[] {
  const first = points.at(0);
  const last = points.at(-1);

  if (first === undefined || last === undefined) {
    return [];
  }

  const resampled: RiverPoint[] = [{ ...first }];

  let carried = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.z - start.z);

    let along = spacing - carried;

    for (; along < length; along += spacing) {
      resampled.push(interpolatePoint(start, end, along / length));
    }

    carried = length - (along - spacing);
  }

  if (carried > spacing * 0.35 || resampled.length === 1) {
    resampled.push({ ...last });
  } else {
    resampled[resampled.length - 1] = { ...last };
  }

  return resampled;
}

function mirroredAt(values: Float64Array, index: number): number {
  const last = values.length - 1;

  if (index < 0) {
    return 2 * values[0] - values[Math.min(-index, last)];
  }

  if (index > last) {
    return 2 * values[last] - values[Math.max(2 * last - index, 0)];
  }

  return values[index];
}

export function smoothPinned(values: Float64Array, spread: number): Float64Array {
  if (spread <= 0 || values.length < 3) {
    return Float64Array.from(values);
  }

  const reach = Math.ceil(spread * KERNEL_REACH);
  const weights = Array.from({ length: reach + 1 }, (_, offset) => {
    return Math.exp(-(offset * offset) / (2 * spread * spread));
  });
  const total = weights.reduce((sum, weight, offset) => {
    return sum + (offset === 0 ? weight : 2 * weight);
  }, 0);

  return values.map((_, index) => {
    let sum = values[index] * weights[0];

    for (let offset = 1; offset <= reach; offset += 1) {
      sum += (mirroredAt(values, index - offset) + mirroredAt(values, index + offset)) * weights[offset];
    }

    return sum / total;
  });
}

function distancesAlong(points: readonly RiverPoint[]): Float64Array {
  const alongs = new Float64Array(points.length);

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];

    alongs[index] = alongs[index - 1] + Math.hypot(point.x - previous.x, point.z - previous.z);
  }

  return alongs;
}

function meanderAt(shaping: RiverShaping, along: number, length: number, width: number): number {
  const { seed } = shaping;

  const amplitude = clamp(MEANDER_PER_WIDTH * width, LEAST_MEANDER, MOST_MEANDER);
  const fade = smoothstep(0, MEANDER_FADE, along) * smoothstep(0, MEANDER_FADE, length - along);
  const longPhase = hashToUnit(seed, 1, MEANDER_SALT) * 2 * Math.PI;
  const shortPhase = hashToUnit(seed, 2, MEANDER_SALT) * 2 * Math.PI;
  const wave =
    (1 - SHORT_MEANDER_SHARE) * Math.sin((2 * Math.PI * along) / LONG_MEANDER + longPhase) +
    SHORT_MEANDER_SHARE * Math.sin((2 * Math.PI * along) / SHORT_MEANDER + shortPhase);

  return amplitude * fade * wave;
}

export function smoothRiverPath(points: readonly RiverPoint[], shaping: RiverShaping): RiverPoint[] {
  const resampled = resampleRiverPath(points, shaping.spacing);

  if (resampled.length < 3) {
    return resampled;
  }

  const spread = shaping.pathSpread / shaping.spacing;
  const xs = smoothPinned(
    Float64Array.from(resampled, (point) => {
      return point.x;
    }),
    spread
  );
  const zs = smoothPinned(
    Float64Array.from(resampled, (point) => {
      return point.z;
    }),
    spread
  );

  const smoothed = resampled.map((point, index) => {
    return { ...point, x: xs[index], z: zs[index] };
  });
  const alongs = distancesAlong(smoothed);
  const length = alongs.at(-1) ?? 0;
  const last = smoothed.length - 1;
  const acrosses = smoothed.map((_, index) => {
    const before = smoothed[Math.max(0, index - 1)];
    const after = smoothed[Math.min(last, index + 1)];
    const tangent = Math.max(1e-6, Math.hypot(after.x - before.x, after.z - before.z));

    return { x: -(after.z - before.z) / tangent, z: (after.x - before.x) / tangent };
  });
  const rooms = smoothPinned(
    Float64Array.from(smoothed, (point, index) => {
      return shaping.meanderRoom(point, acrosses[index].x, acrosses[index].z);
    }),
    MEANDER_ROOM_SPREAD / shaping.spacing
  );

  return smoothed.map((point, index) => {
    const offset = meanderAt(shaping, alongs[index], length, point.width) * rooms[index];

    return { ...point, x: point.x + acrosses[index].x * offset, z: point.z + acrosses[index].z * offset };
  });
}

export function smoothRiverSurfaces(points: RiverPoint[], spread: number, spacing: number): void {
  const surfaces = smoothPinned(
    Float64Array.from(points, (point) => {
      return point.surface;
    }),
    spread / spacing
  );

  for (const [index, point] of points.entries()) {
    point.surface = surfaces[index];
  }
}

export function relaxRiverSurfaces(points: RiverPoint[], passes: number): void {
  for (let pass = 0; pass < passes; pass += 1) {
    for (let index = 1; index < points.length - 1; index += 1) {
      const average = (points[index - 1].surface + points[index + 1].surface) / 2;

      points[index].surface = Math.min(points[index].surface, average);
    }
  }
}
