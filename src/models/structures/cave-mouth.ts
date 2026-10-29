import { clamp, lerp, smoothstep } from "../../shared/math.ts";
import { createRandom, type RandomSource } from "../../shared/random.ts";
import type { MaterialSlotIndex } from "../materials.ts";
import { MeshBuilder, type SurfacePoint } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { facetShape, type Shape } from "../mesh/shape.ts";
import { groundShade, weatheredSlot } from "../stones.ts";

const HEIGHT_SHARE = [0.66, 0.78] as const;
const ARCH_SEGMENTS = 9;
const LEG_SEGMENTS = 2;
const SILL_DEPTH = 0.6;
const SHOULDER_SHARE = 0.85;
const LOWEST_CROWN = 2.4;
const HIGHEST_CROWN = 9;
const INSIDE_DEPTH_SHARE = 0.55;
const INSIDE_NARROWING = 0.18;
const INSIDE_RINGS = 3;
const BACK_WALL_SINK = 0.8;
const BURIED_Z = -12.5;
const BRIGHTEST_INSIDE = 0.6;
const DARKEST_INSIDE = 0.16;
const LIP_Z = 0.35;
const BODY_WIDTH = 9;

export interface CaveLook {
  readonly base: MaterialSlotIndex;
  readonly frost: number;
  readonly moss: number;
}

interface CaveMouthOptions {
  readonly bury: number;
  readonly look: CaveLook;
  readonly rise: number;
  readonly seed: number;
  readonly width: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface OutlinePoint {
  readonly outwardX: number;
  readonly outwardY: number;
  readonly x: number;
  readonly y: number;
}

interface Opening {
  readonly depth: number;
  readonly height: number;
  readonly outline: readonly OutlinePoint[];
  readonly width: number;
}

interface FaceRing {
  readonly drop: number;
  readonly jitter: number;
  readonly offset: number;
  readonly z: number;
}

const FACE_RINGS: readonly Omit<FaceRing, "drop">[] = [
  { jitter: 0.1, offset: 0, z: LIP_Z },
  { jitter: 0.3, offset: 0.14, z: 0.55 },
  { jitter: 0.45, offset: 0.36, z: 0 },
  { jitter: 0.5, offset: 0.62, z: -1.6 },
  { jitter: 0.5, offset: 0.86, z: -4.2 },
  { jitter: 0.4, offset: 1, z: -7.5 },
];

function openingOutline(width: number, height: number, random: RandomSource): OutlinePoint[] {
  const halfWidth = width / 2;
  const springLine = height - halfWidth;

  const legs = Array.from({ length: LEG_SEGMENTS }, (_, step) => {
    return lerp(-SILL_DEPTH, springLine, step / LEG_SEGMENTS);
  });
  const arch = Array.from({ length: ARCH_SEGMENTS + 1 }, (_, step) => {
    const angle = Math.PI * (1 - step / ARCH_SEGMENTS);
    const swell = 1 + random.signed() * 0.05;

    return {
      outwardX: Math.cos(angle),
      outwardY: Math.sin(angle),
      x: Math.cos(angle) * halfWidth * swell,
      y: springLine + Math.sin(angle) * halfWidth * swell,
    };
  });

  return [
    ...legs.map((y) => {
      return { outwardX: -1, outwardY: 0, x: -halfWidth, y };
    }),
    ...arch,
    ...legs.toReversed().map((y) => {
      return { outwardX: 1, outwardY: 0, x: halfWidth, y };
    }),
  ];
}

function isBottom(index: number, outline: readonly OutlinePoint[]): boolean {
  return index === 0 || index === outline.length - 1;
}

function faceRing(opening: Opening, ring: FaceRing, spread: Omit<Point, "z">, random: RandomSource): Point[] {
  return opening.outline.map((point, index) => {
    function wobble(scale: number): number {
      return random.signed() * ring.jitter * scale;
    }

    const x = point.x + point.outwardX * ring.offset * spread.x + wobble(1);
    const y = isBottom(index, opening.outline)
      ? point.y - ring.drop
      : point.y + point.outwardY * ring.offset * spread.y + wobble(0.8);

    return { x, y, z: ring.z + wobble(0.7) };
  });
}

function insideRing(opening: Opening, step: number, random: RandomSource): Point[] {
  const share = step / INSIDE_RINGS;
  const narrowing = 1 - INSIDE_NARROWING * share;

  return opening.outline.map((point, index) => {
    return {
      x: point.x * narrowing + random.signed() * 0.12,
      y: isBottom(index, opening.outline) ? point.y : point.y * narrowing + random.signed() * 0.12,
      z: LIP_Z - opening.depth * share,
    };
  });
}

function outcropShape(opening: Opening, options: CaveMouthOptions, random: RandomSource): Shape {
  const writer = new CaveWriter();

  const crown = clamp(options.rise - opening.height, LOWEST_CROWN, HIGHEST_CROWN);
  const spread = { x: opening.width * SHOULDER_SHARE, y: crown };
  const lowest = Math.max(options.bury, SILL_DEPTH + 1);
  const length = Math.max(opening.width / BODY_WIDTH, 1);

  const face = FACE_RINGS.map((ring, index) => {
    return writer.addRing(
      faceRing(
        opening,
        { ...ring, drop: lerp(0, lowest - SILL_DEPTH, index / (FACE_RINGS.length - 1)), z: ring.z * length },
        spread,
        random
      )
    );
  });

  let [outermost] = face;

  for (const ring of face.slice(1)) {
    writer.addBand(outermost, ring, true);
    outermost = ring;
  }

  let [innermost] = face;

  for (let step = 1; step <= INSIDE_RINGS; step += 1) {
    const ring = writer.addRing(insideRing(opening, step, random));

    writer.addBand(innermost, ring, false);
    innermost = ring;
  }

  const backWall = writer.addPoint({
    x: random.signed() * 0.3,
    y: (opening.height - SILL_DEPTH) * 0.4,
    z: LIP_Z - opening.depth - BACK_WALL_SINK,
  });
  const buried = writer.addPoint({ x: 0, y: -lowest, z: BURIED_Z * length });

  writer.addFan(backWall, innermost, true);
  writer.addFan(buried, outermost, false);

  return writer.build();
}

function caveShade(opening: Opening): (point: SurfacePoint) => number {
  const outside = groundShade(opening.height * 2);
  const halfWidth = opening.width / 2;

  return (point) => {
    const { position } = point;

    const isInside = position.z < LIP_Z && Math.abs(position.x) < halfWidth * 1.05;
    const isUnderArch = position.y < opening.height + 0.2;

    if (!(isInside && isUnderArch)) {
      return outside(point);
    }

    const depth = smoothstep(LIP_Z, LIP_Z - opening.depth, position.z);

    return lerp(BRIGHTEST_INSIDE, DARKEST_INSIDE, depth);
  };
}

export function meshCaveMouth(options: CaveMouthOptions): MeshData {
  const random = createRandom(Math.floor(options.seed * 1_000_000) + 1);
  const builder = new MeshBuilder();

  const height = options.width * random.between(...HEIGHT_SHARE);
  const opening: Opening = {
    depth: options.width * INSIDE_DEPTH_SHARE + 1,
    height,
    outline: openingOutline(options.width, height, random),
    width: options.width,
  };

  builder.add(outcropShape(opening, options, random), {
    style: {
      shade: caveShade(opening),
      slot: weatheredSlot({
        base: options.look.base,
        frost: options.look.frost,
        lichen: 0.12,
        moss: options.look.moss,
        seed: random.next() * 40,
      }),
    },
  });

  return builder.build();
}

class CaveWriter {
  readonly #indices: number[] = [];
  readonly #positions: number[] = [];

  addPoint(point: Point): number {
    this.#positions.push(point.x, point.y, point.z);

    return this.#positions.length / 3 - 1;
  }

  addRing(points: readonly Point[]): number[] {
    return points.map((point) => {
      return this.addPoint(point);
    });
  }

  addBand(inner: readonly number[], outer: readonly number[], isFacingOut: boolean): void {
    for (let index = 0; index < inner.length - 1; index += 1) {
      const corners = [inner[index], inner[index + 1], outer[index + 1], outer[index]];

      if (isFacingOut) {
        this.#addTriangle(corners[0], corners[1], corners[2]);
        this.#addTriangle(corners[0], corners[2], corners[3]);

        continue;
      }

      this.#addTriangle(corners[0], corners[2], corners[1]);
      this.#addTriangle(corners[0], corners[3], corners[2]);
    }
  }

  addFan(center: number, ring: readonly number[], isFacingFront: boolean): void {
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];

      if (isFacingFront) {
        this.#addTriangle(center, next, current);

        continue;
      }

      this.#addTriangle(center, current, next);
    }
  }

  build(): Shape {
    const positions = Float32Array.from(this.#positions);
    const count = positions.length / 3;

    return facetShape({
      along: new Float32Array(count),
      around: new Float32Array(count),
      indices: Uint32Array.from(this.#indices),
      normals: new Float32Array(positions.length),
      positions,
    });
  }

  #addTriangle(first: number, second: number, third: number): void {
    this.#indices.push(first, second, third);
  }
}
