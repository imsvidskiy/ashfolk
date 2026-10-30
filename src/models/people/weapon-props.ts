import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { MeshBuilder, VertexStyle } from "../mesh/mesh-builder.ts";
import { box, cone, cylinder, lathe } from "../mesh/shapes.ts";
import {
  lerpTriple,
  type Side,
  segmentLength,
  segmentTransform,
  type Triple,
  transformOf,
} from "../mesh/transforms.ts";
import { type TubePoint, tube } from "../mesh/tubes.ts";
import { type HumanDetail, trimSegments } from "./human-detail.ts";
import { HumanBone } from "./human-skeleton.ts";
import { addRod, inLeftHand, inRightHand, LEFT_FIST, onChest, RIGHT_FIST } from "./prop-placement.ts";

const BOW_HALF_LENGTH = 0.6;
const BOW_BEND = 0.085;
const BOW_GRIP_RADIUS = 0.017;
const BOW_TIP_RADIUS = 0.006;
const STRING_RADIUS = 0.0035;
const ARROW_RADIUS = 0.0065;
const ARROWHEAD_LENGTH = 0.11;
const ARROW_AIM: Triple = [0.4, -0.9, -0.16];
const QUIVER_BOTTOM: Triple = [0.11, 0.96, -0.14];
const QUIVER_TOP: Triple = [-0.09, 1.44, -0.15];
const QUIVER_RADIUS = 0.048;
const QUIVER_ARROWS = 4;
const FAR_QUIVER_SINK = 0.035;
const PICK_HAFT_LENGTH = 0.62;
const PICK_HAFT_RADIUS = 0.017;

function betweenHands(slot: MaterialSlotIndex): VertexStyle {
  return {
    boneA: HumanBone.HandLeft,
    boneB: HumanBone.HandRight,
    boneWeight: (point) => {
      return point.along;
    },
    slot,
  };
}

function bowPoint(along: number): TubePoint {
  const [x, y, z] = LEFT_FIST;

  const reach = Math.abs(along);

  return {
    radius: BOW_GRIP_RADIUS + (BOW_TIP_RADIUS - BOW_GRIP_RADIUS) * reach,
    x,
    y: y + BOW_BEND * reach * reach,
    z: z + along * BOW_HALF_LENGTH,
  };
}

function bowTip(side: Side): Triple {
  const point = bowPoint(side);

  return [point.x, point.y, point.z];
}

function addBowStave(builder: MeshBuilder, detail: HumanDetail): void {
  const samples = trimSegments(detail, 9);

  const points = Array.from({ length: samples }, (_, index) => {
    return bowPoint((index / (samples - 1)) * 2 - 1);
  });

  builder.add(tube(points, { radialSegments: trimSegments(detail, 6) }), {
    style: inLeftHand(MaterialSlot.Wood),
  });

  const [x, y, z] = LEFT_FIST;

  builder.add(cylinder({ height: 0.1, radialSegments: 6, radiusBottom: 0.021, radiusTop: 0.021 }), {
    style: inLeftHand(MaterialSlot.Hide),
    transform: transformOf({ position: [x, y, z - 0.05], rotation: [Math.PI / 2, 0, 0] }),
  });
}

function stringPoints(from: Triple, to: Triple): TubePoint[] {
  return [
    { radius: STRING_RADIUS, x: from[0], y: from[1], z: from[2] },
    { radius: STRING_RADIUS, x: to[0], y: to[1], z: to[2] },
  ];
}

export function addBow(builder: MeshBuilder, detail: HumanDetail): void {
  addBowStave(builder, detail);
  builder.add(tube(stringPoints(bowTip(-1), bowTip(1)), { radialSegments: 4 }), {
    style: inLeftHand(MaterialSlot.Rope),
  });
}

function aimDirection(): Triple {
  const length = Math.hypot(...ARROW_AIM);

  return [ARROW_AIM[0] / length, ARROW_AIM[1] / length, ARROW_AIM[2] / length];
}

export function addDrawnBow(builder: MeshBuilder, detail: HumanDetail): void {
  const nock: Triple = [RIGHT_FIST[0], RIGHT_FIST[1] + 0.012, RIGHT_FIST[2] + 0.01];
  const grip: Triple = [LEFT_FIST[0], LEFT_FIST[1] + 0.01, LEFT_FIST[2]];
  const aim = aimDirection();

  addBowStave(builder, detail);

  for (const tip of [bowTip(-1), bowTip(1)]) {
    builder.add(tube(stringPoints(tip, nock), { radialSegments: 4 }), { style: betweenHands(MaterialSlot.Rope) });
  }

  builder.add(
    tube(
      [
        { radius: ARROW_RADIUS, x: grip[0], y: grip[1], z: grip[2] },
        { radius: ARROW_RADIUS, x: nock[0], y: nock[1], z: nock[2] },
      ],
      { radialSegments: 4 }
    ),
    { style: betweenHands(MaterialSlot.Wood) }
  );

  const tip: Triple = [
    grip[0] + aim[0] * ARROWHEAD_LENGTH,
    grip[1] + aim[1] * ARROWHEAD_LENGTH,
    grip[2] + aim[2] * ARROWHEAD_LENGTH,
  ];

  builder.add(cone(0.016, segmentLength(grip, tip), trimSegments(detail, 5)), {
    style: inLeftHand(MaterialSlot.Metal),
    transform: segmentTransform(grip, tip),
  });
}

function quiverEnd(detail: HumanDetail, end: Triple): Triple {
  const sink = detail.hasSmallParts ? 0 : FAR_QUIVER_SINK;

  return [end[0], end[1], end[2] + sink];
}

function alongQuiver(share: number): Triple {
  return lerpTriple(QUIVER_BOTTOM, QUIVER_TOP, share);
}

function addQuiverArrow(builder: MeshBuilder, detail: HumanDetail, index: number): void {
  const spread = (index - (QUIVER_ARROWS - 1) / 2) * 0.014;

  const [baseX, baseY, baseZ] = alongQuiver(0.8);
  const [endX, endY, endZ] = alongQuiver(1.3);

  const base: Triple = [baseX + spread, baseY, baseZ + spread * 0.4];
  const end: Triple = [endX + spread * 1.8, endY, endZ + spread * 0.8];

  addRod(builder, detail, { end, radius: 0.0055, start: base }, onChest(MaterialSlot.Wood));

  if (!detail.hasFineDetails) {
    return;
  }

  const fletching = lerpTriple(base, end, 0.86);

  builder.add(box(0.026, 0.05, 0.006), {
    style: onChest(MaterialSlot.Accent),
    transform: segmentTransform(fletching, end),
  });
}

export function addQuiver(builder: MeshBuilder, detail: HumanDetail): void {
  const segments = trimSegments(detail, 10);
  const length = segmentLength(QUIVER_BOTTOM, QUIVER_TOP);

  builder.add(
    lathe(
      [
        { radius: 0, y: 0 },
        { radius: QUIVER_RADIUS * 0.85, y: 0.004 },
        { radius: QUIVER_RADIUS, y: 0.05 },
        { radius: QUIVER_RADIUS * 1.08, y: length - 0.02 },
        { radius: QUIVER_RADIUS * 1.12, y: length },
        { radius: 0, y: length - 0.03 },
      ],
      segments
    ),
    {
      style: onChest(MaterialSlot.Hide),
      transform: segmentTransform(quiverEnd(detail, QUIVER_BOTTOM), quiverEnd(detail, QUIVER_TOP)),
    }
  );

  if (!detail.hasSmallParts) {
    return;
  }

  for (let index = 0; index < QUIVER_ARROWS; index += 1) {
    addQuiverArrow(builder, detail, index);
  }
}

export function addPickaxe(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = RIGHT_FIST;

  const end = z + PICK_HAFT_LENGTH;

  addRod(
    builder,
    detail,
    { end: [x, y, end], radius: PICK_HAFT_RADIUS, start: [x, y, z - 0.09] },
    inRightHand(MaterialSlot.Wood)
  );
  builder.add(
    tube(
      [
        { radius: 0.004, x, y: y - 0.21, z: end - 0.08 },
        { radius: 0.014, x, y: y - 0.12, z: end - 0.02 },
        { radius: 0.024, x, y, z: end },
        { radius: 0.018, x, y: y + 0.09, z: end - 0.02 },
        { radius: 0.01, x, y: y + 0.15, z: end - 0.06 },
      ],
      { radialSegments: trimSegments(detail, 6) }
    ),
    { style: inRightHand(MaterialSlot.Metal) }
  );
}
