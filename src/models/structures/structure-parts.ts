import { hashToUnit, lerp, saturate, smoothstep } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom, type RandomSource } from "../../shared/random.ts";
import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder, SurfacePoint, VertexStyle } from "../mesh/mesh-builder.ts";
import { boundsOf, type MeshData } from "../mesh/mesh-data.ts";
import { deformShape, type Shape, transformShape } from "../mesh/shape.ts";
import { blob, box, card, cone, cylinder, type LoftSection, lathe } from "../mesh/shapes.ts";
import { segmentLength, segmentTransform, type Triple, transformOf } from "../mesh/transforms.ts";

export const GLOW_PART = 1;
export const STONE_ROUGHNESS = 0.12;

const STRUCTURE_NOISE = createVolumeNoise(createRandom(5151));
const SHADE_SALT = 41.3;

export type StructureLevel = "high" | "low";

export interface StructureContext {
  readonly builder: MeshBuilder;
  readonly level: StructureLevel;
  readonly random: RandomSource;
}

interface PitchedRoof {
  readonly eave: number;
  readonly length: number;
  readonly ridge: number;
  readonly span: number;
  readonly style: VertexStyle;
  readonly thickness: number;
}

type Outline = readonly (readonly [number, number])[];

interface SlabSpan {
  readonly from: readonly [y: number, z: number];
  readonly overhang: number;
  readonly thickness: number;
  readonly to: readonly [y: number, z: number];
  readonly width: number;
}

export function isDetailed(context: StructureContext): boolean {
  return context.level === "high";
}

export function detail(context: StructureContext, high: number, low: number): number {
  return isDetailed(context) ? high : low;
}

export function rising(from: number, to: number, bottom: number, top: number): (point: SurfacePoint) => number {
  return (point) => {
    return lerp(from, to, saturate((point.position.y - bottom) / (top - bottom)));
  };
}

export function upwardShade(darkest: number, bottom: number, top: number): (point: SurfacePoint) => number {
  const gain = 1 - darkest;

  return (point) => {
    return darkest + gain * smoothstep(bottom, top, point.position.y);
  };
}

export function thatchSections(
  bottom: number,
  top: number,
  radius: number,
  rimRipple: (around: number) => number
): LoftSection[] {
  return [
    { radiusX: 0, radiusZ: 0, y: bottom + 0.25 },
    { radiusX: radius * 0.8, radiusZ: radius * 0.8, y: bottom + 0.12 },
    { radiusX: radius, radiusZ: radius, ripple: rimRipple, y: bottom },
    { radiusX: radius * 0.45, radiusZ: radius * 0.45, y: bottom + (top - bottom) * 0.62 },
    { radiusX: 0.05, radiusZ: 0.05, y: top },
    { radiusX: 0, radiusZ: 0, y: top + 0.02 },
  ];
}

export function stoneShade(point: SurfacePoint): number {
  const course = Math.floor(point.position.y / 0.34);
  const block = Math.floor((point.position.x + point.position.z + course * 0.27) / 0.62);

  return 0.78 + 0.22 * hashToUnit(course, block, SHADE_SALT);
}

export function addLog(
  context: StructureContext,
  start: Triple,
  end: Triple,
  radius: number,
  style: VertexStyle
): void {
  context.builder.add(
    cylinder({
      height: segmentLength(start, end),
      radialSegments: detail(context, 7, 4),
      radiusBottom: radius,
      radiusTop: radius * 0.92,
    }),
    { style, transform: segmentTransform(start, end) }
  );
}

export function addBlock(context: StructureContext, size: Triple, position: Triple, style: VertexStyle): void {
  const [width, height, depth] = size;

  context.builder.add(box(width, height, depth), { style, transform: transformOf({ position }) });
}

export function addRock(
  context: StructureContext,
  position: Triple,
  radius: number,
  squash: Triple,
  style: VertexStyle
): void {
  const [x, y, z] = position;

  context.builder.add(
    blob({
      detail: detail(context, 1, 0),
      noise: STRUCTURE_NOISE,
      offset: [x * 2.1 + z * 0.7, y * 1.3, z * 1.9 - x * 0.4],
      radius,
      roughness: STONE_ROUGHNESS,
    }),
    { style, transform: transformOf({ position, scale: squash }) }
  );
}

export function moundShape(context: StructureContext, position: Triple, radius: number, squash: Triple): Shape {
  const [x, , z] = position;

  const rock = blob({
    detail: detail(context, 2, 1),
    noise: STRUCTURE_NOISE,
    offset: [x * 1.7, 3.1, z * 1.3],
    radius,
    roughness: STONE_ROUGHNESS,
  });

  const floored = deformShape(rock, (vertex) => {
    return [0, vertex.y < 0 ? -vertex.y : 0, 0];
  });

  return transformShape(floored, transformOf({ position: [x, 0, z], scale: squash }));
}

export function addMound(
  context: StructureContext,
  position: Triple,
  radius: number,
  squash: Triple,
  style: VertexStyle
): void {
  context.builder.add(moundShape(context, position, radius, squash), { style });
}

export function addFlag(
  context: StructureContext,
  base: Triple,
  poleHeight: number,
  turn: number,
  order: number
): void {
  const [x, y, z] = base;

  const width = 0.62;
  const height = 0.42;

  addLog(context, [x, y, z], [x, y + poleHeight, z], 0.035, { buildOrder: order, slot: MaterialSlot.Wood });
  context.builder.add(card(width, height), {
    style: { buildOrder: order, slot: MaterialSlot.Accent },
    transform: transformOf({
      position: [
        x + Math.cos(turn) * (width / 2 + 0.02),
        y + poleHeight - height - 0.06,
        z - Math.sin(turn) * (width / 2 + 0.02),
      ],
      rotation: [0, turn, 0],
    }),
  });
}

export function addJar(context: StructureContext, position: Triple, height: number, style: VertexStyle): void {
  const sides = detail(context, 10, 6);

  context.builder.add(
    lathe(
      [
        { radius: 0, y: 0 },
        { radius: height * 0.3, y: 0.01 },
        { radius: height * 0.46, y: height * 0.42 },
        { radius: height * 0.26, y: height * 0.88 },
        { radius: height * 0.3, y: height },
        { radius: 0, y: height * 0.9 },
      ],
      sides
    ),
    { style, transform: transformOf({ position }) }
  );
}

export function addLogPile(
  context: StructureContext,
  center: Triple,
  turn: number,
  length: number,
  order: number
): void {
  const [x, , z] = center;

  const radius = 0.1;
  const rows = detail(context, 3, 1);

  const alongX = Math.cos(turn) * (length / 2);
  const alongZ = -Math.sin(turn) * (length / 2);
  const acrossX = Math.sin(turn);
  const acrossZ = Math.cos(turn);

  for (let row = 0; row < rows; row += 1) {
    const count = rows === 1 ? 3 : rows - row;

    for (let log = 0; log < count; log += 1) {
      const offset = (log - (count - 1) / 2) * radius * 1.85;
      const height = radius + row * radius * 1.4;

      const middleX = x + acrossX * offset;
      const middleZ = z + acrossZ * offset;

      addLog(
        context,
        [middleX - alongX, height, middleZ - alongZ],
        [middleX + alongX, height, middleZ + alongZ],
        radius,
        {
          buildOrder: order,
          slot: MaterialSlot.Bark,
        }
      );
    }
  }
}

export function addPitchedRoof(context: StructureContext, roof: PitchedRoof): void {
  const run = roof.span / 2;
  const rise = roof.ridge - roof.eave;
  const angle = Math.atan2(rise, run);
  const slope = Math.hypot(run, rise) + roof.thickness * 0.6;

  for (const side of [-1, 1]) {
    context.builder.add(box(roof.length, roof.thickness, slope), {
      style: roof.style,
      transform: transformOf({
        position: [0, (roof.eave + roof.ridge) / 2, (side * run) / 2],
        rotation: [side * angle, 0, 0],
      }),
    });
  }
}

export function prism(outline: Outline, depth: number): Shape {
  const positions: number[] = [];
  const normals: number[] = [];
  const along: number[] = [];
  const indices: number[] = [];

  const heights = outline.map(([, y]) => {
    return y;
  });
  const lowest = Math.min(...heights);
  const span = Math.max(...heights) - lowest;
  const halfDepth = depth / 2;

  function vertex(x: number, y: number, z: number, normal: Triple): number {
    positions.push(x, y, z);
    normals.push(...normal);
    along.push(saturate((y - lowest) / span));

    return along.length - 1;
  }

  for (const facing of [1, -1]) {
    const corners = outline.map(([x, y]) => {
      return vertex(x, y, facing * halfDepth, [0, 0, facing]);
    });

    for (let corner = 1; corner < corners.length - 1; corner += 1) {
      if (facing > 0) {
        indices.push(corners[0], corners[corner], corners[corner + 1]);

        continue;
      }

      indices.push(corners[0], corners[corner + 1], corners[corner]);
    }
  }

  for (const [index, [x, y]] of outline.entries()) {
    const [nextX, nextY] = outline[(index + 1) % outline.length];

    const edgeX = nextX - x;
    const edgeY = nextY - y;
    const length = Math.hypot(edgeX, edgeY);
    const normal: Triple = [edgeY / length, -edgeX / length, 0];

    const front = vertex(x, y, halfDepth, normal);
    const nextFront = vertex(nextX, nextY, halfDepth, normal);
    const nextBack = vertex(nextX, nextY, -halfDepth, normal);
    const back = vertex(x, y, -halfDepth, normal);

    indices.push(front, back, nextBack, front, nextBack, nextFront);
  }

  return {
    along: new Float32Array(along),
    around: new Float32Array(along.length),
    indices: new Uint32Array(indices),
    normals: new Float32Array(normals),
    positions: new Float32Array(positions),
  };
}

export function scaledMesh(mesh: MeshData, factor: number): MeshData {
  if (factor === 1) {
    return mesh;
  }

  const positions = mesh.positions.map((value) => {
    return value * factor;
  });

  return { ...mesh, bounds: boundsOf(positions), positions };
}

export function addSpike(
  context: StructureContext,
  base: Triple,
  tip: Triple,
  radius: number,
  style: VertexStyle
): void {
  context.builder.add(cone(radius, segmentLength(base, tip), detail(context, 6, 4)), {
    style,
    transform: segmentTransform(base, tip),
  });
}

export function addSlab(context: StructureContext, span: SlabSpan, style: VertexStyle): void {
  const [fromY, fromZ] = span.from;
  const [toY, toZ] = span.to;

  const rise = toY - fromY;
  const run = toZ - fromZ;
  const length = Math.hypot(rise, run);
  const normalY = run / length;
  const normalZ = -rise / length;
  const half = span.thickness / 2;

  context.builder.add(box(span.width, span.thickness, length + span.overhang * 2), {
    style,
    transform: transformOf({
      position: [0, (fromY + toY) / 2 + normalY * half, (fromZ + toZ) / 2 + normalZ * half],
      rotation: [Math.atan2(-rise, run), 0, 0],
    }),
  });
}
