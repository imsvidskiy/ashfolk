import { Vector3 } from "three";
import { clamp, FULL_TURN, lerp } from "../../shared/math.ts";
import type { VolumeNoise } from "../../shared/noise.ts";
import { GrowableFloatArray, GrowableIndexArray } from "./growable-array.ts";
import { computeSmoothNormals, displaceShape, type Shape, transformShape } from "./shape.ts";
import { type Triple, transformOf } from "./transforms.ts";

const POLE_RADIUS = 1e-5;
const RIBBON_FOLD = 0.35;
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const LENGTHWISE = transformOf({ rotation: [Math.PI / 2, 0, 0] });

const BOX_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const ICOSAHEDRON_VERTICES: readonly (readonly [number, number, number])[] = [
  [-1, GOLDEN_RATIO, 0],
  [1, GOLDEN_RATIO, 0],
  [-1, -GOLDEN_RATIO, 0],
  [1, -GOLDEN_RATIO, 0],
  [0, -1, GOLDEN_RATIO],
  [0, 1, GOLDEN_RATIO],
  [0, -1, -GOLDEN_RATIO],
  [0, 1, -GOLDEN_RATIO],
  [GOLDEN_RATIO, 0, -1],
  [GOLDEN_RATIO, 0, 1],
  [-GOLDEN_RATIO, 0, -1],
  [-GOLDEN_RATIO, 0, 1],
];

const ICOSAHEDRON_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

interface BoxFace {
  normal: Vector3;
  tangentU: Vector3;
  tangentV: Vector3;
}

const BOX_FACES: readonly BoxFace[] = [
  { normal: new Vector3(1, 0, 0), tangentU: new Vector3(0, 1, 0), tangentV: new Vector3(0, 0, 1) },
  { normal: new Vector3(-1, 0, 0), tangentU: new Vector3(0, 0, 1), tangentV: new Vector3(0, 1, 0) },
  { normal: new Vector3(0, 1, 0), tangentU: new Vector3(0, 0, 1), tangentV: new Vector3(1, 0, 0) },
  { normal: new Vector3(0, -1, 0), tangentU: new Vector3(1, 0, 0), tangentV: new Vector3(0, 0, 1) },
  { normal: new Vector3(0, 0, 1), tangentU: new Vector3(1, 0, 0), tangentV: new Vector3(0, 1, 0) },
  { normal: new Vector3(0, 0, -1), tangentU: new Vector3(0, 1, 0), tangentV: new Vector3(1, 0, 0) },
];

type Ring = readonly number[];

interface ProfilePoint {
  readonly radius: number;
  readonly y: number;
}

interface ProfileNormal {
  radial: number;
  vertical: number;
}

export interface LoftSection {
  readonly centerX?: number;
  readonly centerZ?: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly ripple?: (around: number) => number;
  readonly y: number;
}

interface PanelOptions {
  readonly angularSegments: number;
  readonly endAngle: number;
  readonly sections: readonly LoftSection[];
  readonly startAngle: number;
  readonly thickness: number;
}

interface CylinderOptions {
  readonly height: number;
  readonly radialSegments?: number;
  readonly radiusBottom: number;
  readonly radiusTop: number;
}

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

interface BlobOptions {
  readonly detail?: number;
  readonly frequency?: number;
  readonly noise: VolumeNoise;
  readonly offset?: Triple;
  readonly radius: number;
  readonly roughness?: number;
}

export interface BodySection {
  readonly centerX?: number;
  readonly centerY: number;
  readonly halfHeight: number;
  readonly halfWidth: number;
  readonly z: number;
}

function connectRings(writer: ShapeWriter, lower: Ring, upper: Ring): void {
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

function connectRingChain(writer: ShapeWriter, rings: readonly Ring[]): void {
  for (let index = 1; index < rings.length; index += 1) {
    connectRings(writer, rings[index - 1], rings[index]);
  }
}

function capRing(writer: ShapeWriter, center: number, ring: Ring, isFacingForward: boolean): void {
  for (let segment = 0; segment < ring.length; segment += 1) {
    const next = (segment + 1) % ring.length;

    if (isFacingForward) {
      writer.triangle(center, ring[next], ring[segment]);

      continue;
    }

    writer.triangle(center, ring[segment], ring[next]);
  }
}

function profileNormal(profile: readonly ProfilePoint[], index: number): ProfileNormal {
  const previous = profile[Math.max(0, index - 1)];
  const next = profile[Math.min(profile.length - 1, index + 1)];

  const tangentRadial = next.radius - previous.radius;
  const tangentVertical = next.y - previous.y;

  const length = Math.hypot(tangentRadial, tangentVertical);

  if (length === 0) {
    return { radial: 1, vertical: 0 };
  }

  return { radial: tangentVertical / length, vertical: -tangentRadial / length };
}

function totalLengthOf(lengths: readonly number[]): number {
  const longest = lengths.reduce((maximum, length) => {
    return Math.max(maximum, length);
  }, 0);

  return Math.max(longest, POLE_RADIUS);
}

function profileLengths(profile: readonly ProfilePoint[]): number[] {
  const lengths = [0];

  for (let index = 1; index < profile.length; index += 1) {
    const step = Math.hypot(profile[index].radius - profile[index - 1].radius, profile[index].y - profile[index - 1].y);

    lengths.push(lengths[index - 1] + step);
  }

  return lengths;
}

export function lathe(profile: readonly ProfilePoint[], segments: number): Shape {
  if (profile.length < 2) {
    throw new RangeError("A lathe profile needs at least two points");
  }

  const writer = new ShapeWriter();
  const lengths = profileLengths(profile);
  const rings: Ring[] = [];

  const totalLength = totalLengthOf(lengths);

  for (const [index, point] of profile.entries()) {
    const normal = profileNormal(profile, index);
    const along = lengths[index] / totalLength;

    rings.push(latheRing(writer, point, normal, along, segments));
  }

  connectRingChain(writer, rings);

  return writer.finish();
}

function latheRing(
  writer: ShapeWriter,
  point: ProfilePoint,
  normal: ProfileNormal,
  along: number,
  segments: number
): Ring {
  if (point.radius <= POLE_RADIUS) {
    const poleDirection = normal.vertical >= 0 ? 1 : -1;

    return [writer.vertex(new Vector3(0, point.y, 0), new Vector3(0, poleDirection, 0), along, 0)];
  }

  const ring: number[] = [];

  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * FULL_TURN;

    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    const position = new Vector3(point.radius * cosine, point.y, point.radius * sine);
    const direction = new Vector3(normal.radial * cosine, normal.vertical, normal.radial * sine).normalize();

    ring.push(writer.vertex(position, direction, along, segment / segments));
  }

  return ring;
}

export function sphere(radius: number, segments = 12, rings = 8): Shape {
  const profile: ProfilePoint[] = [];

  for (let ring = 0; ring <= rings; ring += 1) {
    const angle = (ring / rings) * Math.PI;

    profile.push({ radius: Math.sin(angle) * radius, y: -Math.cos(angle) * radius });
  }

  return lathe(profile, segments);
}

function sectionLengths(sections: readonly LoftSection[]): number[] {
  const lengths = [0];

  for (let index = 1; index < sections.length; index += 1) {
    const previous = sections[index - 1];
    const current = sections[index];

    const step = Math.hypot(
      current.y - previous.y,
      (current.radiusX + current.radiusZ - previous.radiusX - previous.radiusZ) / 2
    );

    lengths.push(lengths[index - 1] + step);
  }

  return lengths;
}

function loftRing(writer: ShapeWriter, section: LoftSection, along: number, segments: number): Ring {
  const {
    centerX = 0,
    centerZ = 0,
    ripple = () => {
      return 1;
    },
  } = section;

  const placeholderNormal = new Vector3(0, 1, 0);

  if (section.radiusX <= POLE_RADIUS && section.radiusZ <= POLE_RADIUS) {
    return [writer.vertex(new Vector3(centerX, section.y, centerZ), placeholderNormal, along, 0)];
  }

  const ring: number[] = [];

  for (let segment = 0; segment < segments; segment += 1) {
    const around = segment / segments;

    const angle = around * FULL_TURN;
    const scale = ripple(around);

    const position = new Vector3(
      centerX + section.radiusX * scale * Math.cos(angle),
      section.y,
      centerZ + section.radiusZ * scale * Math.sin(angle)
    );

    ring.push(writer.vertex(position, placeholderNormal, along, around));
  }

  return ring;
}

export function loft(sections: readonly LoftSection[], segments: number): Shape {
  if (sections.length < 2) {
    throw new RangeError("A loft needs at least two sections");
  }

  const writer = new ShapeWriter();
  const lengths = sectionLengths(sections);
  const rings: Ring[] = [];

  const totalLength = totalLengthOf(lengths);

  for (const [index, section] of sections.entries()) {
    rings.push(loftRing(writer, section, lengths[index] / totalLength, segments));
  }

  connectRingChain(writer, rings);

  const shape = writer.finish();

  return { ...shape, normals: computeSmoothNormals(shape.positions, shape.indices) };
}

function panelRow(
  writer: ShapeWriter,
  section: LoftSection,
  options: PanelOptions,
  along: number,
  offset: number
): number[] {
  const {
    centerX = 0,
    centerZ = 0,
    ripple = () => {
      return 1;
    },
  } = section;
  const { angularSegments, endAngle, startAngle } = options;

  const placeholderNormal = new Vector3(0, 1, 0);
  const row: number[] = [];

  for (let column = 0; column <= angularSegments; column += 1) {
    const around = column / angularSegments;

    const angle = startAngle + (endAngle - startAngle) * around;
    const scale = ripple(around);

    const position = new Vector3(
      centerX + (section.radiusX * scale + offset) * Math.cos(angle),
      section.y,
      centerZ + (section.radiusZ * scale + offset) * Math.sin(angle)
    );

    row.push(writer.vertex(position, placeholderNormal, along, around));
  }

  return row;
}

export function panel(options: PanelOptions): Shape {
  const { angularSegments, sections, thickness } = options;

  if (sections.length < 2) {
    throw new RangeError("A panel needs at least two sections");
  }

  const writer = new ShapeWriter();
  const lengths = sectionLengths(sections);

  const totalLength = totalLengthOf(lengths);

  const outer = sections.map((section, index) => {
    return panelRow(writer, section, options, lengths[index] / totalLength, thickness / 2);
  });
  const inner = sections.map((section, index) => {
    return panelRow(writer, section, options, lengths[index] / totalLength, -thickness / 2);
  });

  for (let row = 0; row < sections.length - 1; row += 1) {
    for (let column = 0; column < angularSegments; column += 1) {
      writer.triangle(outer[row][column], outer[row + 1][column], outer[row][column + 1]);
      writer.triangle(outer[row][column + 1], outer[row + 1][column], outer[row + 1][column + 1]);
      writer.triangle(inner[row][column], inner[row][column + 1], inner[row + 1][column]);
      writer.triangle(inner[row][column + 1], inner[row + 1][column + 1], inner[row + 1][column]);
    }

    const last = angularSegments;

    writer.triangle(outer[row][0], inner[row][0], outer[row + 1][0]);
    writer.triangle(inner[row][0], inner[row + 1][0], outer[row + 1][0]);
    writer.triangle(outer[row][last], outer[row + 1][last], inner[row][last]);
    writer.triangle(inner[row][last], outer[row + 1][last], inner[row + 1][last]);
  }

  const top = sections.length - 1;

  for (let column = 0; column < angularSegments; column += 1) {
    writer.triangle(outer[0][column], outer[0][column + 1], inner[0][column]);
    writer.triangle(inner[0][column], outer[0][column + 1], inner[0][column + 1]);
    writer.triangle(outer[top][column], inner[top][column], outer[top][column + 1]);
    writer.triangle(inner[top][column], inner[top][column + 1], outer[top][column + 1]);
  }

  const shape = writer.finish();

  return { ...shape, normals: computeSmoothNormals(shape.positions, shape.indices) };
}

export function cylinder(options: CylinderOptions): Shape {
  const { height, radialSegments = 8, radiusBottom, radiusTop } = options;

  const writer = new ShapeWriter();
  const slope = new Vector3(height, radiusBottom - radiusTop, 0).normalize();
  const rings: Ring[] = [];

  for (const amount of [0, 1]) {
    const point = { radius: radiusBottom + (radiusTop - radiusBottom) * amount, y: height * amount };

    rings.push(latheRing(writer, point, { radial: slope.x, vertical: slope.y }, amount, radialSegments));
  }

  connectRingChain(writer, rings);

  if (radiusBottom > POLE_RADIUS) {
    addFlatCap(writer, radiusBottom, 0, radialSegments, false);
  }

  if (radiusTop > POLE_RADIUS) {
    addFlatCap(writer, radiusTop, height, radialSegments, true);
  }

  return writer.finish();
}

function addFlatCap(writer: ShapeWriter, radius: number, y: number, segments: number, isTop: boolean): void {
  const normal = new Vector3(0, isTop ? 1 : -1, 0);
  const along = isTop ? 1 : 0;
  const ring: number[] = [];

  const center = writer.vertex(new Vector3(0, y, 0), normal, along, 0);

  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * FULL_TURN;

    ring.push(writer.vertex(new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius), normal, along, 0));
  }

  capRing(writer, center, ring, isTop);
}

export function cone(radius: number, height: number, segments: number): Shape {
  return cylinder({ height, radialSegments: segments, radiusBottom: radius, radiusTop: 0 });
}

export function box(width: number, height: number, depth: number): Shape {
  const writer = new ShapeWriter();
  const halfSize = new Vector3(width / 2, height / 2, depth / 2);

  for (const face of BOX_FACES) {
    const corners = BOX_CORNERS.map(([signU, signV]) => {
      const position = face.normal
        .clone()
        .add(face.tangentU.clone().multiplyScalar(signU))
        .add(face.tangentV.clone().multiplyScalar(signV))
        .multiply(halfSize);

      return writer.vertex(position, face.normal, (position.y + halfSize.y) / Math.max(height, POLE_RADIUS), 0);
    });

    writer.triangle(corners[0], corners[1], corners[2]);
    writer.triangle(corners[0], corners[2], corners[3]);
  }

  return writer.finish();
}

export function icosphere(radius: number, detail = 1): Shape {
  const mesh = new IcosphereMesh();

  for (let level = 0; level < detail; level += 1) {
    mesh.subdivide();
  }

  const writer = new ShapeWriter();

  for (const point of mesh.points) {
    const around = (Math.atan2(point.z, point.x) / FULL_TURN + 1) % 1;

    writer.vertex(point.clone().multiplyScalar(radius), point, (point.y + 1) / 2, around);
  }

  for (const [first, second, third] of mesh.faces) {
    writer.triangle(first, second, third);
  }

  return writer.finish();
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

export function torus(radius: number, thickness: number, segments: number, sides: number): Shape {
  const writer = new ShapeWriter();
  const rings: number[][] = [];

  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * FULL_TURN;
    const ring: number[] = [];

    const outward = new Vector3(Math.cos(angle), 0, Math.sin(angle));

    const center = outward.clone().multiplyScalar(radius);

    for (let side = 0; side < sides; side += 1) {
      const sideAngle = (side / sides) * FULL_TURN;

      const normal = outward
        .clone()
        .multiplyScalar(Math.cos(sideAngle))
        .add(new Vector3(0, Math.sin(sideAngle), 0));

      ring.push(
        writer.vertex(
          center.clone().add(normal.clone().multiplyScalar(thickness)),
          normal,
          segment / segments,
          side / sides
        )
      );
    }

    rings.push(ring);
  }

  for (let segment = 0; segment < segments; segment += 1) {
    const current = rings[segment];
    const next = rings[(segment + 1) % segments];

    for (let side = 0; side < sides; side += 1) {
      const nextSide = (side + 1) % sides;

      writer.triangle(current[side], current[nextSide], next[side]);
      writer.triangle(next[side], current[nextSide], next[nextSide]);
    }
  }

  return writer.finish();
}

export function card(width: number, height: number): Shape {
  const writer = new ShapeWriter();
  const halfWidth = width / 2;

  for (const facing of [1, -1]) {
    const normal = new Vector3(0, 0, facing);

    const corners = [
      writer.vertex(new Vector3(-halfWidth * facing, 0, 0), normal, 0, 0),
      writer.vertex(new Vector3(halfWidth * facing, 0, 0), normal, 0, 1),
      writer.vertex(new Vector3(halfWidth * facing, height, 0), normal, 1, 1),
      writer.vertex(new Vector3(-halfWidth * facing, height, 0), normal, 1, 0),
    ];

    writer.triangle(corners[0], corners[1], corners[2]);
    writer.triangle(corners[0], corners[2], corners[3]);
  }

  return writer.finish();
}

export function disc(radius: number, segments: number): Shape {
  const writer = new ShapeWriter();
  const normal = new Vector3(0, 1, 0);
  const ring: number[] = [];

  const center = writer.vertex(new Vector3(0, 0, 0), normal, 0, 0);

  for (let segment = 0; segment < segments; segment += 1) {
    const angle = (segment / segments) * FULL_TURN;

    ring.push(
      writer.vertex(new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), normal, 1, segment / segments)
    );
  }

  capRing(writer, center, ring, true);

  return writer.finish();
}

export function blob(options: BlobOptions): Shape {
  const { detail = 1, frequency = 1.4, noise, offset = [0, 0, 0], radius, roughness = 0.22 } = options;

  return displaceShape(
    icosphere(radius, detail),
    (vertex) => {
      const sampleX = (vertex.x / radius) * frequency + offset[0];
      const sampleY = (vertex.y / radius) * frequency + offset[1];
      const sampleZ = (vertex.z / radius) * frequency + offset[2];

      return radius * roughness * noise.fractal(sampleX, sampleY, sampleZ, { octaves: 2 });
    },
    0.45
  );
}

export function lengthwiseLoft(sections: readonly BodySection[], segments: number): Shape {
  const loftSections = sections.map(({ centerX = 0, centerY, halfHeight, halfWidth, z }) => {
    return {
      centerX,
      centerZ: -centerY,
      radiusX: halfWidth,
      radiusZ: halfHeight,
      y: z,
    };
  });

  return transformShape(loft(loftSections, segments), LENGTHWISE);
}

class ShapeWriter {
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

class IcosphereMesh {
  readonly faces: [number, number, number][];
  readonly points: Vector3[];
  readonly #midpoints = new Map<number, number>();

  constructor() {
    this.points = ICOSAHEDRON_VERTICES.map(([x, y, z]) => {
      return new Vector3(x, y, z).normalize();
    });
    this.faces = ICOSAHEDRON_FACES.map(([first, second, third]) => {
      return [first, second, third];
    });
  }

  subdivide(): void {
    const faces = this.faces.splice(0);

    this.#midpoints.clear();

    for (const [first, second, third] of faces) {
      const firstMiddle = this.#midpoint(first, second);
      const secondMiddle = this.#midpoint(second, third);
      const thirdMiddle = this.#midpoint(third, first);

      this.faces.push(
        [first, firstMiddle, thirdMiddle],
        [second, secondMiddle, firstMiddle],
        [third, thirdMiddle, secondMiddle],
        [firstMiddle, secondMiddle, thirdMiddle]
      );
    }
  }

  #midpoint(first: number, second: number): number {
    const key = Math.min(first, second) * 1_000_003 + Math.max(first, second);

    const known = this.#midpoints.get(key);

    if (known !== undefined) {
      return known;
    }

    const point = this.points[first].clone().add(this.points[second]).normalize();

    this.points.push(point);
    this.#midpoints.set(key, this.points.length - 1);

    return this.points.length - 1;
  }
}
