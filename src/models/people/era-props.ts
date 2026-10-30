import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder } from "../mesh/mesh-builder.ts";
import { box, lathe } from "../mesh/shapes.ts";
import { transformOf } from "../mesh/transforms.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import { type HumanDetail, trimSegments } from "./human-detail.ts";
import { HumanBone } from "./human-skeleton.ts";

export function addHelmet(builder: MeshBuilder, detail: HumanDetail): void {
  const style = { ...rigidStyle(HumanBone.Head), slot: MaterialSlot.Metal };

  builder.add(
    lathe(
      [
        { radius: 0, y: 1.64 },
        { radius: 0.104, y: 1.643 },
        { radius: 0.113, y: 1.662 },
        { radius: 0.106, y: 1.705 },
        { radius: 0.078, y: 1.77 },
        { radius: 0.034, y: 1.82 },
        { radius: 0.008, y: 1.842 },
        { radius: 0, y: 1.845 },
      ],
      trimSegments(detail, 14)
    ),
    { style, transform: transformOf({ position: [0, 0, -0.006], scale: [1, 1, 1.1] }) }
  );

  if (!detail.hasFineDetails) {
    return;
  }

  builder.add(box(0.018, 0.075, 0.012), {
    style,
    transform: transformOf({ position: [0, 1.625, 0.112], rotation: [-0.18, 0, 0] }),
  });
}
