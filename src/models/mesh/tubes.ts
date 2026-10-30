import { Vector3 } from "three";
import { clamp, FULL_TURN, lerp } from "../../shared/math.ts";
import { computeSmoothNormals, type Shape } from "./shape.ts";
import { capRing, connectRingChain, POLE_RADIUS, type Ring, ShapeWriter, totalLengthOf } from "./shape-writer.ts";

const RIBBON_FOLD = 0.35;

export interface TubePoint {
  readonly radius: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface TubeOptions {
  readonly hasEndCap?: boolean;
  readonly hasStartCap?: boolean;
  readonly radialSegments?: number;
}

interface TubeFrame {
  binormal: Vector3;
  normal: Vector3;
  tangent: Vector3;
}

export function pointAlong(points: readonly TubePoint[], amount: number): TubePoint {
  const scaled = clamp(amount * (points.length - 1), 0, points.length - 1.000_001);
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const from = points[index];
  const to = points[index + 1];

  return {
    radius: lerp(from.radius, to.radius, fraction),
    x: lerp(from.x, to.x, fraction),
    y: lerp(from.y, to.y, fraction),
    z: lerp(from.z, to.z, fraction),
  };
}

function tubeTangents(points: readonly Vector3[]): Vector3[] {
  const tangents: Vector3[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];

    tangents.push(next.clone().sub(previous).normalize());
  }

  return tangents;
}

function referenceAxis(tangent: Vector3): Vector3 {
  if (Math.abs(tangent.y) < 0.9) {
    return new Vector3(0, 1, 0);
  }

  return new Vector3(1, 0, 0);
}

function initialNormal(tangent: Vector3): Vector3 {
  const reference = referenceAxis(tangent);

  return reference
    .clone()
    .sub(tangent.clone().multiplyScalar(reference.dot(tangent)))
    .normalize();
}

function transportedNormal(projected: Vector3, tangent: Vector3): Vector3 {
  if (projected.lengthSq() > 1e-10) {
    return projected.normalize();
  }

  return initialNormal(tangent);
}

function endDirection(frame: TubeFrame, isEnd: boolean): Vector3 {
  if (isEnd) {
    return frame.tangent.clone();
  }

  return frame.tangent.clone().negate();
}

function radialDirection(frame: TubeFrame, angle: number): Vector3 {
  return frame.normal
    .clone()
    .multiplyScalar(Math.cos(angle))
    .add(frame.binormal.clone().multiplyScalar(Math.sin(angle)));
}

function transportFrames(tangents: readonly Vector3[]): TubeFrame[] {
  const frames: TubeFrame[] = [];

  let normal = initialNormal(tangents[0]);

  for (const tangent of tangents) {
    const projected = normal.clone().sub(tangent.clone().multiplyScalar(normal.dot(tangent)));

    normal = transportedNormal(projected, tangent);
    frames.push({ binormal: normal.clone().cross(tangent).normalize(), normal: normal.clone(), tangent });
  }

  return frames;
}

function arcLengths(points: readonly Vector3[]): number[] {
  const lengths = [0];

  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + points[index].distanceTo(points[index - 1]));
  }

  return lengths;
}

export function tube(points: readonly TubePoint[], options: TubeOptions = {}): Shape {
  if (points.length < 2) {
    throw new RangeError("A tube needs at least two points");
  }

  const { hasEndCap = true, hasStartCap = true, radialSegments = 6 } = options;

  const centers = points.map((point) => {
    return new Vector3(point.x, point.y, point.z);
  });
  const writer = new ShapeWriter();
  const rings: Ring[] = [];

  const frames = transportFrames(tubeTangents(centers));
  const lengths = arcLengths(centers);

  const totalLength = totalLengthOf(lengths);

  for (const [index, point] of points.entries()) {
    const radiusSlope = tubeRadiusSlope(points, lengths, index);

    rings.push(
      tubeRing(
        writer,
        centers[index],
        frames[index],
        point.radius,
        radiusSlope,
        lengths[index] / totalLength,
        radialSegments
      )
    );
  }

  connectRingChain(writer, rings);

  const lastIndex = points.length - 1;

  if (hasStartCap && rings[0].length > 1) {
    addTubeCap(writer, centers[0], frames[0], points[0].radius, radialSegments, false);
  }

  if (hasEndCap && rings[lastIndex].length > 1) {
    addTubeCap(writer, centers[lastIndex], frames[lastIndex], points[lastIndex].radius, radialSegments, true);
  }

  return writer.finish();
}

function tubeRadiusSlope(points: readonly TubePoint[], lengths: readonly number[], index: number): number {
  const previous = Math.max(0, index - 1);
  const next = Math.min(points.length - 1, index + 1);

  const span = lengths[next] - lengths[previous];

  if (span <= 0) {
    return 0;
  }

  return (points[next].radius - points[previous].radius) / span;
}

function tubeRing(
  writer: ShapeWriter,
  center: Vector3,
  frame: TubeFrame,
  radius: number,
  radiusSlope: number,
  along: number,
  segments: number
): Ring {
  if (radius <= POLE_RADIUS) {
    return [writer.vertex(center, endDirection(frame, along > 0.5), along, 0)];
  }

  const ring: number[] = [];

  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * FULL_TURN;

    const radial = radialDirection(frame, angle);

    const position = center.clone().add(radial.clone().multiplyScalar(radius));
    const normal = radial.clone().sub(frame.tangent.clone().multiplyScalar(radiusSlope)).normalize();

    ring.push(writer.vertex(position, normal, along, segment / segments));
  }

  return ring;
}

function addTubeCap(
  writer: ShapeWriter,
  center: Vector3,
  frame: TubeFrame,
  radius: number,
  segments: number,
  isEnd: boolean
): void {
  const normal = endDirection(frame, isEnd);
  const along = isEnd ? 1 : 0;
  const ring: number[] = [];

  const centerIndex = writer.vertex(center, normal, along, 0);

  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * FULL_TURN;

    const radial = radialDirection(frame, angle);

    ring.push(writer.vertex(center.clone().add(radial.multiplyScalar(radius)), normal, along, segment / segments));
  }

  capRing(writer, centerIndex, ring, isEnd);
}

function ribbonSide(
  writer: ShapeWriter,
  points: readonly TubePoint[],
  frames: readonly TubeFrame[],
  lengths: readonly number[],
  isBack: boolean
): void {
  const totalLength = totalLengthOf(lengths);
  const rows: [number, number, number][] = [];

  for (const [index, point] of points.entries()) {
    const frame = frames[index];
    const center = new Vector3(point.x, point.y, point.z);
    const along = lengths[index] / totalLength;

    const facing = isBack ? frame.normal.clone().negate() : frame.normal.clone();
    const left = center.clone().addScaledVector(frame.binormal, point.radius);
    const middle = center.clone().addScaledVector(frame.normal, point.radius * RIBBON_FOLD);
    const right = center.clone().addScaledVector(frame.binormal, -point.radius);

    rows.push([
      writer.vertex(left, facing, along, 0),
      writer.vertex(middle, facing, along, 0.5),
      writer.vertex(right, facing, along, 1),
    ]);
  }

  for (let index = 1; index < rows.length; index += 1) {
    const [leftBefore, middleBefore, rightBefore] = rows[index - 1];
    const [left, middle, right] = rows[index];

    if (isBack) {
      writer.triangle(leftBefore, left, middleBefore);
      writer.triangle(middleBefore, left, middle);
      writer.triangle(middleBefore, middle, rightBefore);
      writer.triangle(rightBefore, middle, right);

      continue;
    }

    writer.triangle(leftBefore, middleBefore, left);
    writer.triangle(middleBefore, middle, left);
    writer.triangle(middleBefore, rightBefore, middle);
    writer.triangle(rightBefore, right, middle);
  }
}

export function ribbon(points: readonly TubePoint[]): Shape {
  if (points.length < 2) {
    throw new RangeError("A ribbon needs at least two points");
  }

  const centers = points.map((point) => {
    return new Vector3(point.x, point.y, point.z);
  });
  const writer = new ShapeWriter();

  const frames = transportFrames(tubeTangents(centers));
  const lengths = arcLengths(centers);

  ribbonSide(writer, points, frames, lengths, false);
  ribbonSide(writer, points, frames, lengths, true);

  const shape = writer.finish();

  return { ...shape, normals: computeSmoothNormals(shape.positions, shape.indices) };
}
