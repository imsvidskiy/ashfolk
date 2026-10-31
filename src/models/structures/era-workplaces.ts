import { FULL_TURN, lerp } from "../../shared/math.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { SurfacePoint } from "../mesh/mesh-builder.ts";
import { card, cylinder, lathe, loft } from "../mesh/shapes.ts";
import { type Triple, transformOf } from "../mesh/transforms.ts";
import { tube } from "../mesh/tubes.ts";
import {
  addBlock,
  addFlag,
  addJar,
  addLog,
  addLogPile,
  addMound,
  addPitchedRoof,
  addRock,
  addSlab,
  addSpike,
  detail,
  GLOW_PART,
  isDetailed,
  rising,
  type StructureContext,
  stoneShade,
  thatchSections,
  upwardShade,
} from "./structure-parts.ts";

const GLOWING_EMBERS = { part: GLOW_PART, slot: MaterialSlot.Ember } as const;
const GRANARY_STILT_RING = 1.2;
const GRANARY_STILT_HEIGHT = 0.5;
const GRANARY_CAP_HEIGHT = 0.09;
const GRANARY_FLOOR_HEIGHT = 0.16;
const GRANARY_FLOOR_RADIUS = 1.7;
const GRANARY_WALL_RADIUS = 1.5;
const GRANARY_WALL_TOP = 2.15;
const GRANARY_ROOF_BOTTOM = 2;
const GRANARY_ROOF_TOP = 3.9;
const GRANARY_ROOF_RADIUS = 2;
const GRANARY_BAND_BOTTOM = 1.66;
const GRANARY_BAND_TOP = 1.8;
const GRANARY_WALL_TAPER = 0.04;
const FLOOR_BOTTOM = GRANARY_STILT_HEIGHT + GRANARY_CAP_HEIGHT;
const FLOOR_TOP = FLOOR_BOTTOM + GRANARY_FLOOR_HEIGHT;
const KILN_TOP = 2.3;
const SHED_HALF_WIDTH = 1.95;
const SHED_HALF_DEPTH = 1.35;
const SHED_BACK_HEIGHT = 2.1;
const SHED_FRONT_HEIGHT = 2.6;
const SHED_ROOF_THICKNESS = 0.22;
const SHAFT_BASE = 0.4;
const SHAFT_TOP = 2.1;
const FORGE_HALF_WIDTH = 1.85;
const FORGE_HALF_DEPTH = 1.45;
const FORGE_POST_HEIGHT = 2.55;
const FORGE_EAVE = 2.4;
const FORGE_RIDGE = 3.4;

function radiusOf(point: SurfacePoint): number {
  return Math.hypot(point.position.x, point.position.z);
}

function addDrum(
  context: StructureContext,
  position: Triple,
  radius: number,
  height: number,
  slot: MaterialSlotIndex,
  order: number
): void {
  context.builder.add(
    cylinder({ height, radialSegments: detail(context, 9, 5), radiusBottom: radius, radiusTop: radius * 0.94 }),
    { style: { buildOrder: order, slot }, transform: transformOf({ position }) }
  );
}

function granaryWallRadius(height: number): number {
  const bottom = FLOOR_TOP - 0.01;

  return GRANARY_WALL_RADIUS - (GRANARY_WALL_TAPER * (height - bottom)) / (GRANARY_WALL_TOP - bottom);
}

function addGranaryStilts(context: StructureContext): void {
  const stilts = detail(context, 6, 4);
  const sides = detail(context, 8, 5);

  const spots: [number, number][] = [[0, 0]];

  for (let stilt = 0; stilt < stilts; stilt += 1) {
    const angle = (stilt / stilts) * FULL_TURN + 0.3;

    spots.push([Math.cos(angle) * GRANARY_STILT_RING, Math.sin(angle) * GRANARY_STILT_RING]);
  }

  for (const [index, [x, z]] of spots.entries()) {
    const order = 0.03 + (index / spots.length) * 0.1;

    context.builder.add(
      cylinder({ height: GRANARY_STILT_HEIGHT, radialSegments: sides, radiusBottom: 0.15, radiusTop: 0.1 }),
      { style: { buildOrder: order, slot: MaterialSlot.Stone }, transform: transformOf({ position: [x, 0, z] }) }
    );
    context.builder.add(
      cylinder({ height: GRANARY_CAP_HEIGHT, radialSegments: sides, radiusBottom: 0.27, radiusTop: 0.25 }),
      {
        style: { buildOrder: order + 0.02, slot: MaterialSlot.PaleStone },
        transform: transformOf({ position: [x, GRANARY_STILT_HEIGHT, z] }),
      }
    );
  }
}

function granarySegments(context: StructureContext): number {
  return detail(context, 16, 8);
}

function addGranaryStore(context: StructureContext): void {
  const segments = granarySegments(context);

  context.builder.add(
    cylinder({
      height: GRANARY_FLOOR_HEIGHT,
      radialSegments: segments,
      radiusBottom: GRANARY_FLOOR_RADIUS,
      radiusTop: GRANARY_FLOOR_RADIUS,
    }),
    { style: { buildOrder: 0.2, slot: MaterialSlot.Wood }, transform: transformOf({ position: [0, FLOOR_BOTTOM, 0] }) }
  );

  context.builder.add(
    loft(
      [
        { radiusX: 0, radiusZ: 0, y: FLOOR_TOP - 0.01 },
        { radiusX: GRANARY_WALL_RADIUS, radiusZ: GRANARY_WALL_RADIUS, y: FLOOR_TOP - 0.01 },
        {
          radiusX: GRANARY_WALL_RADIUS - GRANARY_WALL_TAPER,
          radiusZ: GRANARY_WALL_RADIUS - GRANARY_WALL_TAPER,
          y: GRANARY_WALL_TOP,
        },
        { radiusX: 0, radiusZ: 0, y: GRANARY_WALL_TOP },
      ],
      segments
    ),
    {
      style: {
        buildOrder: rising(0.28, 0.58, FLOOR_TOP, GRANARY_WALL_TOP),
        shade: upwardShade(0.72, FLOOR_TOP, GRANARY_WALL_TOP),
        slot: MaterialSlot.Daub,
      },
    }
  );

  context.builder.add(
    cylinder({
      height: GRANARY_BAND_TOP - GRANARY_BAND_BOTTOM,
      radialSegments: segments,
      radiusBottom: granaryWallRadius(GRANARY_BAND_BOTTOM) + 0.006,
      radiusTop: granaryWallRadius(GRANARY_BAND_TOP) + 0.006,
    }),
    {
      style: { buildOrder: 0.62, slot: MaterialSlot.Accent },
      transform: transformOf({ position: [0, GRANARY_BAND_BOTTOM, 0] }),
    }
  );

  addBlock(context, [0.62, 0.85, 0.12], [0, FLOOR_TOP + 0.43, GRANARY_WALL_RADIUS - 0.03], {
    buildOrder: 0.55,
    slot: MaterialSlot.Ash,
  });
}

function addGranaryRoof(context: StructureContext): void {
  const thatch = thatchSections(GRANARY_ROOF_BOTTOM, GRANARY_ROOF_TOP, GRANARY_ROOF_RADIUS, () => {
    return 1;
  });

  context.builder.add(loft(thatch, granarySegments(context)), {
    style: {
      buildOrder: rising(0.68, 0.92, GRANARY_ROOF_BOTTOM, GRANARY_ROOF_TOP),
      shade: upwardShade(0.72, GRANARY_ROOF_BOTTOM, GRANARY_ROOF_TOP),
      slot: MaterialSlot.Thatch,
    },
  });

  addLog(context, [0, GRANARY_ROOF_TOP - 0.1, 0], [0, GRANARY_ROOF_TOP + 0.35, 0], 0.05, {
    buildOrder: 0.96,
    slot: MaterialSlot.Wood,
  });
}

function addGranaryLadder(context: StructureContext): void {
  const foot = 2.25;
  const top = 1.62;

  for (const side of [-1, 1]) {
    addLog(context, [side * 0.24, 0, foot], [side * 0.24, FLOOR_TOP - 0.03, top], 0.035, {
      buildOrder: 0.4,
      slot: MaterialSlot.Wood,
    });
  }

  for (let rung = 1; rung <= 2; rung += 1) {
    const amount = rung / 3;

    const y = (FLOOR_TOP - 0.03) * amount;
    const z = foot + (top - foot) * amount;

    addLog(context, [-0.26, y, z], [0.26, y, z], 0.025, { buildOrder: 0.42, slot: MaterialSlot.Wood });
  }
}

export function addGranary(context: StructureContext): void {
  addGranaryStilts(context);
  addGranaryStore(context);
  addGranaryRoof(context);
  addGranaryLadder(context);

  for (const [x, z, height] of [
    [2.05, 0.9, 0.7],
    [2.35, 0.25, 0.55],
    [2, -0.4, 0.62],
  ] as const) {
    addJar(context, [x, 0, z], height, { buildOrder: 0.98, slot: MaterialSlot.Clay });
  }
}

function kilnDomeSlot(point: SurfacePoint): MaterialSlotIndex {
  return point.position.y > KILN_TOP - 0.06 && radiusOf(point) < 0.22 ? MaterialSlot.Ash : MaterialSlot.Clay;
}

function addKilnDome(context: StructureContext): void {
  context.builder.add(
    lathe(
      [
        { radius: 0, y: 0 },
        { radius: 1.2, y: 0 },
        { radius: 1.27, y: 0.4 },
        { radius: 1.18, y: 0.95 },
        { radius: 0.95, y: 1.4 },
        { radius: 0.58, y: 1.8 },
        { radius: 0.3, y: 2 },
        { radius: 0.25, y: 2.08 },
        { radius: 0.25, y: KILN_TOP },
        { radius: 0.2, y: KILN_TOP },
        { radius: 0, y: KILN_TOP - 0.05 },
      ],
      detail(context, 16, 8)
    ),
    {
      style: {
        buildOrder: rising(0.12, 0.8, 0, KILN_TOP),
        shade: upwardShade(0.72, 0, 1.6),
        slot: kilnDomeSlot,
      },
    }
  );

  context.builder.add(
    cylinder({ height: 0.12, radialSegments: detail(context, 16, 8), radiusBottom: 1.172, radiusTop: 1.13 }),
    { style: { buildOrder: 0.82, slot: MaterialSlot.Accent }, transform: transformOf({ position: [0, 0.98, 0] }) }
  );

  const stones = detail(context, 9, 6);

  for (let stone = 0; stone < stones; stone += 1) {
    const angle = (stone / stones) * FULL_TURN + Math.PI / 2 + 0.35;

    addRock(context, [Math.cos(angle) * 1.22, 0.12, Math.sin(angle) * 1.22], 0.2, [1, 0.6, 1], {
      buildOrder: 0.05,
      shade: 0.85,
      slot: MaterialSlot.Stone,
    });
  }
}

function addKilnMouth(context: StructureContext): void {
  addBlock(context, [0.62, 0.58, 0.6], [0, 0.29, 1.17], { buildOrder: 0.3, slot: MaterialSlot.Ash });
  addBlock(context, [0.95, 0.18, 0.62], [0, 0.66, 1.18], { buildOrder: 0.36, slot: MaterialSlot.Clay });
  addRock(context, [0, 0.1, 1.38], 0.2, [1.3, 0.45, 0.8], { ...GLOWING_EMBERS, buildOrder: 0.9 });
}

export function addKiln(context: StructureContext): void {
  addKilnDome(context);
  addKilnMouth(context);
  addLogPile(context, [1.62, 0, -0.85], Math.PI / 2, 1.4, 0.7);

  for (const [x, z, height] of [
    [-1.48, 0.78, 0.45],
    [-1.72, 0.22, 0.38],
    [-1.4, -0.36, 0.5],
  ] as const) {
    addJar(context, [x, 0, z], height, { buildOrder: 0.95, slot: MaterialSlot.Clay });
  }
}

function addShedFrame(context: StructureContext): void {
  for (const x of [-SHED_HALF_WIDTH, SHED_HALF_WIDTH]) {
    addLog(context, [x, 0, SHED_HALF_DEPTH], [x, SHED_FRONT_HEIGHT, SHED_HALF_DEPTH], 0.09, {
      buildOrder: 0.15,
      slot: MaterialSlot.Wood,
    });
    addLog(context, [x, 0, -SHED_HALF_DEPTH], [x, SHED_BACK_HEIGHT, -SHED_HALF_DEPTH], 0.09, {
      buildOrder: 0.15,
      slot: MaterialSlot.Wood,
    });
  }

  addSlab(
    context,
    {
      from: [SHED_BACK_HEIGHT - 0.06, -SHED_HALF_DEPTH],
      overhang: 0.4,
      thickness: SHED_ROOF_THICKNESS,
      to: [SHED_FRONT_HEIGHT - 0.06, SHED_HALF_DEPTH],
      width: SHED_HALF_WIDTH * 2 + 0.5,
    },
    {
      buildOrder: rising(0.62, 0.82, SHED_BACK_HEIGHT - 0.2, SHED_FRONT_HEIGHT + 0.2),
      shade: 0.9,
      slot: MaterialSlot.Thatch,
    }
  );
}

function addWorkbench(context: StructureContext): void {
  const top = 0.86;
  const middleX = -0.2;
  const middleZ = -0.55;

  addBlock(context, [1.8, 0.09, 0.6], [middleX, top, middleZ], { buildOrder: 0.5, slot: MaterialSlot.Wood });

  for (const [x, z] of [
    [-0.8, 0.25],
    [0.8, 0.25],
    [-0.8, -0.25],
    [0.8, -0.25],
  ] as const) {
    addLog(context, [middleX + x, 0, middleZ + z], [middleX + x, top, middleZ + z], 0.04, {
      buildOrder: 0.45,
      slot: MaterialSlot.Wood,
    });
  }

  const surface = top + 0.045;

  addLog(context, [-0.95, surface + 0.012, -0.38], [-0.62, surface + 0.012, -0.44], 0.02, {
    buildOrder: 0.9,
    slot: MaterialSlot.Wood,
  });
  addBlock(context, [0.08, 0.07, 0.15], [-0.6, surface + 0.03, -0.44], { buildOrder: 0.9, slot: MaterialSlot.Metal });
  addBlock(context, [0.3, 0.06, 0.12], [0.35, surface + 0.025, -0.7], { buildOrder: 0.9, slot: MaterialSlot.Metal });
  addBlock(context, [0.26, 0.06, 0.1], [0.38, surface + 0.07, -0.68], { buildOrder: 0.91, slot: MaterialSlot.Metal });

  const bowTips: [Triple, Triple] = [
    [-0.85, surface + 0.018, -0.75],
    [0.45, surface + 0.018, -0.75],
  ];

  const bowPoints = detail(context, 7, 4);

  const bow = Array.from({ length: bowPoints }, (_, index) => {
    const amount = index / (bowPoints - 1);

    const x = lerp(bowTips[0][0], bowTips[1][0], amount);
    const bend = Math.sin(amount * Math.PI) * 0.22;

    return { radius: 0.022, x, y: surface + 0.018, z: bowTips[0][2] + bend };
  });

  context.builder.add(tube(bow, { radialSegments: detail(context, 5, 3) }), {
    style: { buildOrder: 0.92, slot: MaterialSlot.Wood },
  });
  context.builder.add(
    tube(
      bowTips.map(([x, y, z]) => {
        return { radius: 0.006, x, y, z };
      }),
      { radialSegments: 3 }
    ),
    { style: { buildOrder: 0.92, slot: MaterialSlot.Rope } }
  );
}

function addWeaponRack(context: StructureContext): void {
  const x = -SHED_HALF_WIDTH;
  const railHeight = 1.35;

  addLog(context, [x, railHeight, SHED_HALF_DEPTH], [x, railHeight, -SHED_HALF_DEPTH], 0.05, {
    buildOrder: 0.7,
    slot: MaterialSlot.Wood,
  });

  for (const z of [0.1, 0.38, 0.66]) {
    const top: Triple = [x - 0.03, 1.66, z];

    addLog(context, [x + 0.36, 0, z], top, 0.025, { buildOrder: 0.85, slot: MaterialSlot.Wood });
    addSpike(context, top, [x - 0.07, 1.92, z], 0.045, { buildOrder: 0.86, slot: MaterialSlot.Metal });
  }
}

function addAnvilStone(context: StructureContext, x: number, z: number, order: number): void {
  addDrum(context, [x, 0, z], 0.26, 0.54, MaterialSlot.Wood, order);
  addBlock(context, [0.46, 0.18, 0.2], [x, 0.62, z], { buildOrder: order + 0.05, slot: MaterialSlot.Metal });
  addSpike(context, [x + 0.2, 0.63, z], [x + 0.42, 0.66, z], 0.07, {
    buildOrder: order + 0.05,
    slot: MaterialSlot.Metal,
  });
}

export function addWorkshop(context: StructureContext): void {
  addShedFrame(context);
  addBlock(context, [SHED_HALF_WIDTH * 2 + 0.1, 1.3, 0.14], [0, 0.65, -SHED_HALF_DEPTH], {
    buildOrder: 0.35,
    shade: rising(0.75, 1, 0, 1.3),
    slot: MaterialSlot.Daub,
  });
  addWorkbench(context);
  addWeaponRack(context);
  addAnvilStone(context, 1.15, 0.45, 0.75);
  addBlock(context, [SHED_HALF_WIDTH * 2 + 0.3, 0.42, 0.04], [0, SHED_FRONT_HEIGHT - 0.1, SHED_HALF_DEPTH + 0.3], {
    buildOrder: 0.95,
    slot: MaterialSlot.Accent,
  });

  if (isDetailed(context)) {
    addLogPile(context, [1.25, 0, -0.75], 0, 1.1, 0.6);
  }
}

function shaftSlot(point: SurfacePoint): MaterialSlotIndex {
  return point.position.y > SHAFT_TOP - 0.15 && radiusOf(point) < 0.36 ? MaterialSlot.Ash : MaterialSlot.Clay;
}

function addSmelterShaft(context: StructureContext): void {
  addDrum(context, [0, 0, 0], 0.8, 0.44, MaterialSlot.Stone, 0.06);

  const stones = detail(context, 8, 5);

  for (let stone = 0; stone < stones; stone += 1) {
    const angle = (stone / stones) * FULL_TURN + 0.2;

    addRock(context, [Math.cos(angle) * 0.8, 0.14, Math.sin(angle) * 0.8], 0.18, [1, 0.7, 1], {
      buildOrder: 0.08,
      shade: stoneShade,
      slot: MaterialSlot.Stone,
    });
  }

  context.builder.add(
    lathe(
      [
        { radius: 0, y: SHAFT_BASE },
        { radius: 0.62, y: SHAFT_BASE },
        { radius: 0.6, y: 0.9 },
        { radius: 0.5, y: 1.5 },
        { radius: 0.4, y: 2 },
        { radius: 0.44, y: SHAFT_TOP - 0.02 },
        { radius: 0.34, y: SHAFT_TOP },
        { radius: 0, y: SHAFT_TOP - 0.1 },
      ],
      detail(context, 14, 7)
    ),
    {
      style: {
        buildOrder: rising(0.2, 0.75, SHAFT_BASE, SHAFT_TOP),
        shade: upwardShade(0.7, SHAFT_BASE, SHAFT_TOP),
        slot: shaftSlot,
      },
    }
  );

  addBlock(context, [0.3, 0.28, 0.3], [0, 0.62, 0.55], { buildOrder: 0.4, slot: MaterialSlot.Ash });
  addRock(context, [0, 0.58, 0.7], 0.15, [1, 0.7, 0.6], { ...GLOWING_EMBERS, buildOrder: 0.9 });
  addBlock(context, [0.24, 0.1, 0.62], [0, 0.05, 1.02], { buildOrder: 0.3, slot: MaterialSlot.Clay });
}

function addBellows(context: StructureContext): void {
  for (const side of [-1, 1]) {
    addRock(context, [side * 0.42, 0.17, -0.98], 0.32, [1.1, 0.55, 0.9], {
      buildOrder: 0.5,
      shade: 0.9,
      slot: MaterialSlot.Hide,
    });
    addLog(context, [side * 0.34, 0.26, -0.78], [side * 0.14, 0.55, -0.44], 0.05, {
      buildOrder: 0.55,
      slot: MaterialSlot.Clay,
    });
  }
}

export function addSmelter(context: StructureContext): void {
  addSmelterShaft(context);
  addBellows(context);
  addMound(context, [1.15, 0, 0.55], 0.36, [1.2, 0.55, 1], { buildOrder: 0.65, shade: 0.5, slot: MaterialSlot.Ash });
  addBlock(context, [0.5, 0.12, 0.3], [-1.1, 0.06, 0.7], { buildOrder: 0.6, slot: MaterialSlot.Stone });
  addBlock(context, [0.32, 0.06, 0.14], [-1.1, 0.12, 0.7], { buildOrder: 0.92, slot: MaterialSlot.Metal });
  addFlag(context, [1, 0, -1], 2.6, 0.4, 0.97);
}

function addForgeHearth(context: StructureContext): void {
  addBlock(context, [1.5, 0.85, 1], [0, 0.425, -0.75], {
    buildOrder: 0.1,
    shade: stoneShade,
    slot: MaterialSlot.Stone,
  });
  addRock(context, [0, 0.86, -0.7], 0.32, [1.4, 0.35, 1], { ...GLOWING_EMBERS, buildOrder: 0.9 });
  addBlock(context, [0.75, 3.25, 0.55], [0, 2.43, -1.18], {
    buildOrder: 0.35,
    shade: stoneShade,
    slot: MaterialSlot.Stone,
  });
  addBlock(context, [0.9, 0.14, 0.7], [0, 4.1, -1.18], { buildOrder: 0.96, slot: MaterialSlot.PaleStone });
}

function addQuenchTrough(context: StructureContext): void {
  addBlock(context, [1, 0.45, 0.42], [-1.05, 0.225, 0.5], { buildOrder: 0.55, slot: MaterialSlot.Wood });
  addBlock(context, [0.84, 0.04, 0.3], [-1.05, 0.44, 0.5], { buildOrder: 0.6, shade: 0.6, slot: MaterialSlot.Ash });
}

export function addForge(context: StructureContext): void {
  for (const x of [-FORGE_HALF_WIDTH, FORGE_HALF_WIDTH]) {
    for (const z of [-FORGE_HALF_DEPTH, FORGE_HALF_DEPTH]) {
      addLog(context, [x, 0, z], [x, FORGE_POST_HEIGHT, z], 0.1, { buildOrder: 0.2, slot: MaterialSlot.Wood });
    }
  }

  addPitchedRoof(context, {
    eave: FORGE_EAVE,
    length: FORGE_HALF_WIDTH * 2 + 0.6,
    ridge: FORGE_RIDGE,
    span: (FORGE_HALF_DEPTH + 0.4) * 2,
    style: {
      buildOrder: rising(0.62, 0.86, FORGE_EAVE - 0.2, FORGE_RIDGE),
      shade: upwardShade(0.75, FORGE_EAVE, FORGE_RIDGE),
      slot: MaterialSlot.Thatch,
    },
    thickness: 0.34,
  });

  addForgeHearth(context);
  addAnvilStone(context, 0.55, 0.6, 0.7);
  addLog(context, [0.42, 0.725, 0.66], [0.72, 0.725, 0.74], 0.018, { buildOrder: 0.93, slot: MaterialSlot.Wood });
  addBlock(context, [0.08, 0.06, 0.13], [0.74, 0.735, 0.74], { buildOrder: 0.93, slot: MaterialSlot.Metal });
  addQuenchTrough(context);
  context.builder.add(card(0.5, 0.9), {
    style: { buildOrder: 0.97, slot: MaterialSlot.Accent },
    transform: transformOf({ position: [FORGE_HALF_WIDTH - 0.3, 1.2, FORGE_HALF_DEPTH] }),
  });
}
