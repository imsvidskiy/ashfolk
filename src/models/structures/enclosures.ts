import { hashToUnit, saturate } from "../../shared/math.ts";
import { createRandom } from "../../shared/random.ts";
import { MaterialSlot } from "../materials.ts";
import { MeshBuilder } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { card, lathe } from "../mesh/shapes.ts";
import { type Triple, transformOf } from "../mesh/transforms.ts";
import {
  addBlock,
  addLog,
  detail,
  isDetailed,
  rising,
  type StructureContext,
  type StructureLevel,
} from "./structure-parts.ts";

export const ENCLOSURE_SEGMENT_LENGTH = 5.6;
export const ENCLOSURE_FOOTING_DEPTH = 0.3;

const HALF_SEGMENT = ENCLOSURE_SEGMENT_LENGTH / 2;
const STAKE_SALT = 23.7;
const STONE_SALT = 31.1;
const RAIL_GRIP = 0.065;
const PALISADE_RAILS: readonly number[] = [1.1, 2.3];
const GATE_POST_X = 1.25;
const GATE_POST_HEIGHT = 4.3;
const GATE_LINTEL_HEIGHT = 4;
const WALL_THICKNESS = 0.9;
const WALL_TOP = 2.1;
const COURSE_HEIGHT = 0.4;
const PILLAR_X = 1.35;
const PILLAR_WIDTH = 0.9;
const PILLAR_TOP = 3.1;

export type EnclosureKind = "palisade" | "stoneWall";

export type EnclosurePiece = "gate" | "segment";

interface Span {
  readonly from: number;
  readonly to: number;
}

interface PieceBuilder {
  readonly build: (context: StructureContext) => void;
  readonly seed: number;
}

const PIECE_BUILDERS: Readonly<Record<EnclosureKind, Readonly<Record<EnclosurePiece, PieceBuilder>>>> = {
  palisade: {
    gate: { build: palisadeGate, seed: 71 },
    segment: { build: palisadeSegment, seed: 73 },
  },
  stoneWall: {
    gate: { build: stoneWallGate, seed: 79 },
    segment: { build: stoneWallSegment, seed: 83 },
  },
};

function stakeRadius(context: StructureContext): number {
  return detail(context, 0.18, 0.3);
}

function stakeSpacing(context: StructureContext): number {
  return detail(context, 0.4, 0.7);
}

function railInset(context: StructureContext): number {
  const reach = detail(context, Math.cos(Math.PI / 6), 1) * stakeRadius(context);

  return reach + detail(context, RAIL_GRIP, 0.03);
}

function addStake(context: StructureContext, base: Triple, height: number, radius: number): void {
  const [x, y, z] = base;

  const tipHeight = radius * 2.4;
  const sides = detail(context, 6, 4);
  const shaftTop = y + height - tipHeight;
  const rings = PALISADE_RAILS.filter((band) => {
    return band > y && band < shaftTop;
  }).map((band) => {
    return { radius: radius - (radius * 0.06 * (band - y)) / (shaftTop - y), y: band };
  });

  context.builder.add(
    lathe(
      [{ radius: 0, y }, { radius, y }, ...rings, { radius: radius * 0.94, y: shaftTop }, { radius: 0, y: y + height }],
      sides
    ),
    {
      style: {
        buildOrder: rising(0.05, 0.82, -ENCLOSURE_FOOTING_DEPTH, 3.5),
        shade: (point) => {
          return 0.82 + 0.18 * saturate(point.position.y / 3);
        },
        slot: MaterialSlot.Wood,
      },
      transform: transformOf({ position: [x, 0, z] }),
    }
  );
}

function addStakeRun(context: StructureContext, span: Span): void {
  const spacing = stakeSpacing(context);
  const radius = stakeRadius(context);

  const count = Math.round((span.to - span.from) / spacing);
  const step = (span.to - span.from) / count;

  for (let stake = 0; stake < count; stake += 1) {
    const x = span.from + (stake + 0.5) * step;
    const height = 3 + 0.5 * hashToUnit(Math.round(x * 10), STAKE_SALT);

    addStake(context, [x, -ENCLOSURE_FOOTING_DEPTH, 0], height + ENCLOSURE_FOOTING_DEPTH, radius);
  }

  const inset = railInset(context);

  for (const height of PALISADE_RAILS) {
    addLog(context, [span.from, height, -inset], [span.to, height, -inset], 0.08, {
      buildOrder: 0.9,
      slot: MaterialSlot.Wood,
    });
  }
}

function palisadeSegment(context: StructureContext): void {
  addStakeRun(context, { from: -HALF_SEGMENT, to: HALF_SEGMENT });
}

function addBanner(context: StructureContext, top: number, front: number, order: number): void {
  const width = 0.8;
  const height = 1;

  context.builder.add(card(width, height), {
    style: { buildOrder: order, slot: MaterialSlot.Accent },
    transform: transformOf({ position: [0, top - height, front] }),
  });
}

function palisadeGate(context: StructureContext): void {
  const postRadius = 0.24;

  for (const side of [-1, 1]) {
    addStakeRun(
      context,
      side < 0
        ? { from: -HALF_SEGMENT, to: -GATE_POST_X - postRadius }
        : { from: GATE_POST_X + postRadius, to: HALF_SEGMENT }
    );
    addLog(
      context,
      [side * GATE_POST_X, -ENCLOSURE_FOOTING_DEPTH, 0],
      [side * GATE_POST_X, GATE_POST_HEIGHT, 0],
      postRadius,
      {
        buildOrder: rising(0.1, 0.7, -ENCLOSURE_FOOTING_DEPTH, GATE_POST_HEIGHT),
        slot: MaterialSlot.Wood,
      }
    );
  }

  addLog(context, [-GATE_POST_X, GATE_LINTEL_HEIGHT, 0], [GATE_POST_X, GATE_LINTEL_HEIGHT, 0], 0.2, {
    buildOrder: 0.88,
    slot: MaterialSlot.Wood,
  });
  addBanner(context, GATE_LINTEL_HEIGHT + 0.05, 0.1, 0.96);
}

function addStoneCourse(context: StructureContext, span: Span, course: number): void {
  const bottom = course * COURSE_HEIGHT - ENCLOSURE_FOOTING_DEPTH;
  const top = Math.min(WALL_TOP, (course + 1) * COURSE_HEIGHT - ENCLOSURE_FOOTING_DEPTH);

  let left = span.from;

  for (let stone = 0; left < span.to - 0.01; stone += 1) {
    const length = 0.62 + 0.45 * hashToUnit(course, stone, STONE_SALT + span.from);
    const right = span.to - (left + length) < 0.35 ? span.to : left + length;
    const depth = WALL_THICKNESS * (0.94 + 0.06 * hashToUnit(stone, course, STONE_SALT));

    addBlock(context, [right - left, top - bottom, depth], [(left + right) / 2, (bottom + top) / 2, 0], {
      buildOrder: 0.05 + 0.75 * ((top + ENCLOSURE_FOOTING_DEPTH) / (WALL_TOP + ENCLOSURE_FOOTING_DEPTH)),
      shade: 0.74 + 0.26 * hashToUnit(stone, course + 7, STONE_SALT),
      slot: (course + stone) % 4 === 0 ? MaterialSlot.PaleStone : MaterialSlot.Stone,
    });

    left = right;
  }
}

function addStoneBody(context: StructureContext, span: Span): void {
  if (!isDetailed(context)) {
    addBlock(
      context,
      [span.to - span.from, WALL_TOP + ENCLOSURE_FOOTING_DEPTH, WALL_THICKNESS],
      [(span.from + span.to) / 2, (WALL_TOP - ENCLOSURE_FOOTING_DEPTH) / 2, 0],
      { buildOrder: rising(0.05, 0.8, -ENCLOSURE_FOOTING_DEPTH, WALL_TOP), shade: 0.85, slot: MaterialSlot.Stone }
    );

    return;
  }

  const courses = Math.ceil((WALL_TOP + ENCLOSURE_FOOTING_DEPTH) / COURSE_HEIGHT);

  for (let course = 0; course < courses; course += 1) {
    addStoneCourse(context, span, course);
  }
}

function addStoneRun(context: StructureContext, span: Span): void {
  addStoneBody(context, span);

  addBlock(context, [span.to - span.from, 0.22, WALL_THICKNESS + 0.1], [(span.from + span.to) / 2, WALL_TOP + 0.1, 0], {
    buildOrder: 0.92,
    slot: MaterialSlot.PaleStone,
  });
}

function stoneWallSegment(context: StructureContext): void {
  addStoneRun(context, { from: -HALF_SEGMENT, to: HALF_SEGMENT });
}

function stoneWallGate(context: StructureContext): void {
  const pillarHalf = PILLAR_WIDTH / 2;

  for (const side of [-1, 1]) {
    addStoneRun(
      context,
      side < 0
        ? { from: -HALF_SEGMENT, to: -PILLAR_X - pillarHalf + 0.05 }
        : { from: PILLAR_X + pillarHalf - 0.05, to: HALF_SEGMENT }
    );
    addBlock(
      context,
      [PILLAR_WIDTH, PILLAR_TOP + ENCLOSURE_FOOTING_DEPTH, WALL_THICKNESS + 0.25],
      [side * PILLAR_X, (PILLAR_TOP - ENCLOSURE_FOOTING_DEPTH) / 2, 0],
      {
        buildOrder: rising(0.08, 0.75, -ENCLOSURE_FOOTING_DEPTH, PILLAR_TOP),
        shade: 0.95,
        slot: MaterialSlot.PaleStone,
      }
    );
  }

  addBlock(context, [PILLAR_X * 2 + 0.8, 0.35, WALL_THICKNESS + 0.05], [0, PILLAR_TOP - 0.2, 0], {
    buildOrder: 0.88,
    slot: MaterialSlot.Wood,
  });
  addBanner(context, PILLAR_TOP - 0.1, WALL_THICKNESS / 2 + 0.03, 0.96);
}

export function buildEnclosurePiece(kind: EnclosureKind, piece: EnclosurePiece, level: StructureLevel): MeshData {
  const { build, seed } = PIECE_BUILDERS[kind][piece];

  const builder = new MeshBuilder();

  build({ builder, level, random: createRandom(seed) });

  return builder.build();
}
