import type { MinedDepositKind } from "../../content/deposits.ts";
import { createRandom } from "../../shared/random.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { MeshBuilder } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { facetShape } from "../mesh/shape.ts";
import { card, cylinder } from "../mesh/shapes.ts";
import { transformOf } from "../mesh/transforms.ts";
import { addOreChunk, addOreHeap, addStreakedRock, type OreLook } from "./ore-rock.ts";
import {
  addBlock,
  addLog,
  detail,
  moundShape,
  rising,
  type StructureContext,
  type StructureLevel,
  scaledMesh,
} from "./structure-parts.ts";

export const MINE_SCALE = 1.5;

const MOUND_CENTER = -1.5;
const MOUND_RADIUS = 2.15;
const PORTAL_HALF_WIDTH = 0.72;
const PORTAL_HEIGHT = 2.15;
const PORTAL_FRONT = 0.62;
const LINTEL_HEIGHT = 2.08;
const RAIL_START = 0.55;
const RAIL_END = 2.05;
const CART_Z = 1.5;
const WHEEL_RADIUS = 0.17;

export type MineOre = MinedDepositKind;

const ORE_SLOTS: Readonly<Record<MineOre, MaterialSlotIndex>> = {
  copper: MaterialSlot.CopperOre,
  iron: MaterialSlot.IronOre,
  tin: MaterialSlot.TinOre,
};

const ORE_RICHNESS: Readonly<Record<MineOre, number>> = { copper: 0.13, iron: 0.15, tin: 0.12 };

function oreLook(ore: MineOre, richness: number): OreLook {
  return { ore: ORE_SLOTS[ore], richness };
}

function addHill(context: StructureContext, ore: MineOre): void {
  const mound = moundShape(context, [0, 0, MOUND_CENTER], MOUND_RADIUS, [1.15, 1.3, 0.92]);

  addStreakedRock(context, mound, oreLook(ore, ORE_RICHNESS[ore]), {
    buildOrder: rising(0.05, 0.35, 0, 2.9),
    shade: (point) => {
      return 0.72 + 0.12 * Math.min(1, point.position.y / 2.6);
    },
  });
}

function addPortal(context: StructureContext): void {
  addBlock(context, [1.3, 1.95, 0.5], [0, 0.975, 0.3], { buildOrder: 0.3, slot: MaterialSlot.Ash });

  for (const side of [-1, 1]) {
    addBlock(context, [0.1, 2, 1], [side * (PORTAL_HALF_WIDTH - 0.02), 1, 0.1], {
      buildOrder: 0.4,
      shade: 0.75,
      slot: MaterialSlot.Wood,
    });
  }

  addBlock(context, [1.7, 0.1, 1.1], [0, LINTEL_HEIGHT + 0.1, 0.12], {
    buildOrder: 0.62,
    shade: 0.85,
    slot: MaterialSlot.Wood,
  });

  for (const side of [-1, 1]) {
    const x = side * PORTAL_HALF_WIDTH;

    addLog(context, [x, 0, PORTAL_FRONT], [x, PORTAL_HEIGHT, PORTAL_FRONT], 0.11, {
      buildOrder: 0.45,
      slot: MaterialSlot.Wood,
    });
    addLog(context, [side * 1.25, 0, PORTAL_FRONT + 0.35], [side * 0.78, 1.6, PORTAL_FRONT], 0.08, {
      buildOrder: 0.5,
      slot: MaterialSlot.Wood,
    });
  }

  addLog(
    context,
    [-PORTAL_HALF_WIDTH - 0.26, LINTEL_HEIGHT, PORTAL_FRONT],
    [PORTAL_HALF_WIDTH + 0.26, LINTEL_HEIGHT, PORTAL_FRONT],
    0.12,
    { buildOrder: 0.6, slot: MaterialSlot.Wood }
  );

  context.builder.add(card(0.7, 0.5), {
    style: { buildOrder: 0.97, slot: MaterialSlot.Accent },
    transform: transformOf({ position: [0, LINTEL_HEIGHT + 0.06 - 0.5, PORTAL_FRONT + 0.08] }),
  });
}

function addTrack(context: StructureContext): void {
  const length = RAIL_END - RAIL_START;

  for (const side of [-1, 1]) {
    addBlock(context, [0.08, 0.06, length], [side * 0.3, 0.03, RAIL_START + length / 2], {
      buildOrder: 0.65,
      slot: MaterialSlot.Wood,
    });
  }

  const sleepers = detail(context, 4, 2);

  for (let sleeper = 0; sleeper < sleepers; sleeper += 1) {
    const z = RAIL_START + ((sleeper + 0.5) / sleepers) * length;

    addBlock(context, [0.9, 0.05, 0.14], [0, 0.025, z], { buildOrder: 0.63, shade: 0.8, slot: MaterialSlot.Wood });
  }
}

function addLoad(context: StructureContext, ore: MineOre): void {
  const chunks = detail(context, 4, 2);

  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const x = ((chunk % 2) - 0.5) * 0.36;
    const z = CART_Z + (Math.floor(chunk / 2) - 0.5) * 0.24;

    addOreChunk(
      context,
      { position: [x, 0.7, z], radius: 0.15, squash: [1, 0.75, 1] },
      oreLook(ore, ORE_RICHNESS[ore] * 2.5),
      { buildOrder: 0.9 }
    );
  }
}

function addCart(context: StructureContext, ore: MineOre): void {
  addBlock(context, [0.85, 0.42, 0.62], [0, 0.48, CART_Z], { buildOrder: 0.8, slot: MaterialSlot.Wood });
  addLoad(context, ore);

  for (const side of [-1, 1]) {
    for (const offset of [-0.2, 0.2]) {
      context.builder.add(
        cylinder({
          height: 0.08,
          radialSegments: detail(context, 10, 6),
          radiusBottom: WHEEL_RADIUS,
          radiusTop: WHEEL_RADIUS,
        }),
        {
          style: { buildOrder: 0.78, shade: 0.8, slot: MaterialSlot.Wood },
          transform: transformOf({
            position: [side * 0.39, WHEEL_RADIUS, CART_Z + offset],
            rotation: [0, 0, -side * (Math.PI / 2)],
          }),
        }
      );
    }
  }
}

function addHeaps(context: StructureContext, ore: MineOre): void {
  context.builder.add(facetShape(moundShape(context, [1.95, 0, 1], 0.85, [1.2, 0.6, 1])), {
    style: { buildOrder: 0.7, shade: 0.85, slot: MaterialSlot.PaleStone },
  });
  addOreHeap(context, [-1.7, 0, 1.4], 0.5, oreLook(ore, ORE_RICHNESS[ore] * 2.5));
}

function addMine(context: StructureContext, ore: MineOre): void {
  addHill(context, ore);
  addPortal(context);
  addTrack(context);
  addCart(context, ore);
  addHeaps(context, ore);
}

export function buildMineModel(ore: MineOre, level: StructureLevel): MeshData {
  const builder = new MeshBuilder();

  addMine({ builder, level, random: createRandom(ore.length * 37 + 11) }, ore);

  return scaledMesh(builder.build(), MINE_SCALE);
}
