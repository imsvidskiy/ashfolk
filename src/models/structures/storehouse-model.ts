import { MaterialSlot } from "../materials.ts";
import { facetShape, type Shape } from "../mesh/shape.ts";
import { box, card, lathe, lengthwiseLoft } from "../mesh/shapes.ts";
import { transformOf } from "../mesh/transforms.ts";
import { addFlagCloth, addTaperedLog } from "./camp-building-parts.ts";
import { detail, rising, type StructureContext, upwardShade } from "./structure-parts.ts";

const STORE_WALL_TOP = 2.25;
const STORE_HALF_WIDTH = 1.1;
const STORE_HALF_DEPTH = 0.9;
const GABLE_RISE = 0.74;
const RIDGE_HEIGHT = 3.11;
const GABLE_INSET = 0.004;

const SUPPORT_POSTS: readonly (readonly [x: number, z: number])[] = [
  [-1.1, -0.9],
  [1.1, -0.9],
  [-1.1, 0.9],
  [1.1, 0.9],
];

const STORAGE_JARS: readonly (readonly [x: number, z: number, height: number])[] = [
  [1.6, 0.6, 0.55],
  [1.75, 0.05, 0.45],
];

function gableShape(): Shape {
  const depth = STORE_HALF_DEPTH - GABLE_INSET;
  const end = { centerY: STORE_WALL_TOP, halfHeight: GABLE_RISE, halfWidth: STORE_HALF_WIDTH - GABLE_INSET };

  return facetShape(
    lengthwiseLoft(
      [
        { centerY: STORE_WALL_TOP, halfHeight: 0, halfWidth: 0, z: -depth },
        { ...end, z: -depth },
        { ...end, z: depth },
        { centerY: STORE_WALL_TOP, halfHeight: 0, halfWidth: 0, z: depth },
      ],
      4
    )
  );
}

function addStorehouseBody(context: StructureContext): void {
  const { builder } = context;

  for (const [x, z] of SUPPORT_POSTS) {
    addTaperedLog(context, [x, 0, z], [x, 1, z], 0.09, 0.1);
  }

  builder.add(box(2.6, 0.16, 2.2), {
    style: { buildOrder: 0.35, slot: MaterialSlot.Wood },
    transform: transformOf({ position: [0, 1.06, 0] }),
  });
  builder.add(box(2.2, 1.1, 1.8), {
    style: {
      buildOrder: rising(0.4, 0.7, 1.1, 2.2),
      shade: upwardShade(0.75, 1.1, 2.2),
      slot: MaterialSlot.Daub,
    },
    transform: transformOf({ position: [0, 1.7, 0] }),
  });
  builder.add(gableShape(), { style: { buildOrder: 0.72, shade: 0.97, slot: MaterialSlot.Daub } });
}

function addStorehouseRoof(context: StructureContext): void {
  for (const side of [-1, 1]) {
    context.builder.add(box(1.75, 0.12, 2.7), {
      style: { buildOrder: 0.85, shade: 0.92, slot: MaterialSlot.Thatch },
      transform: transformOf({ position: [side * 0.68, 2.62, 0], rotation: [0, 0, -side * 0.6] }),
    });
  }

  addTaperedLog(context, [0, RIDGE_HEIGHT, -1.38], [0, RIDGE_HEIGHT, 1.38], 0.075, 0.88);
}

function addStorehouseLadder(context: StructureContext): void {
  context.builder.add(card(0.7, 0.9), {
    style: { buildOrder: 0.6, slot: MaterialSlot.Ash },
    transform: transformOf({ position: [0, 1.15, 0.91] }),
  });

  for (const offset of [-0.25, 0.25]) {
    addTaperedLog(context, [offset, 0, 1.75], [offset, 1.15, 1], 0.03, 0.5);
  }

  for (let rung = 1; rung < 4; rung += 1) {
    const amount = rung / 4;

    const y = 1.15 * amount;
    const z = 1.75 - 0.75 * amount;

    addTaperedLog(context, [-0.25, y, z], [0.25, y, z], 0.022, 0.5);
  }
}

function addStorehouseJars(context: StructureContext): void {
  for (const [x, z, height] of STORAGE_JARS) {
    context.builder.add(
      lathe(
        [
          { radius: 0, y: 0 },
          { radius: 0.2, y: 0.02 },
          { radius: 0.27, y: height * 0.45 },
          { radius: 0.16, y: height * 0.92 },
          { radius: 0.18, y: height },
          { radius: 0, y: height * 0.9 },
        ],
        detail(context, 10, 6)
      ),
      { style: { buildOrder: 0.9, slot: MaterialSlot.Daub }, transform: transformOf({ position: [x, 0, z] }) }
    );
  }
}

export function addStorehouse(context: StructureContext): void {
  addStorehouseBody(context);
  addStorehouseRoof(context);
  addStorehouseLadder(context);
  addStorehouseJars(context);
  addFlagCloth(context, [0, 0, 1.2], { bottom: 3.55, height: 0.4, turn: 0, width: 0.6 });
  addTaperedLog(context, [0, 3, 1.2], [0, 4, 1.2], 0.025, 0.99);
}
