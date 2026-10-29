import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder } from "../mesh/mesh-builder.ts";
import { tube } from "../mesh/shapes.ts";
import { SIDES, transformOf } from "../mesh/transforms.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import { forEachSide, headShape, headStroke } from "./human-anatomy.ts";
import { type HumanDetail, trimmedRing } from "./human-detail.ts";
import { armStyle } from "./human-rigging.ts";
import { HumanBone } from "./human-skeleton.ts";

function addWarBands(builder: MeshBuilder, detail: HumanDetail): void {
  for (const side of SIDES) {
    builder.add(trimmedRing(detail, 0.064, 0.012, 14), {
      style: { ...armStyle(side), slot: MaterialSlot.Berry },
      transform: transformOf({ position: [0.202 * side, 1.25, -0.004], rotation: [0, 0, -0.05 * side] }),
    });
  }
}

export function addWarPaint(builder: MeshBuilder, detail: HumanDetail): void {
  addWarBands(builder, detail);

  if (!detail.hasSmallParts) {
    return;
  }

  const face = { ...rigidStyle(HumanBone.Head), slot: MaterialSlot.Berry };
  const head = headShape(detail);
  const segments = detail.hasFineDetails ? 4 : 3;

  forEachSide((_side, mirror) => {
    for (const drop of [0, 0.022, 0.044]) {
      const stroke = headStroke(
        head,
        [
          [0.028, 1.612 - drop, 0.1],
          [0.05, 1.606 - drop, 0.09],
          [0.074, 1.598 - drop, 0.072],
        ],
        0.0055,
        -0.001
      );

      builder.add(tube(stroke, { radialSegments: segments }), { style: face, transform: mirror });
    }
  });

  builder.add(
    tube(
      headStroke(
        head,
        [
          [-0.05, 1.672, 0.088],
          [0, 1.678, 0.1],
          [0.05, 1.672, 0.088],
        ],
        0.006,
        -0.001
      ),
      {
        radialSegments: segments,
      }
    ),
    { style: face }
  );
}
