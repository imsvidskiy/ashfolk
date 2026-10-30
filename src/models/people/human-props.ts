import { Vector3 } from "three";
import { FULL_TURN } from "../../shared/math.ts";
import { segmentsAtLeast } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import type { MeshBuilder } from "../mesh/mesh-builder.ts";
import type { Shape } from "../mesh/shape.ts";
import { blob, box, cone, cylinder, type LoftSection, lathe, loft, sphere } from "../mesh/shapes.ts";
import { segmentLength, segmentTransform, type Triple, transformOf } from "../mesh/transforms.ts";
import { tube } from "../mesh/tubes.ts";
import { rigidStyle } from "../rig/skin-weights.ts";
import { STONE_NOISE } from "../stones.ts";
import { forEachSide, headShape, headStroke } from "./human-anatomy.ts";
import { type HumanDetail, trimmedRing, trimSegments } from "./human-detail.ts";
import { armStyle, FLEXIBLE_TORSO_STYLE } from "./human-rigging.ts";
import { HumanBone } from "./human-skeleton.ts";
import { addRod, CRADLE, inLeftHand, inRightHand, LEFT_FIST, onChest, RIGHT_FIST } from "./prop-placement.ts";

const SHOULDER_GRIP: Triple = [0.25, 1.46, 0.21];
const FEATHER_LENGTH = 0.17;
const FEATHER_TIP = 0.05;
const NECKLACE_RADIUS = 0.088;
const NECKLACE_CORD = transformOf({ position: [0, 1.425, 0.005], rotation: [-0.35, 0, 0], scale: [1, 1, 0.9] });
const TOOTH_ANGLES = [-0.3, 0, 0.3];

function lump(detail: HumanDetail, offset: Triple, radius: number, roughness: number): Shape {
  return blob({ detail: detail.propSubdivisions, noise: STONE_NOISE, offset, radius, roughness });
}

export function addHeadband(builder: MeshBuilder, detail: HumanDetail): void {
  builder.add(trimmedRing(detail, 0.1, 0.011, 16), {
    style: { ...rigidStyle(HumanBone.Head), slot: MaterialSlot.Accent },
    transform: transformOf({ position: [0, 1.684, -0.008], rotation: [0.1, 0, 0], scale: [1.02, 1, 1.13] }),
  });
}

function featherVane(detail: HumanDetail): Shape {
  const sections: LoftSection[] = [
    { radiusX: 0, radiusZ: 0, y: 0 },
    { radiusX: 0.009, radiusZ: 0.003, y: 0.012 },
    { radiusX: 0.016, radiusZ: 0.004, y: 0.05 },
    { radiusX: 0.017, radiusZ: 0.004, y: 0.1 },
    { radiusX: 0.012, radiusZ: 0.003, y: 0.15 },
    { radiusX: 0, radiusZ: 0, y: FEATHER_LENGTH },
  ];

  return loft(sections, detail.hasFineDetails ? 6 : 4);
}

export function addFeather(builder: MeshBuilder, detail: HumanDetail): void {
  const quill = transformOf({ position: [0.07, 1.68, -0.08], rotation: [-0.42, 0.6, -0.18] });
  const style = rigidStyle(HumanBone.Head);

  builder.add(featherVane(detail), {
    style: {
      ...style,
      slot: (point) => {
        return point.local.y > FEATHER_LENGTH - FEATHER_TIP ? MaterialSlot.Accent : MaterialSlot.Bone;
      },
    },
    transform: quill,
  });
  builder.add(
    tube(
      [
        { radius: 0.004, x: 0, y: -0.045, z: 0 },
        { radius: 0.004, x: 0, y: 0.03, z: 0 },
      ],
      { radialSegments: 4 }
    ),
    { style: { ...style, slot: MaterialSlot.Bone }, transform: quill }
  );
}

export function addNecklace(builder: MeshBuilder, detail: HumanDetail): void {
  const style = onChest(MaterialSlot.Bone);

  builder.add(trimmedRing(detail, NECKLACE_RADIUS, 0.008, 14), {
    style: { ...FLEXIBLE_TORSO_STYLE, slot: MaterialSlot.Rope },
    transform: NECKLACE_CORD,
  });

  if (!detail.hasFineDetails) {
    return;
  }

  for (const offset of TOOTH_ANGLES) {
    const angle = Math.PI / 2 + offset;

    const knot = new Vector3(Math.cos(angle) * NECKLACE_RADIUS, 0, Math.sin(angle) * NECKLACE_RADIUS).applyMatrix4(
      NECKLACE_CORD
    );

    builder.add(cone(0.011, 0.04, 5), {
      style,
      transform: transformOf({ position: [knot.x, knot.y - 0.004, knot.z + 0.005], rotation: [Math.PI + 0.25, 0, 0] }),
    });
  }
}

export function addPaint(builder: MeshBuilder, detail: HumanDetail): void {
  if (!detail.hasSmallParts) {
    return;
  }

  const style = { ...rigidStyle(HumanBone.Head), slot: MaterialSlot.Accent };
  const head = headShape(detail);

  forEachSide((_side, mirror) => {
    for (const offset of [0, 0.014]) {
      const stroke = headStroke(
        head,
        [
          [0.044, 1.601 - offset, 0.09],
          [0.058, 1.597 - offset, 0.08],
          [0.072, 1.592 - offset, 0.07],
        ],
        0.0035,
        -0.0008
      );

      builder.add(tube(stroke, { radialSegments: detail.hasFineDetails ? 4 : 3 }), { style, transform: mirror });
    }
  });
}

export function addArmband(builder: MeshBuilder, detail: HumanDetail): void {
  builder.add(trimmedRing(detail, 0.06, 0.009, 12), {
    style: { ...armStyle(1), slot: MaterialSlot.Accent },
    transform: transformOf({ position: [0.202, 1.29, -0.004], rotation: [0, 0, -0.05] }),
  });
}

export function addAxe(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = RIGHT_FIST;

  addRod(
    builder,
    detail,
    { end: [x, y, z + 0.5], radius: 0.017, start: [x, y, z - 0.09] },
    inRightHand(MaterialSlot.Wood)
  );
  builder.add(box(0.034, 0.13, 0.085), {
    style: inRightHand(MaterialSlot.Metal),
    transform: transformOf({ position: [x, y - 0.04, z + 0.46], rotation: [0.12, 0, 0] }),
  });
  builder.add(trimmedRing(detail, 0.022, 0.007, 8), {
    style: inRightHand(MaterialSlot.Rope),
    transform: transformOf({ position: [x, y, z + 0.44], rotation: [Math.PI / 2, 0, 0] }),
  });
}

export function addSpear(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = RIGHT_FIST;

  addRod(
    builder,
    detail,
    { end: [x, y, z + 1.12], radius: 0.014, start: [x, y, z - 0.62] },
    inRightHand(MaterialSlot.Wood)
  );
  builder.add(cone(0.026, 0.13, trimSegments(detail, 5)), {
    style: inRightHand(MaterialSlot.Metal),
    transform: transformOf({ position: [x, y, z + 1.11], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.55] }),
  });
  builder.add(trimmedRing(detail, 0.018, 0.006, 8), {
    style: inRightHand(MaterialSlot.Rope),
    transform: transformOf({ position: [x, y, z + 1.1], rotation: [Math.PI / 2, 0, 0] }),
  });
}

export function addDiggingStick(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = RIGHT_FIST;

  addRod(
    builder,
    detail,
    { end: [x, y - 0.62, z + 0.02], radius: 0.018, start: [x, y + 0.22, z] },
    inRightHand(MaterialSlot.Wood)
  );
  builder.add(cone(0.018, 0.09, trimSegments(detail, 6)), {
    style: inRightHand(MaterialSlot.Metal),
    transform: transformOf({ position: [x, y - 0.62, z + 0.02], rotation: [Math.PI, 0, 0] }),
  });
}

export function addHammerStone(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = RIGHT_FIST;

  builder.add(lump(detail, [3, 1, 2], 0.05, 0.2), {
    style: inRightHand(MaterialSlot.Stone),
    transform: transformOf({ position: [x, y - 0.02, z + 0.06], scale: [0.9, 1, 1.15] }),
  });
}

function basketShape(detail: HumanDetail): Shape {
  return lathe(
    [
      { radius: 0, y: 0 },
      { radius: 0.07, y: 0.004 },
      { radius: 0.095, y: 0.05 },
      { radius: 0.105, y: 0.11 },
      { radius: 0.098, y: 0.124 },
      { radius: 0.086, y: 0.118 },
      { radius: 0.08, y: 0.06 },
      { radius: 0, y: 0.05 },
    ],
    detail.limbSegments + 3
  );
}

function addBasket(builder: MeshBuilder, detail: HumanDetail, hasBerries: boolean): void {
  const [x, y, z] = LEFT_FIST;

  const basketBottom = y - 0.27;

  builder.add(basketShape(detail), {
    style: inLeftHand(MaterialSlot.Thatch),
    transform: transformOf({ position: [x, basketBottom, z] }),
  });
  builder.add(trimmedRing(detail, 0.095, 0.007, 14), {
    style: inLeftHand(MaterialSlot.Wood),
    transform: transformOf({
      position: [x, basketBottom + 0.12, z],
      rotation: [0, 0, Math.PI / 2],
      scale: [1.4, 1, 1],
    }),
  });

  if (!(hasBerries && detail.hasSmallParts)) {
    return;
  }

  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * FULL_TURN;
    const distance = index % 3 === 0 ? 0.02 : 0.055;

    builder.add(sphere(0.022, 6, 4), {
      style: inLeftHand(MaterialSlot.Berry),
      transform: transformOf({
        position: [
          x + Math.cos(angle) * distance,
          basketBottom + 0.112 + (index % 2) * 0.012,
          z + Math.sin(angle) * distance,
        ],
      }),
    });
  }
}

export function addToolBasket(builder: MeshBuilder, detail: HumanDetail): void {
  addBasket(builder, detail, false);
}

export function addCarriedBerries(builder: MeshBuilder, detail: HumanDetail): void {
  addBasket(builder, detail, true);
}

export function addCarriedWood(builder: MeshBuilder, detail: HumanDetail): void {
  const logs: readonly Triple[] = [
    [-0.165, 1.505, 0.0],
    [-0.21, 1.53, 0.012],
    [-0.125, 1.535, -0.01],
  ];

  for (const [index, [x, y, z]] of logs.entries()) {
    const length = 0.86 - index * 0.08;

    builder.add(
      cylinder({
        height: length,
        radialSegments: Math.max(6, detail.limbSegments - 1),
        radiusBottom: 0.045,
        radiusTop: 0.042,
      }),
      {
        style: onChest(MaterialSlot.Bark),
        transform: transformOf({ position: [x, y, z - length / 2 + index * 0.03], rotation: [Math.PI / 2, 0, 0] }),
      }
    );
  }
}

export function addCarriedStone(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = CRADLE;

  builder.add(lump(detail, [7, 2, 1], 0.13, 0.25), {
    style: onChest(MaterialSlot.Stone),
    transform: transformOf({ position: [x, y - 0.04, z], scale: [1.3, 0.9, 1] }),
  });
}

export function addCarriedMeat(builder: MeshBuilder, detail: HumanDetail): void {
  const knuckle: Triple = [0.17, 1.52, 0.12];

  builder.add(lump(detail, [1, 5, 3], 0.1, 0.18), {
    style: onChest(MaterialSlot.Meat),
    transform: transformOf({ position: [0.16, 1.535, 0.0], scale: [0.9, 0.8, 1.7] }),
  });
  builder.add(
    cylinder({
      height: segmentLength(knuckle, SHOULDER_GRIP),
      radialSegments: trimSegments(detail, 5),
      radiusBottom: 0.016,
      radiusTop: 0.012,
    }),
    { style: onChest(MaterialSlot.Bone), transform: segmentTransform(knuckle, SHOULDER_GRIP) }
  );
}

export function addCarriedFish(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = RIGHT_FIST;

  const style = inRightHand(MaterialSlot.Fish);
  const segments = segmentsAtLeast(detail, 6, detail.limbSegments);

  builder.add(
    loft(
      [
        { radiusX: 0, radiusZ: 0, y: -0.38 },
        { radiusX: 0.012, radiusZ: 0.03, y: -0.36 },
        { radiusX: 0.026, radiusZ: 0.06, y: -0.22 },
        { radiusX: 0.02, radiusZ: 0.045, y: -0.1 },
        { radiusX: 0.008, radiusZ: 0.016, y: -0.04 },
        { radiusX: 0, radiusZ: 0, y: -0.03 },
      ],
      segments
    ),
    { style, transform: transformOf({ position: [x, y, z + 0.02] }) }
  );
  builder.add(
    loft(
      [
        { radiusX: 0, radiusZ: 0, y: -0.432 },
        { radiusX: 0.004, radiusZ: 0.042, y: -0.425 },
        { radiusX: 0.007, radiusZ: 0.014, y: -0.37 },
        { radiusX: 0, radiusZ: 0, y: -0.345 },
      ],
      segments
    ),
    { style, transform: transformOf({ position: [x, y, z + 0.02] }) }
  );
}

export function addCarriedCrops(builder: MeshBuilder, detail: HumanDetail): void {
  const [x, y, z] = CRADLE;

  const style = onChest(MaterialSlot.Grain);
  const start: Triple = [x + 0.3, y, z];
  const end: Triple = [x - 0.34, y + 0.02, z];

  for (let index = 0; index < 7; index += 1) {
    const spread = (index - 3) * 0.012;
    const layer = (index % 2) * 0.012;

    builder.add(
      tube(
        [
          { radius: 0.006, x: start[0], y: start[1] + layer, z: start[2] + spread },
          { radius: 0.006, x: end[0], y: end[1] + layer * 2, z: end[2] + spread * 2 },
        ],
        { radialSegments: 4 }
      ),
      { style }
    );
  }

  builder.add(lump(detail, [2, 9, 4], 0.06, 0.3), {
    style,
    transform: transformOf({ position: end, scale: [1.5, 0.8, 1] }),
  });
  builder.add(trimmedRing(detail, 0.035, 0.008, 8), {
    style: onChest(MaterialSlot.Rope),
    transform: transformOf({ position: [x - 0.02, y + 0.012, z], rotation: [0, 0, Math.PI / 2] }),
  });
}
