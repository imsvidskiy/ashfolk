import { MaterialSlot } from "../materials.ts";
import { card, cylinder } from "../mesh/shapes.ts";
import { segmentLength, segmentTransform, type Triple, transformOf } from "../mesh/transforms.ts";
import { detail, type StructureContext } from "./structure-parts.ts";

interface Flag {
  readonly bottom: number;
  readonly height: number;
  readonly turn: number;
  readonly width: number;
}

export function addTaperedLog(
  context: StructureContext,
  start: Triple,
  end: Triple,
  radius: number,
  order: number
): void {
  context.builder.add(
    cylinder({
      height: segmentLength(start, end),
      radialSegments: detail(context, 6, 4),
      radiusBottom: radius,
      radiusTop: radius * 0.85,
    }),
    {
      style: { buildOrder: order, slot: MaterialSlot.Wood },
      transform: segmentTransform(start, end),
    }
  );
}

export function addFlagCloth(context: StructureContext, pole: Triple, flag: Flag): void {
  const [x, , z] = pole;

  const halfWidth = flag.width / 2;

  context.builder.add(card(flag.width, flag.height), {
    style: { buildOrder: 1, slot: MaterialSlot.Accent },
    transform: transformOf({
      position: [x + Math.cos(flag.turn) * halfWidth, flag.bottom, z - Math.sin(flag.turn) * halfWidth],
      rotation: [0, flag.turn, 0],
    }),
  });
}
