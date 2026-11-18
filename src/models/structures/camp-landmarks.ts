import { Vector3 } from "three";
import { clamp, FULL_TURN } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { SurfacePoint } from "../mesh/mesh-builder.ts";
import type { Shape } from "../mesh/shape.ts";
import { blob, box, cone, disc, type LoftSection, loft } from "../mesh/shapes.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { segmentTransform, type Triple, transformOf } from "../mesh/transforms.ts";
import { addTaperedLog } from "./camp-building-parts.ts";
import { detail, GLOW_PART, isDetailed, type StructureContext } from "./structure-parts.ts";

const CAMP_STONE_NOISE = createVolumeNoise(createRandom(3131));

const TOTEM_HEADS = 3;
const TOTEM_HEAD_HEIGHT = 1.05;
const TOTEM_BASE = 0.15;
const TOTEM_NOSE_LENGTH = 0.26;
const TOTEM_NOSE_DEPTH = 0.04;
const TOTEM_NOSE_TILT = 0.25;
const TOTEM_WAIST = 0.94;
const TOTEM_TOP = TOTEM_BASE + TOTEM_HEADS * TOTEM_HEAD_HEIGHT;

function addFlatStone(context: StructureContext, position: Triple, radius: number, order: number): void {
  const [x, y, z] = position;

  context.builder.add(
    blob({
      detail: detail(context, 1, 0),
      noise: CAMP_STONE_NOISE,
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

export function addCampfire(context: StructureContext): void {
  const { builder, random } = context;

  const stones = detail(context, 10, 6);

  for (let stone = 0; stone < stones; stone += 1) {
    const angle = (stone / stones) * FULL_TURN + random.signed() * 0.15;

    addFlatStone(
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

    addTaperedLog(
      context,
      [Math.cos(angle) * 0.48, 0.04, Math.sin(angle) * 0.48],
      [Math.cos(angle) * 0.06, 0.62, Math.sin(angle) * 0.06],
      0.055,
      0.4 + (log / logs) * 0.6
    );
  }

  builder.add(blob({ detail: 0, noise: CAMP_STONE_NOISE, offset: [1, 1, 1], radius: 0.22, roughness: 0.4 }), {
    style: { buildOrder: 0.95, part: GLOW_PART, slot: MaterialSlot.Ember },
    transform: transformOf({ position: [0, 0.1, 0], scale: [1, 0.5, 1] }),
  });
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

function waistSection(head: number): LoftSection {
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
      sections.push(waistSection(head));
    }

    sections.push(...headSections(bottom, totemRadius(head)));
  }

  sections.push(
    { radiusX: highest * 0.9, radiusZ: highest * 0.95, y: TOTEM_TOP },
    { radiusX: 0, radiusZ: 0, y: TOTEM_TOP }
  );

  return loft(sections, segments);
}

function headAtHeight(height: number): number {
  return clamp(Math.floor((height - TOTEM_BASE) / TOTEM_HEAD_HEIGHT), 0, TOTEM_HEADS - 1);
}

function headBuildOrder(head: number): number {
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

export function addTotem(context: StructureContext): void {
  const { builder } = context;

  const segments = detail(context, 12, 6);

  for (let stone = 0; stone < 5; stone += 1) {
    const angle = (stone / 5) * FULL_TURN;

    addFlatStone(context, [Math.cos(angle) * 0.42, 0.1, Math.sin(angle) * 0.42], 0.17, 0.05);
  }

  const log = totemLog(segments);

  builder.add(log, {
    style: {
      buildOrder: (point) => {
        return headBuildOrder(headAtHeight(point.position.y));
      },
      slot: (point) => {
        const head = headAtHeight(point.position.y);

        return totemSlot(point, TOTEM_BASE + head * TOTEM_HEAD_HEIGHT);
      },
    },
  });

  for (let head = 0; head < TOTEM_HEADS; head += 1) {
    const bottom = TOTEM_BASE + head * TOTEM_HEAD_HEIGHT;
    const order = headBuildOrder(head);

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
