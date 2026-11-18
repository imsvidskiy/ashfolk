import { FULL_TURN, fractionalPart, lerp, saturate } from "../../shared/math.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import type { SurfacePoint } from "../mesh/mesh-builder.ts";
import { type LoftSection, lathe, loft, panel } from "../mesh/shapes.ts";
import { type Triple, transformOf } from "../mesh/transforms.ts";
import { addFlagCloth, addTaperedLog } from "./camp-building-parts.ts";
import { detail, rising, type StructureContext, thatchSections, upwardShade } from "./structure-parts.ts";

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

function tentRadius(height: number): number {
  return lerp(TENT_BASE_RADIUS, TENT_TOP_RADIUS, height / TENT_HEIGHT);
}

function addTentPole(context: StructureContext, angle: number, order: number): void {
  function pointAt(height: number): Triple {
    const reach = tentRadius(height) + TENT_POLE_LIFT;

    return [Math.cos(angle) * reach, height, Math.sin(angle) * reach];
  }

  addTaperedLog(context, pointAt(0), pointAt(TENT_HEIGHT + TENT_POLE_OVERHANG), 0.045, order);
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

export function addTent(context: StructureContext): void {
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
      shade: upwardShade(0.75, 0, 1.5),
      slot: tentSlot,
    },
    transform: transformOf({ rotation: [0, -firstPole, 0] }),
  });
  addTentDoor(context, sides);
}

function wallRadiusAt(height: number): number {
  return HUT_RADIUS - 0.04 * saturate((height - 0.55) / 1.2);
}

function hutWallDepth(x: number, height: number, sink: number): number {
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

    addTaperedLog(
      context,
      [x, 0, hutWallDepth(x, HUT_SILL, HUT_POST_SINK + 0.06)],
      [x, HUT_DOOR_TOP + 0.08, hutWallDepth(x, HUT_DOOR_TOP, HUT_POST_SINK)],
      HUT_POST_RADIUS,
      0.3
    );
  }

  const lintelEnd = HUT_DOOR_HALF_WIDTH + 0.15;

  addTaperedLog(
    context,
    [-lintelEnd, HUT_DOOR_TOP + 0.02, hutWallDepth(0, HUT_DOOR_TOP, -0.02)],
    [lintelEnd, HUT_DOOR_TOP + 0.02, hutWallDepth(0, HUT_DOOR_TOP, -0.02)],
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
        buildOrder: rising(0.05, 0.5, 0, 1.75),
        shade: upwardShade(0.7, 0, 1.6),
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
        shade: upwardShade(0.72, bottom, 3.7),
        slot: MaterialSlot.Thatch,
      },
    });
  }
}

export function addHut(context: StructureContext): void {
  addHutWall(context);
  addHutThatch(context);
  addHutDoor(context);
  addFlagCloth(context, [0, 0, 0], { bottom: 3.75, height: 0.35, turn: 0.3, width: 0.5 });
  addTaperedLog(context, [0, 3.4, 0], [0, 4.2, 0], 0.03, 0.98);
}
