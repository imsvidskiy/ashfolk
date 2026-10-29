import { FULL_TURN } from "../../shared/math.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { VertexStyle } from "../mesh/mesh-builder.ts";
import { facetShape, type Shape, transformShape } from "../mesh/shape.ts";
import { type Triple, transformOf } from "../mesh/transforms.ts";
import { chiseledStone, STONE_NOISE } from "../stones.ts";
import { detail, type StructureContext } from "./structure-parts.ts";

const STREAK_FREQUENCY = 1.4;
const STREAK_TILT = 0.8;
const STREAK_STRETCH = 2.6;

export interface OreLook {
  readonly ore: MaterialSlotIndex;
  readonly richness: number;
}

interface OreChunk {
  readonly position: Triple;
  readonly radius: number;
  readonly squash: Triple;
}

function centroidAt(shape: Shape, triangle: number): Triple {
  let x = 0;
  let y = 0;
  let z = 0;

  for (let corner = 0; corner < 3; corner += 1) {
    const vertex = shape.indices[triangle * 3 + corner];

    x += shape.positions[vertex * 3];
    y += shape.positions[vertex * 3 + 1];
    z += shape.positions[vertex * 3 + 2];
  }

  return [x / 3, y / 3, z / 3];
}

function isStreak(point: Triple, richness: number): boolean {
  const [x, y, z] = point;

  const band = STONE_NOISE.sample(
    x * STREAK_FREQUENCY,
    (y + x * STREAK_TILT) * STREAK_FREQUENCY * STREAK_STRETCH,
    z * STREAK_FREQUENCY
  );

  return Math.abs(band) < richness;
}

function facetsWhere(faceted: Shape, keep: (triangle: number) => boolean): Shape {
  const triangles = Array.from({ length: faceted.indices.length / 3 }, (_, triangle) => {
    return triangle;
  }).filter(keep);
  const corners = triangles.length * 3;

  const positions = new Float32Array(corners * 3);
  const normals = new Float32Array(corners * 3);
  const along = new Float32Array(corners);
  const around = new Float32Array(corners);
  const indices = Uint32Array.from({ length: corners }, (_, corner) => {
    return corner;
  });

  for (const [index, triangle] of triangles.entries()) {
    for (let corner = 0; corner < 3; corner += 1) {
      const source = faceted.indices[triangle * 3 + corner];
      const target = index * 3 + corner;

      positions.set(faceted.positions.subarray(source * 3, source * 3 + 3), target * 3);
      normals.set(faceted.normals.subarray(source * 3, source * 3 + 3), target * 3);
      along[target] = faceted.along[source];
      around[target] = faceted.around[source];
    }
  }

  return { along, around, indices, normals, positions };
}

export function addStreakedRock(context: StructureContext, shape: Shape, look: OreLook, style: VertexStyle): void {
  const faceted = facetShape(shape);
  const streaks = Array.from({ length: faceted.indices.length / 3 }, (_, triangle) => {
    return isStreak(centroidAt(faceted, triangle), look.richness);
  });

  context.builder.add(
    facetsWhere(faceted, (triangle) => {
      return streaks[triangle];
    }),
    { style: { ...style, slot: look.ore } }
  );
  context.builder.add(
    facetsWhere(faceted, (triangle) => {
      return !streaks[triangle];
    }),
    { style: { ...style, slot: MaterialSlot.Stone } }
  );
}

export function addOreChunk(context: StructureContext, chunk: OreChunk, look: OreLook, style: VertexStyle): void {
  const stone = chiseledStone(
    context.random,
    { cuts: 6, depth: 0.45, radius: chunk.radius, roughness: 0.14 },
    detail(context, 1, 0)
  );

  const placed = transformShape(
    stone,
    transformOf({
      position: chunk.position,
      rotation: [context.random.signed() * 0.4, context.random.next() * FULL_TURN, context.random.signed() * 0.4],
      scale: chunk.squash,
    })
  );

  addStreakedRock(context, placed, look, style);
}

export function addOreHeap(context: StructureContext, center: Triple, spread: number, look: OreLook): void {
  const [x, , z] = center;

  const chunks = detail(context, 7, 3);

  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const angle = (chunk / chunks) * FULL_TURN + context.random.signed() * 0.4;
    const reach = chunk === 0 ? 0 : spread * context.random.between(0.45, 1);
    const radius = chunk === 0 ? spread * 0.55 : spread * context.random.between(0.28, 0.4);

    addOreChunk(
      context,
      {
        position: [x + Math.cos(angle) * reach, radius * 0.45, z + Math.sin(angle) * reach],
        radius,
        squash: [1, 0.7, 1],
      },
      look,
      { buildOrder: 0.85, shade: 0.9 }
    );
  }
}
