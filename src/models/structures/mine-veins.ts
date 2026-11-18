import { Vector3, Vector4 } from "three";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { VertexStyle } from "../mesh/mesh-builder.ts";
import { facetShape, type Shape } from "../mesh/shape.ts";
import { ShapeWriter } from "../mesh/shape-writer.ts";
import type { StructureContext } from "./structure-parts.ts";

function cutAt(polygon: readonly Vector4[], bedHeight: number): [Vector4[], Vector4[]] {
  const below: Vector4[] = [];
  const above: Vector4[] = [];

  for (const [index, start] of polygon.entries()) {
    const end = polygon[(index + 1) % polygon.length];
    const startDepth = start.w - bedHeight;
    const endDepth = end.w - bedHeight;

    if (startDepth <= 0) {
      below.push(start);
    }

    if (startDepth >= 0) {
      above.push(start);
    }

    if ((startDepth < 0 && endDepth > 0) || (startDepth > 0 && endDepth < 0)) {
      const crossing = start.clone().lerp(end, startDepth / (startDepth - endDepth));

      below.push(crossing);
      above.push(crossing);
    }
  }

  return [below, above];
}

function addFace(writer: ShapeWriter, polygon: readonly Vector4[], normal: Vector3): void {
  if (polygon.length < 3) {
    return;
  }

  const corners = polygon.map(({ x, y, z }) => {
    return writer.vertex(new Vector3(x, y, z), normal, 0, 0);
  });

  for (let corner = 2; corner < corners.length; corner += 1) {
    writer.triangle(corners[0], corners[corner - 1], corners[corner]);
  }
}

export function addVeinedHill(
  context: StructureContext,
  hill: Shape,
  ore: MaterialSlotIndex,
  richness: number,
  style: VertexStyle
): void {
  const surface = facetShape(hill);
  const rock = new ShapeWriter();
  const mineral = new ShapeWriter();
  const beds = [0, richness, 0.64, 0.64 + richness * 0.6];

  for (let face = 0; face < surface.indices.length; face += 3) {
    const normal = new Vector3().fromArray(surface.normals, face * 3);
    let polygon: Vector4[] = [];

    for (let corner = 0; corner < 3; corner += 1) {
      const point = new Vector3().fromArray(surface.positions, (face + corner) * 3);
      const { x, y, z } = point;
      const bedHeight = 0.68 + x * 0.38 - z * 0.21 + 0.16 * Math.sin(1.8 * x + 0.54 * z);
      const thickness = 1.05 + 0.67 * Math.sin(0.85 * x + 0.52 * z);

      polygon.push(new Vector4(x, y, z, (y - bedHeight) / thickness));
    }

    for (const [index, bed] of beds.entries()) {
      const [below, remaining] = cutAt(polygon, bed);

      addFace(index % 2 === 0 ? rock : mineral, below, normal);
      polygon = remaining;
    }

    addFace(rock, polygon, normal);
  }

  context.builder.add(rock.finish(), { style: { ...style, slot: MaterialSlot.Stone } });
  context.builder.add(mineral.finish(), { style: { ...style, slot: ore } });
}
