import { hashToUnit } from "../../shared/math.ts";
import { MaterialSlot } from "../materials.ts";
import { card } from "../mesh/shapes.ts";
import { type Triple, transformOf } from "../mesh/transforms.ts";
import {
  addBlock,
  addLog,
  addLogPile,
  addPitchedRoof,
  isDetailed,
  prism,
  rising,
  type StructureContext,
  stoneShade,
  upwardShade,
} from "./structure-parts.ts";

const LONGHOUSE_HALF_LENGTH = 6.4;
const LONGHOUSE_HALF_WIDTH = 2.7;
const LONGHOUSE_FOOTING = 0.35;
const LONGHOUSE_WALL_TOP = 2.5;
const LONGHOUSE_EAVE = 2.25;
const LONGHOUSE_EAVE_REACH = 3.15;
const LONGHOUSE_RIDGE = 5.5;
const LONGHOUSE_ROOF_HALF_LENGTH = 6.6;
const LONGHOUSE_ROOF_THICKNESS = 0.42;
const LONGHOUSE_DOOR_HALF_WIDTH = 0.56;
const LONGHOUSE_DOOR_TOP = 2.25;
const TIMBER_SPACING = 2.1;
const HOUSE_HALF_LENGTH = 3.6;
const HOUSE_HALF_WIDTH = 2.7;
const HOUSE_WALL_TOP = 2.4;
const HOUSE_EAVE = 2.25;
const HOUSE_EAVE_REACH = 3;
const HOUSE_RIDGE = 4.6;
const HOUSE_ROOF_HALF_LENGTH = 3.95;
const HOUSE_DOOR_HALF_WIDTH = 0.52;
const HOUSE_DOOR_TOP = 2;
const HOUSE_WINDOW_X = 2;
const HOUSE_WINDOW_BOTTOM = 1.2;
const HOUSE_WINDOW_TOP = 1.7;
const COURSE_HEIGHT = 0.34;
const STONE_DEPTH = 0.14;
const STONE_PROUD = 0.04;
const STONE_SALT = 17.9;
const SHORTEST_STONE = 0.2;

interface Opening {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

const FRONT_OPENINGS: readonly Opening[] = [
  { bottom: 0, left: -HOUSE_DOOR_HALF_WIDTH - 0.1, right: HOUSE_DOOR_HALF_WIDTH + 0.1, top: HOUSE_DOOR_TOP + 0.25 },
  {
    bottom: HOUSE_WINDOW_BOTTOM - 0.1,
    left: -HOUSE_WINDOW_X - 0.4,
    right: -HOUSE_WINDOW_X + 0.4,
    top: HOUSE_WINDOW_TOP + 0.25,
  },
  {
    bottom: HOUSE_WINDOW_BOTTOM - 0.1,
    left: HOUSE_WINDOW_X - 0.4,
    right: HOUSE_WINDOW_X + 0.4,
    top: HOUSE_WINDOW_TOP + 0.25,
  },
];

interface WallFace {
  readonly halfLength: number;
  readonly isAlongX: boolean;
  readonly offset: number;
  readonly openings: readonly Opening[];
  readonly side: number;
}

function addGable(context: StructureContext, x: number): void {
  const base = LONGHOUSE_WALL_TOP - 0.1;
  const halfWidth = LONGHOUSE_HALF_WIDTH - 0.05;

  context.builder.add(
    prism(
      [
        [-halfWidth, base],
        [halfWidth, base],
        [0, LONGHOUSE_RIDGE - 0.15],
      ],
      0.22
    ),
    {
      style: { buildOrder: 0.5, shade: 0.9, slot: MaterialSlot.Wood },
      transform: transformOf({ position: [x, 0, 0], rotation: [0, Math.PI / 2, 0] }),
    }
  );
}

function addCrossedTimbers(context: StructureContext, x: number): void {
  for (const side of [-1, 1]) {
    addLog(context, [x, LONGHOUSE_RIDGE - 1.3, side * 1.1], [x, LONGHOUSE_RIDGE + 0.75, -side * 0.55], 0.075, {
      buildOrder: 0.95,
      slot: MaterialSlot.Wood,
    });
  }
}

function addLonghouseWalls(context: StructureContext): void {
  const wallHeight = LONGHOUSE_WALL_TOP - LONGHOUSE_FOOTING + 0.05;

  addBlock(
    context,
    [LONGHOUSE_HALF_LENGTH * 2 + 0.16, LONGHOUSE_FOOTING, LONGHOUSE_HALF_WIDTH * 2 + 0.16],
    [0, LONGHOUSE_FOOTING / 2, 0],
    { buildOrder: 0.06, shade: stoneShade, slot: MaterialSlot.Stone }
  );
  addBlock(
    context,
    [LONGHOUSE_HALF_LENGTH * 2, wallHeight, LONGHOUSE_HALF_WIDTH * 2],
    [0, LONGHOUSE_FOOTING - 0.05 + wallHeight / 2, 0],
    {
      buildOrder: rising(0.15, 0.42, LONGHOUSE_FOOTING, LONGHOUSE_WALL_TOP),
      shade: upwardShade(0.74, 0, 2.2),
      slot: MaterialSlot.Daub,
    }
  );

  if (!isDetailed(context)) {
    return;
  }

  const posts = Math.floor((LONGHOUSE_HALF_LENGTH * 2) / TIMBER_SPACING);

  for (let post = 0; post <= posts; post += 1) {
    const x = -LONGHOUSE_HALF_LENGTH + 0.12 + (post * (LONGHOUSE_HALF_LENGTH * 2 - 0.24)) / posts;

    for (const side of [-1, 1]) {
      if (side > 0 && Math.abs(x) < LONGHOUSE_DOOR_HALF_WIDTH + 0.5) {
        continue;
      }

      addLog(
        context,
        [x, LONGHOUSE_FOOTING - 0.02, side * (LONGHOUSE_HALF_WIDTH + 0.03)],
        [x, LONGHOUSE_WALL_TOP - 0.15, side * (LONGHOUSE_HALF_WIDTH + 0.03)],
        0.08,
        { buildOrder: 0.3, slot: MaterialSlot.Wood }
      );
    }
  }
}

function addLonghouseDoor(context: StructureContext): void {
  const front = LONGHOUSE_HALF_WIDTH;
  const doorHeight = LONGHOUSE_DOOR_TOP - LONGHOUSE_FOOTING;

  addBlock(
    context,
    [LONGHOUSE_DOOR_HALF_WIDTH * 2, doorHeight, 0.08],
    [0, LONGHOUSE_FOOTING + doorHeight / 2, front + 0.01],
    { buildOrder: 0.4, slot: MaterialSlot.Ash }
  );

  for (const side of [-1, 1]) {
    const x = side * (LONGHOUSE_DOOR_HALF_WIDTH + 0.06);

    addLog(context, [x, LONGHOUSE_FOOTING - 0.04, front + 0.05], [x, LONGHOUSE_DOOR_TOP + 0.1, front + 0.05], 0.07, {
      buildOrder: 0.38,
      slot: MaterialSlot.Wood,
    });
  }

  const lintelEnd = LONGHOUSE_DOOR_HALF_WIDTH + 0.24;

  addLog(
    context,
    [-lintelEnd, LONGHOUSE_DOOR_TOP + 0.05, front + 0.06],
    [lintelEnd, LONGHOUSE_DOOR_TOP + 0.05, front + 0.06],
    0.07,
    { buildOrder: 0.44, slot: MaterialSlot.Wood }
  );

  for (const side of [-1, 1]) {
    context.builder.add(card(0.36, 1.3), {
      style: { buildOrder: 0.97, slot: MaterialSlot.Accent },
      transform: transformOf({ position: [side * 0.38, LONGHOUSE_DOOR_TOP + 0.08 - 1.3, front + 0.08] }),
    });
  }
}

function addLonghouseRoof(context: StructureContext): void {
  addPitchedRoof(context, {
    eave: LONGHOUSE_EAVE,
    length: LONGHOUSE_ROOF_HALF_LENGTH * 2,
    ridge: LONGHOUSE_RIDGE,
    span: LONGHOUSE_EAVE_REACH * 2,
    style: {
      buildOrder: rising(0.55, 0.9, LONGHOUSE_EAVE - 0.3, LONGHOUSE_RIDGE),
      shade: upwardShade(0.72, LONGHOUSE_EAVE, LONGHOUSE_RIDGE),
      slot: MaterialSlot.Thatch,
    },
    thickness: LONGHOUSE_ROOF_THICKNESS,
  });

  for (const side of [-1, 1]) {
    addGable(context, side * (LONGHOUSE_HALF_LENGTH - 0.05));
    addCrossedTimbers(context, side * (LONGHOUSE_ROOF_HALF_LENGTH - 0.1));
  }

  addBlock(context, [1, 0.4, 1], [1.6, LONGHOUSE_RIDGE + 0.05, 0], {
    buildOrder: 0.92,
    shade: 0.68,
    slot: MaterialSlot.Thatch,
  });
}

export function addLonghouse(context: StructureContext): void {
  addLonghouseWalls(context);
  addLonghouseDoor(context);
  addLonghouseRoof(context);

  if (isDetailed(context)) {
    addLogPile(context, [-4.2, 0, LONGHOUSE_HALF_WIDTH + 0.55], 0, 1.6, 0.6);
  }
}

function openingAt(openings: readonly Opening[], x: number): Opening | undefined {
  return openings.find((opening) => {
    return x > opening.left - SHORTEST_STONE && x < opening.right;
  });
}

function nextOpeningEdge(openings: readonly Opening[], x: number, end: number): number {
  return openings.reduce((edge, opening) => {
    return opening.left > x ? Math.min(edge, opening.left) : edge;
  }, end);
}

function addCladdingStone(
  context: StructureContext,
  face: WallFace,
  left: number,
  right: number,
  course: number
): void {
  const bottom = course * COURSE_HEIGHT;
  const top = Math.min(HOUSE_WALL_TOP - 0.05, bottom + COURSE_HEIGHT - 0.02);
  const middle = (left + right) / 2;
  const length = right - left - 0.03;
  const outward = face.offset + face.side * (STONE_PROUD - STONE_DEPTH / 2);
  const shade = 0.72 + 0.28 * hashToUnit(course, middle * 3.1, STONE_SALT);

  const size: Triple = face.isAlongX ? [length, top - bottom, STONE_DEPTH] : [STONE_DEPTH, top - bottom, length];
  const position: Triple = face.isAlongX
    ? [middle, (bottom + top) / 2, outward]
    : [outward, (bottom + top) / 2, middle];

  addBlock(context, size, position, {
    buildOrder: 0.08 + 0.4 * ((bottom + top) / 2 / HOUSE_WALL_TOP),
    shade,
    slot: course % 3 === 0 ? MaterialSlot.PaleStone : MaterialSlot.Stone,
  });
}

function addCladding(context: StructureContext, face: WallFace): void {
  const courses = Math.floor(HOUSE_WALL_TOP / COURSE_HEIGHT);

  for (let course = 0; course < courses; course += 1) {
    const bottom = course * COURSE_HEIGHT;
    const openings = face.openings.filter((opening) => {
      return bottom < opening.top && bottom + COURSE_HEIGHT > opening.bottom;
    });
    let left = -face.halfLength + 0.06;

    for (let block = 0; left < face.halfLength - 0.2; block += 1) {
      const blocking = openingAt(openings, left);

      if (blocking !== undefined) {
        left = blocking.right;

        continue;
      }

      const length = 0.9 + 0.7 * hashToUnit(course, block, STONE_SALT + face.offset);
      const right = nextOpeningEdge(openings, left, Math.min(face.halfLength - 0.06, left + length));

      addCladdingStone(context, face, left, right, course);

      left = right;
    }
  }
}

function addHouseWalls(context: StructureContext): void {
  addBlock(context, [HOUSE_HALF_LENGTH * 2, HOUSE_WALL_TOP, HOUSE_HALF_WIDTH * 2], [0, HOUSE_WALL_TOP / 2, 0], {
    buildOrder: rising(0.05, 0.45, 0, HOUSE_WALL_TOP),
    shade: stoneShade,
    slot: MaterialSlot.Stone,
  });

  if (!isDetailed(context)) {
    return;
  }

  const faces: readonly WallFace[] = [
    { halfLength: HOUSE_HALF_LENGTH, isAlongX: true, offset: HOUSE_HALF_WIDTH, openings: FRONT_OPENINGS, side: 1 },
    { halfLength: HOUSE_HALF_LENGTH, isAlongX: true, offset: -HOUSE_HALF_WIDTH, openings: [], side: -1 },
    { halfLength: HOUSE_HALF_WIDTH, isAlongX: false, offset: HOUSE_HALF_LENGTH, openings: [], side: 1 },
    { halfLength: HOUSE_HALF_WIDTH, isAlongX: false, offset: -HOUSE_HALF_LENGTH, openings: [], side: -1 },
  ];

  for (const face of faces) {
    addCladding(context, face);
  }
}

function addHouseFront(context: StructureContext): void {
  const front = HOUSE_HALF_WIDTH;

  addBlock(context, [HOUSE_DOOR_HALF_WIDTH * 2, HOUSE_DOOR_TOP, 0.1], [0, HOUSE_DOOR_TOP / 2, front + 0.02], {
    buildOrder: 0.46,
    shade: 0.85,
    slot: MaterialSlot.Accent,
  });
  addBlock(context, [HOUSE_DOOR_HALF_WIDTH * 2 + 0.6, 0.22, 0.34], [0, HOUSE_DOOR_TOP + 0.11, front + 0.06], {
    buildOrder: 0.5,
    slot: MaterialSlot.Wood,
  });
  addBlock(context, [HOUSE_DOOR_HALF_WIDTH * 2 + 0.4, 0.14, 0.5], [0, 0.07, front + 0.2], {
    buildOrder: 0.05,
    slot: MaterialSlot.PaleStone,
  });

  for (const side of [-1, 1]) {
    const x = side * HOUSE_WINDOW_X;
    const height = HOUSE_WINDOW_TOP - HOUSE_WINDOW_BOTTOM;

    addBlock(context, [0.56, height, 0.08], [x, (HOUSE_WINDOW_BOTTOM + HOUSE_WINDOW_TOP) / 2, front + 0.02], {
      buildOrder: 0.48,
      slot: MaterialSlot.Ash,
    });
    addBlock(context, [0.86, 0.16, 0.3], [x, HOUSE_WINDOW_TOP + 0.08, front + 0.06], {
      buildOrder: 0.5,
      slot: MaterialSlot.Wood,
    });
  }
}

function addHouseRoof(context: StructureContext): void {
  addPitchedRoof(context, {
    eave: HOUSE_EAVE,
    length: HOUSE_ROOF_HALF_LENGTH * 2,
    ridge: HOUSE_RIDGE,
    span: HOUSE_EAVE_REACH * 2,
    style: {
      buildOrder: rising(0.6, 0.9, HOUSE_EAVE - 0.3, HOUSE_RIDGE),
      shade: upwardShade(0.74, HOUSE_EAVE, HOUSE_RIDGE),
      slot: MaterialSlot.Thatch,
    },
    thickness: 0.4,
  });

  for (const side of [-1, 1]) {
    context.builder.add(
      prism(
        [
          [-HOUSE_HALF_WIDTH + 0.02, HOUSE_WALL_TOP - 0.1],
          [HOUSE_HALF_WIDTH - 0.02, HOUSE_WALL_TOP - 0.1],
          [0, HOUSE_RIDGE - 0.1],
        ],
        0.4
      ),
      {
        style: { buildOrder: 0.55, shade: stoneShade, slot: MaterialSlot.Stone },
        transform: transformOf({ position: [side * (HOUSE_HALF_LENGTH - 0.2), 0, 0], rotation: [0, Math.PI / 2, 0] }),
      }
    );
  }

  const chimneyX = HOUSE_HALF_LENGTH - 0.9;

  addBlock(context, [0.72, 1.7, 0.72], [chimneyX, HOUSE_RIDGE - 0.2, 0], {
    buildOrder: 0.93,
    shade: stoneShade,
    slot: MaterialSlot.Stone,
  });
  addBlock(context, [0.86, 0.14, 0.86], [chimneyX, HOUSE_RIDGE + 0.7, 0], {
    buildOrder: 0.96,
    slot: MaterialSlot.PaleStone,
  });
}

export function addStoneHouse(context: StructureContext): void {
  addHouseWalls(context);
  addHouseFront(context);
  addHouseRoof(context);

  addLogPile(context, [HOUSE_HALF_LENGTH + 0.42, 0, 0.6], Math.PI / 2, 1.5, 0.62);
}
