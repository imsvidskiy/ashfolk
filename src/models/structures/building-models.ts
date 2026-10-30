import { Vector3 } from "three";
import { BUILDING_KINDS, type BuildingKind } from "../../content/buildings.ts";
import { clamp, FULL_TURN, fractionalPart, lerp, saturate, smoothstep } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { MeshBuilder, type SurfacePoint } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { facetShape, type Shape } from "../mesh/shape.ts";
import {
  blob,
  box,
  card,
  cone,
  cylinder,
  disc,
  type LoftSection,
  lathe,
  lengthwiseLoft,
  loft,
  panel,
} from "../mesh/shapes.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { segmentLength, segmentTransform, type Triple, transformOf } from "../mesh/transforms.ts";
import { addLonghouse, addStoneHouse } from "./era-dwellings.ts";
import { addForge, addGranary, addKiln, addSmelter, addWorkshop } from "./era-workplaces.ts";
import {
  detail,
  GLOW_PART,
  isDetailed,
  rising,
  type StructureContext,
  type StructureLevel,
  scaledMesh,
  thatchSections,
} from "./structure-parts.ts";

export const SINGLE_MODEL_KINDS: readonly SingleModelKind[] = BUILDING_KINDS.filter(hasSingleModel);

const STRUCTURE_NOISE = createVolumeNoise(createRandom(3131));
const TENT_HEIGHT = 2.9;
const TENT_BASE_RADIUS = 1.62;
const TENT_TOP_RADIUS = 0.04;
const TENT_POLE_LIFT = 0.02;
const TENT_POLE_OVERHANG = 0.6;
const TENT_DOOR_ANGLE = Math.PI / 2;
const TENT_DOOR_HALF_ANGLE = 0.27;
const TENT_DOOR_HEIGHT = 1.1;
const TENT_DOOR_LIFT = 0.005;
const TENT_DOOR_THICKNESS = 0.03;
const HUT_RADIUS = 2.4;
const HUT_SILL = 0.5;
const HUT_DOOR_TOP = 1.5;
const HUT_DOOR_HALF_WIDTH = 0.47;
const HUT_POST_RADIUS = 0.06;
const HUT_POST_SINK = 0.035;
const STORE_WALL_TOP = 2.25;
const STORE_HALF_WIDTH = 1.1;
const STORE_HALF_DEPTH = 0.9;
const GABLE_RISE = 0.74;
const RIDGE_HEIGHT = 3.11;
const GABLE_INSET = 0.004;
const TOTEM_HEADS = 3;
const TOTEM_HEAD_HEIGHT = 1.05;
const TOTEM_BASE = 0.15;
const TOTEM_NOSE_LENGTH = 0.26;
const TOTEM_NOSE_DEPTH = 0.04;
const TOTEM_NOSE_TILT = 0.25;
const TOTEM_WAIST = 0.94;
const TOTEM_TOP = TOTEM_BASE + TOTEM_HEADS * TOTEM_HEAD_HEIGHT;

const BUILDING_SCALES: Readonly<Partial<Record<SingleModelKind, number>>> = {
  campfire: 1.15,
  hut: 1.4,
  storehouse: 1.25,
  tent: 1.55,
  totem: 1.2,
};

const BUILDERS: Readonly<Record<SingleModelKind, (context: StructureContext) => void>> = {
  campfire: addCampfire,
  forge: addForge,
  granary: addGranary,
  hut: addHut,
  kiln: addKiln,
  longhouse: addLonghouse,
  smelter: addSmelter,
  stoneHouse: addStoneHouse,
  storehouse: addStorehouse,
  tent: addTent,
  totem: addTotem,
  workshop: addWorkshop,
};

export type SingleModelKind = Exclude<BuildingKind, "mine" | "palisade" | "stoneWall">;

interface Flag {
  readonly bottom: number;
  readonly height: number;
  readonly turn: number;
  readonly width: number;
}

function addLog(context: StructureContext, start: Triple, end: Triple, radius: number, order: number): void {
  const sides = detail(context, 6, 4);

  context.builder.add(
    cylinder({
      height: segmentLength(start, end),
      radialSegments: sides,
      radiusBottom: radius,
      radiusTop: radius * 0.85,
    }),
    {
      style: { buildOrder: order, slot: MaterialSlot.Wood },
      transform: segmentTransform(start, end),
    }
  );
}

function addFlag(context: StructureContext, pole: Triple, flag: Flag): void {
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

function addStone(context: StructureContext, position: Triple, radius: number, order: number): void {
  const [x, y, z] = position;

  context.builder.add(
    blob({
      detail: detail(context, 1, 0),
      noise: STRUCTURE_NOISE,
      offset: [x * 3.1, y * 2.3, z * 2.7],
      radius,
      roughness: 0.3,
    }),
    {
      style: { buildOrder: order, shade: 0.85, slot: MaterialSlot.Stone },
      transform: transformOf({ position, scale: [1, 0.7, 1] }),
    }
  );
}

function addCampfire(context: StructureContext): void {
  const { builder, random } = context;

  const stones = detail(context, 10, 6);

  for (let stone = 0; stone < stones; stone += 1) {
    const angle = (stone / stones) * FULL_TURN + random.signed() * 0.15;

    addStone(
      context,
      [Math.cos(angle) * 0.62, 0.08, Math.sin(angle) * 0.62],
      random.between(0.13, 0.18),
      stone / stones / 3
    );
  }

  builder.add(disc(0.5, 10), {
    style: { buildOrder: 0.3, slot: MaterialSlot.Ash },
    transform: transformOf({ position: [0, 0.02, 0] }),
  });

  const logs = 5;

  for (let log = 0; log < logs; log += 1) {
    const angle = (log / logs) * FULL_TURN + random.signed() * 0.2;

    addLog(
      context,
      [Math.cos(angle) * 0.48, 0.04, Math.sin(angle) * 0.48],
      [Math.cos(angle) * 0.06, 0.62, Math.sin(angle) * 0.06],
      0.055,
      0.4 + (log / logs) * 0.6
    );
  }

  builder.add(blob({ detail: 0, noise: STRUCTURE_NOISE, offset: [1, 1, 1], radius: 0.22, roughness: 0.4 }), {
    style: { buildOrder: 0.95, part: GLOW_PART, slot: MaterialSlot.Ember },
    transform: transformOf({ position: [0, 0.1, 0], scale: [1, 0.5, 1] }),
  });
}

function tentRadius(height: number): number {
  return lerp(TENT_BASE_RADIUS, TENT_TOP_RADIUS, height / TENT_HEIGHT);
}

function addTentPole(context: StructureContext, angle: number, order: number): void {
  function pointAt(height: number): Triple {
    const reach = tentRadius(height) + TENT_POLE_LIFT;

    return [Math.cos(angle) * reach, height, Math.sin(angle) * reach];
  }

  addLog(context, pointAt(0), pointAt(TENT_HEIGHT + TENT_POLE_OVERHANG), 0.045, order);
}

function addTentDoor(context: StructureContext, sides: number): void {
  const facet = FULL_TURN / sides;
  const startAngle = TENT_DOOR_ANGLE - TENT_DOOR_HALF_ANGLE;
  const endAngle = TENT_DOOR_ANGLE + TENT_DOOR_HALF_ANGLE;

  function onFacet(around: number): number {
    const offset = fractionalPart((lerp(startAngle, endAngle, around) - TENT_DOOR_ANGLE) / facet) * facet;

    return Math.cos(facet / 2) / Math.cos(offset - facet / 2);
  }

  function section(height: number): LoftSection {
    const radius = tentRadius(height) + TENT_DOOR_LIFT;

    return { radiusX: radius, radiusZ: radius, ripple: onFacet, y: height };
  }

  context.builder.add(
    panel({
      angularSegments: 2,
      endAngle,
      sections: [section(0), section(TENT_DOOR_HEIGHT)],
      startAngle,
      thickness: TENT_DOOR_THICKNESS,
    }),
    { style: { buildOrder: 0.6, slot: MaterialSlot.Ash } }
  );
}

function tentSlot(point: SurfacePoint): MaterialSlotIndex {
  const { x, y, z } = point.position;

  const isBand = y > 0.6 && y < 0.85;
  const isMark = y > 1.2 && y < 1.5 && fractionalPart(Math.atan2(z, x) / (Math.PI / 3)) < 0.3;

  return isBand || isMark ? MaterialSlot.Accent : MaterialSlot.Hide;
}

function addTent(context: StructureContext): void {
  const { builder } = context;

  const poles = detail(context, 7, 4);
  const rings = detail(context, 12, 5);

  const spacing = FULL_TURN / poles;
  const sides = poles * 2;

  const firstPole = TENT_DOOR_ANGLE + spacing / 2;

  for (let pole = 0; pole < poles; pole += 1) {
    addTentPole(context, firstPole + pole * spacing, (pole / poles) * 0.4);
  }

  const profile = [
    ...Array.from({ length: rings + 1 }, (_, ring) => {
      const height = (TENT_HEIGHT * ring) / rings;

      return { radius: tentRadius(height), y: height };
    }),
    { radius: 0, y: TENT_HEIGHT + TENT_TOP_RADIUS },
  ];

  builder.add(lathe(profile, sides), {
    style: {
      buildOrder: rising(0.4, 1, 0, TENT_HEIGHT),
      shade: (point) => {
        return 0.75 + 0.25 * smoothstep(0, 1.5, point.position.y);
      },
      slot: tentSlot,
    },
    transform: transformOf({ rotation: [0, -firstPole, 0] }),
  });
  addTentDoor(context, sides);
}

function wallRadiusAt(height: number): number {
  return HUT_RADIUS - 0.04 * saturate((height - 0.55) / 1.2);
}

function onWall(x: number, height: number, sink: number): number {
  const radius = wallRadiusAt(height);

  return Math.sqrt(radius * radius - x * x) + sink;
}

function addHutDoor(context: StructureContext): void {
  const halfAngle = Math.asin(HUT_DOOR_HALF_WIDTH / HUT_RADIUS);

  function section(height: number): LoftSection {
    const radius = wallRadiusAt(height) + 0.012;

    return { radiusX: radius, radiusZ: radius, y: height };
  }

  context.builder.add(
    panel({
      angularSegments: detail(context, 4, 2),
      endAngle: Math.PI / 2 + halfAngle,
      sections: [section(HUT_SILL), section(HUT_DOOR_TOP)],
      startAngle: Math.PI / 2 - halfAngle,
      thickness: 0.02,
    }),
    { style: { buildOrder: 0.35, slot: MaterialSlot.Ash } }
  );

  for (const side of [-1, 1]) {
    const x = side * (HUT_DOOR_HALF_WIDTH + HUT_POST_RADIUS * 0.4);

    addLog(
      context,
      [x, 0, onWall(x, HUT_SILL, HUT_POST_SINK + 0.06)],
      [x, HUT_DOOR_TOP + 0.08, onWall(x, HUT_DOOR_TOP, HUT_POST_SINK)],
      HUT_POST_RADIUS,
      0.3
    );
  }

  const lintelEnd = HUT_DOOR_HALF_WIDTH + 0.15;

  addLog(
    context,
    [-lintelEnd, HUT_DOOR_TOP + 0.02, onWall(0, HUT_DOOR_TOP, -0.02)],
    [lintelEnd, HUT_DOOR_TOP + 0.02, onWall(0, HUT_DOOR_TOP, -0.02)],
    HUT_POST_RADIUS,
    0.32
  );
}

function hutSegments(context: StructureContext): number {
  return detail(context, 18, 8);
}

function addHutWall(context: StructureContext): void {
  context.builder.add(
    loft(
      [
        { radiusX: 0, radiusZ: 0, y: 0.6 },
        {
          radiusX: HUT_RADIUS + 0.12,
          radiusZ: HUT_RADIUS + 0.12,
          ripple: (around) => {
            return 1 + 0.025 * Math.sin(around * 70);
          },
          y: 0,
        },
        {
          radiusX: HUT_RADIUS + 0.06,
          radiusZ: HUT_RADIUS + 0.06,
          ripple: (around) => {
            return 1 + 0.02 * Math.sin(around * 55);
          },
          y: 0.5,
        },
        { radiusX: HUT_RADIUS, radiusZ: HUT_RADIUS, y: 0.55 },
        { radiusX: HUT_RADIUS - 0.04, radiusZ: HUT_RADIUS - 0.04, y: 1.75 },
        { radiusX: 0, radiusZ: 0, y: 1.8 },
      ],
      hutSegments(context)
    ),
    {
      style: {
        buildOrder: (point) => {
          return 0.05 + 0.45 * saturate(point.position.y / 1.75);
        },
        shade: (point) => {
          return 0.7 + 0.3 * smoothstep(0, 1.6, point.position.y);
        },
        slot: (point) => {
          return point.position.y < 0.52 ? MaterialSlot.Stone : MaterialSlot.Daub;
        },
      },
    }
  );
}

function addHutThatch(context: StructureContext): void {
  const segments = hutSegments(context);
  const tiers = detail(context, 3, 1);

  for (let tier = 0; tier < tiers; tier += 1) {
    const bottom = 1.55 + tier * 0.55;
    const radius = (HUT_RADIUS + 0.55) * (1 - tier * 0.28);

    const thatch = thatchSections(bottom, 3.7, radius, (around) => {
      return 1 + 0.03 * Math.sin(around * segments * 3);
    });

    context.builder.add(loft(thatch, segments), {
      style: {
        buildOrder: 0.55 + tier * 0.15,
        shade: (point) => {
          return 0.72 + 0.28 * smoothstep(bottom, 3.7, point.position.y);
        },
        slot: MaterialSlot.Thatch,
      },
    });
  }
}

function addHut(context: StructureContext): void {
  addHutWall(context);
  addHutThatch(context);
  addHutDoor(context);
  addFlag(context, [0, 0, 0], { bottom: 3.75, height: 0.35, turn: 0.3, width: 0.5 });
  addLog(context, [0, 3.4, 0], [0, 4.2, 0], 0.03, 0.98);
}

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

  for (const [x, z] of [
    [-1.1, -0.9],
    [1.1, -0.9],
    [-1.1, 0.9],
    [1.1, 0.9],
  ] as const) {
    addLog(context, [x, 0, z], [x, 1, z], 0.09, 0.1);
  }

  builder.add(box(2.6, 0.16, 2.2), {
    style: { buildOrder: 0.35, slot: MaterialSlot.Wood },
    transform: transformOf({ position: [0, 1.06, 0] }),
  });
  builder.add(box(2.2, 1.1, 1.8), {
    style: {
      buildOrder: (point) => {
        return 0.4 + 0.3 * saturate((point.position.y - 1.1) / 1.1);
      },
      shade: (point) => {
        return 0.75 + 0.25 * smoothstep(1.1, 2.2, point.position.y);
      },
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

  addLog(context, [0, RIDGE_HEIGHT, -1.38], [0, RIDGE_HEIGHT, 1.38], 0.075, 0.88);
}

function addStorehouseLadder(context: StructureContext): void {
  context.builder.add(card(0.7, 0.9), {
    style: { buildOrder: 0.6, slot: MaterialSlot.Ash },
    transform: transformOf({ position: [0, 1.15, 0.91] }),
  });

  for (const offset of [-0.25, 0.25]) {
    addLog(context, [offset, 0, 1.75], [offset, 1.15, 1], 0.03, 0.5);
  }

  for (let rung = 1; rung < 4; rung += 1) {
    const amount = rung / 4;

    const y = 1.15 * amount;
    const z = 1.75 - 0.75 * amount;

    addLog(context, [-0.25, y, z], [0.25, y, z], 0.022, 0.5);
  }
}

function addStorehouseJars(context: StructureContext): void {
  for (const [x, z, height] of [
    [1.6, 0.6, 0.55],
    [1.75, 0.05, 0.45],
  ] as const) {
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

function addStorehouse(context: StructureContext): void {
  addStorehouseBody(context);
  addStorehouseRoof(context);
  addStorehouseLadder(context);
  addStorehouseJars(context);
  addFlag(context, [0, 0, 1.2], { bottom: 3.55, height: 0.4, turn: 0, width: 0.6 });
  addLog(context, [0, 3, 1.2], [0, 4, 1.2], 0.025, 0.99);
}

function totemRadius(head: number): number {
  return 0.3 - head * 0.02;
}

function headSections(bottom: number, radius: number): LoftSection[] {
  return [
    { radiusX: radius * 1.05, radiusZ: radius * 1.12, y: bottom + TOTEM_HEAD_HEIGHT * 0.3 },
    { centerZ: radius * 0.12, radiusX: radius * 1.02, radiusZ: radius * 1.18, y: bottom + TOTEM_HEAD_HEIGHT * 0.62 },
  ];
}

function waist(head: number): LoftSection {
  const radius = Math.min(totemRadius(head - 1) * 0.9, totemRadius(head) * 0.92) * TOTEM_WAIST;

  return { radiusX: radius, radiusZ: radius, y: TOTEM_BASE + head * TOTEM_HEAD_HEIGHT };
}

function totemLog(segments: number): Shape {
  const lowest = totemRadius(0);
  const highest = totemRadius(TOTEM_HEADS - 1);

  const sections: LoftSection[] = [
    { radiusX: 0, radiusZ: 0, y: 0 },
    { radiusX: lowest * 0.92, radiusZ: lowest * 0.92, y: 0 },
    { radiusX: lowest * 0.92, radiusZ: lowest * 0.92, y: TOTEM_BASE },
  ];

  for (let head = 0; head < TOTEM_HEADS; head += 1) {
    const bottom = TOTEM_BASE + head * TOTEM_HEAD_HEIGHT;

    if (head > 0) {
      sections.push(waist(head));
    }

    sections.push(...headSections(bottom, totemRadius(head)));
  }

  sections.push(
    { radiusX: highest * 0.9, radiusZ: highest * 0.95, y: TOTEM_TOP },
    { radiusX: 0, radiusZ: 0, y: TOTEM_TOP }
  );

  return loft(sections, segments);
}

function headOf(height: number): number {
  return clamp(Math.floor((height - TOTEM_BASE) / TOTEM_HEAD_HEIGHT), 0, TOTEM_HEADS - 1);
}

function headOrder(head: number): number {
  return 0.15 + head * 0.25;
}

function addTotemEyes(context: StructureContext, head: Shape, bottom: number, order: number): void {
  const center = new Vector3(0, bottom + TOTEM_HEAD_HEIGHT * 0.66, 0);

  for (const side of [-1, 1]) {
    const hit = outermostHit(head, center, new Vector3(side * 0.3, 0, 1));

    if (hit === null) {
      continue;
    }

    context.builder.add(box(0.1, 0.07, 0.04), {
      style: { buildOrder: order, slot: MaterialSlot.Bone },
      transform: transformOf({
        position: hit.point.toArray(),
        rotation: [0, Math.atan2(hit.normal.x, hit.normal.z), 0],
      }),
    });
  }
}

function addTotemNose(context: StructureContext, head: Shape, bottom: number, order: number): void {
  const hit = outermostHit(head, new Vector3(0, bottom + TOTEM_HEAD_HEIGHT * 0.45, 0), new Vector3(0, 0, 1));

  if (hit === null) {
    return;
  }

  const axis = new Vector3(0, -Math.sin(TOTEM_NOSE_TILT), Math.cos(TOTEM_NOSE_TILT));

  const base = hit.point.clone().addScaledVector(axis, -TOTEM_NOSE_DEPTH);
  const tip = base.clone().add(axis);

  context.builder.add(cone(0.08, TOTEM_NOSE_LENGTH + TOTEM_NOSE_DEPTH, 5), {
    style: { buildOrder: order, slot: MaterialSlot.Wood },
    transform: segmentTransform(base.toArray(), tip.toArray()),
  });
}

function totemSlot(point: SurfacePoint, bottom: number): MaterialSlotIndex {
  const relative = (point.position.y - bottom) / TOTEM_HEAD_HEIGHT;

  const isBand = relative > 0.08 && relative < 0.2;
  const isEye = relative > 0.58 && relative < 0.74 && point.normal.z > 0.6 && Math.abs(point.position.x) > 0.05;

  return isBand || isEye ? MaterialSlot.Accent : MaterialSlot.Wood;
}

function addTotem(context: StructureContext): void {
  const { builder } = context;

  const segments = detail(context, 12, 6);

  for (let stone = 0; stone < 5; stone += 1) {
    const angle = (stone / 5) * FULL_TURN;

    addStone(context, [Math.cos(angle) * 0.42, 0.1, Math.sin(angle) * 0.42], 0.17, 0.05);
  }

  const log = totemLog(segments);

  builder.add(log, {
    style: {
      buildOrder: (point) => {
        return headOrder(headOf(point.position.y));
      },
      slot: (point) => {
        const head = headOf(point.position.y);

        return totemSlot(point, TOTEM_BASE + head * TOTEM_HEAD_HEIGHT);
      },
    },
  });

  for (let head = 0; head < TOTEM_HEADS; head += 1) {
    const bottom = TOTEM_BASE + head * TOTEM_HEAD_HEIGHT;
    const order = headOrder(head);

    if (isDetailed(context)) {
      addTotemEyes(context, log, bottom, order + 0.05);
    }

    addTotemNose(context, log, bottom, order + 0.05);
  }

  for (const side of [-1, 1]) {
    builder.add(box(1.2, 0.34, 0.08), {
      style: {
        buildOrder: 0.95,
        slot: (point) => {
          return Math.abs(point.position.x) > 0.55 ? MaterialSlot.Accent : MaterialSlot.Wood;
        },
      },
      transform: transformOf({ position: [side * 0.62, TOTEM_TOP - 0.2, 0], rotation: [0, 0, side * 0.22] }),
    });
  }
}

function hasSingleModel(kind: BuildingKind): kind is SingleModelKind {
  return kind !== "mine" && kind !== "palisade" && kind !== "stoneWall";
}

export function buildingScale(kind: SingleModelKind): number {
  const scale = BUILDING_SCALES[kind];

  if (scale === undefined) {
    return 1;
  }

  return scale;
}

export function buildBuildingModel(kind: SingleModelKind, level: StructureLevel): MeshData {
  const builder = new MeshBuilder();

  BUILDERS[kind]({ builder, level, random: createRandom(kind.length * 31 + 7) });

  return scaledMesh(builder.build(), buildingScale(kind));
}
