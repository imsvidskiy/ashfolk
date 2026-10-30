import { Vector3 } from "three";
import { FULL_TURN, lerp, smoothstep } from "../../shared/math.ts";
import { createVolumeNoise, type VolumeNoise } from "../../shared/noise.ts";
import { createRandom, type RandomSource } from "../../shared/random.ts";
import { pointAlong, type TubePoint } from "../mesh/tubes.ts";
import {
  type Branch,
  directionAlong,
  type Foliage,
  growBranch,
  jitter,
  sideDirection,
  type TreeStructure,
  toVector,
} from "./tree-structure.ts";

export const BLOB_TINT = 0.12;

const ROOT_DEPTH = 0.3;
const ROOT_FLARE = 1.35;

export interface Growth {
  readonly branches: Branch[];
  readonly foliage: Foliage[];
  readonly noise: VolumeNoise;
  readonly random: RandomSource;
}

interface TrunkOptions {
  readonly height: number;
  readonly isForked: boolean;
  readonly lean: number;
  readonly radiusBottom: number;
  readonly radiusTop: number;
  readonly segments: number;
  readonly wobble: number;
}

interface LimbOptions {
  readonly bend: number;
  readonly depth: number;
  readonly gravity: number;
  readonly length: number;
  readonly radiusEnd: number;
  readonly segments: number;
  readonly tilt: number;
  readonly wobble: number;
}

export function createGrowth(seed: number): Growth {
  const random = createRandom(seed);

  return { branches: [], foliage: [], noise: createVolumeNoise(random.derive(1)), random };
}

export function finish(growth: Growth, height: number): TreeStructure {
  return { branches: growth.branches, foliage: growth.foliage, height };
}

export function rooted(points: readonly TubePoint[]): TubePoint[] {
  const [base] = points;

  return [{ ...base, y: base.y - ROOT_DEPTH }, ...points];
}

export function addTrunk(growth: Growth, options: TrunkOptions, start = new Vector3()): TubePoint[] {
  const { random } = growth;

  const leanAngle = random.next() * FULL_TURN;
  const direction = new Vector3(Math.cos(leanAngle) * options.lean, 1, Math.sin(leanAngle) * options.lean);

  const points = growBranch({
    bend: 0.004,
    direction,
    gravity: 0,
    length: options.height,
    noise: growth.noise,
    radiusEnd: options.radiusTop,
    radiusStart: options.radiusBottom,
    segments: options.segments,
    start,
    wobble: options.wobble,
  });

  const flared = points.map((point, index) => {
    return index === 0 ? { ...point, radius: point.radius * ROOT_FLARE } : point;
  });

  growth.branches.push({ depth: 0, isForked: options.isForked, points: rooted(flared) });

  return flared;
}

export function addLimb(
  growth: Growth,
  parent: readonly TubePoint[],
  along: number,
  azimuth: number,
  options: LimbOptions
): TubePoint[] {
  const base = pointAlong(parent, along);
  const axis = directionAlong(parent, along);

  const points = growBranch({
    bend: options.bend,
    direction: sideDirection(axis, azimuth, options.tilt),
    gravity: options.gravity,
    length: options.length,
    noise: growth.noise,
    radiusEnd: options.radiusEnd,
    radiusStart: Math.min(base.radius * lerp(0.75, 0.85, smoothstep(0.85, 1, along)), options.radiusEnd * 4 + 0.02),
    segments: options.segments,
    start: toVector(base),
    wobble: options.wobble,
  });

  growth.branches.push({ depth: options.depth, points });

  return points;
}

export function addBlob(growth: Growth, center: Vector3, radius: number, squash: number): void {
  growth.foliage.push({
    center: center.toArray(),
    kind: "blob",
    radius,
    squash,
    tint: jitter(growth.random, BLOB_TINT),
  });
}
