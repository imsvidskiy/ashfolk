import { type Matrix4, Vector3 } from "three";
import { FULL_TURN, smoothstep } from "../../shared/math.ts";
import { createRandom, type RandomSource } from "../../shared/random.ts";
import { thinned } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import { MeshBuilder, type SurfacePoint } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { type LoftSection, loft, sphere, type TubePoint, tube } from "../mesh/shapes.ts";
import { transformOf } from "../mesh/transforms.ts";
import type { PlantDetailLevel } from "./tree-mesher.ts";

export const CACTUS_FORMS = ["saguaro", "organPipe", "barrel", "pricklyPear"] as const;

const RIB_DEPTH = 0.09;
const STEM_SEAM = 0.6;
const PAD_SEAM = 0.1;
const PAD_ROOTING = 0.55;
const PAD_THICKNESS = 0.3;
const PAD_STRETCH = 1.3;

type CactusForm = (typeof CACTUS_FORMS)[number];

interface CactusDetail {
  readonly hasFlowers: boolean;
  readonly maximumStems: number;
  readonly ribs: number;
  readonly segments: number;
}

const CACTUS_DETAILS: Readonly<Record<PlantDetailLevel, CactusDetail>> = {
  far: { hasFlowers: false, maximumStems: 1, ribs: 0, segments: 4 },
  high: { hasFlowers: true, maximumStems: 12, ribs: 9, segments: 14 },
  low: { hasFlowers: false, maximumStems: 2, ribs: 0, segments: 5 },
  medium: { hasFlowers: true, maximumStems: 6, ribs: 7, segments: 9 },
};

const FORM_BUILDERS: Readonly<
  Record<CactusForm, (builder: MeshBuilder, random: RandomSource, detail: CactusDetail) => void>
> = {
  barrel: addBarrel,
  organPipe: addOrganPipe,
  pricklyPear: addPricklyPear,
  saguaro: addSaguaro,
};

interface Column {
  readonly height: number;
  readonly leanX: number;
  readonly leanZ: number;
  readonly radius: number;
  readonly x: number;
  readonly z: number;
}

interface Pad {
  readonly center: Vector3;
  readonly size: number;
  readonly tilt: number;
  readonly turn: number;
}

function ribbed(ribs: number, depth = RIB_DEPTH): (around: number) => number {
  if (ribs === 0) {
    return () => {
      return 1;
    };
  }

  return (around) => {
    return 1 + depth * Math.abs(Math.cos(around * Math.PI * ribs));
  };
}

function stemShade(top: number): (point: SurfacePoint) => number {
  return (point) => {
    return 0.72 + 0.3 * smoothstep(0, Math.min(1.5, top), point.position.y);
  };
}

function columnSections(column: Column, ribs: number): LoftSection[] {
  const { height, leanX, leanZ, radius, x, z } = column;

  const ripple = ribbed(ribs);

  function at(amount: number, scale: number): LoftSection {
    const bend = 1 - (1 - amount) ** 3;

    return {
      centerX: x + leanX * bend,
      centerZ: z + leanZ * bend,
      radiusX: radius * scale,
      radiusZ: radius * scale,
      ripple,
      y: height * amount,
    };
  }

  return [
    { ...at(0, 1.08), y: -0.05 },
    at(0.45, 1),
    at(0.84, 0.97),
    at(0.93, 0.82),
    at(0.98, 0.5),
    { centerX: x + leanX, centerZ: z + leanZ, radiusX: 0, radiusZ: 0, y: height },
  ];
}

function addColumn(builder: MeshBuilder, column: Column, detail: CactusDetail): void {
  builder.add(loft(columnSections(column, detail.ribs), detail.segments), {
    seam: column.radius * STEM_SEAM,
    style: { shade: stemShade(column.height) },
  });
}

function addFlowerCrown(builder: MeshBuilder, center: Vector3, ringRadius: number, count: number, size: number): void {
  const flowerShape = sphere(size, 6, 4);

  for (let flower = 0; flower < count; flower += 1) {
    const angle = (flower / count) * FULL_TURN;

    builder.add(flowerShape, {
      style: { shade: 1, slot: MaterialSlot.Blossom },
      transform: transformOf({
        position: [center.x + Math.cos(angle) * ringRadius, center.y, center.z + Math.sin(angle) * ringRadius],
        scale: [1, 0.7, 1],
      }),
    });
  }
}

function saguaroArm(start: number, angle: number, trunkRadius: number, random: RandomSource): TubePoint[] {
  const reach = random.between(0.45, 0.7);
  const rise = random.between(0.8, 1.5);
  const radius = trunkRadius * random.between(0.58, 0.68);
  const outward = new Vector3(Math.cos(angle), 0, Math.sin(angle));

  function point(distance: number, lift: number, scale: number): TubePoint {
    const position = outward.clone().multiplyScalar(distance);

    return { radius: radius * scale, x: position.x, y: start + lift, z: position.z };
  }

  return [
    point(trunkRadius * 0.3, -0.05, 1),
    point(trunkRadius + reach * 0.6, 0.02, 1),
    point(trunkRadius + reach, 0.28, 0.98),
    point(trunkRadius + reach * 1.05, rise * 0.65, 0.96),
    point(trunkRadius + reach * 1.05, rise - radius * 0.4, 0.8),
    point(trunkRadius + reach * 1.05, rise + radius * 0.15, 0.42),
    point(trunkRadius + reach * 1.05, rise + radius * 0.4, 0),
  ];
}

function addSaguaro(builder: MeshBuilder, random: RandomSource, detail: CactusDetail): void {
  const height = random.between(3.5, 4.3);
  const radius = random.between(0.28, 0.34);

  addColumn(
    builder,
    { height, leanX: random.signed() * 0.08, leanZ: random.signed() * 0.08, radius, x: 0, z: 0 },
    detail
  );

  const arms = random.integer(1, 4);
  const firstAngle = random.next() * FULL_TURN;

  for (let arm = 0; arm < arms; arm += 1) {
    const angle = firstAngle + (arm / arms) * FULL_TURN + random.signed() * 0.4;
    const points = saguaroArm(random.between(1.2, 2.3), angle, radius, random);
    const kept = detail.ribs === 0 ? thinned(points) : points;

    builder.add(tube(kept, { hasEndCap: false, radialSegments: Math.max(4, detail.segments - 4) }), {
      seam: radius * STEM_SEAM,
      style: { shade: 0.95 },
    });
  }

  if (detail.hasFlowers) {
    addFlowerCrown(builder, new Vector3(0, height - 0.04, 0), radius * 0.4, 4, 0.065);
  }
}

function addOrganPipe(builder: MeshBuilder, random: RandomSource, detail: CactusDetail): void {
  const stems = random.integer(5, 9);
  const stemDetail = { ...detail, segments: Math.max(5, detail.segments - 3) };

  for (let stem = 0; stem < stems; stem += 1) {
    const angle = (stem / stems) * FULL_TURN + random.signed() * 0.3;
    const lean = stem === 0 ? 0 : random.between(0.25, 0.5);

    const column: Column = {
      height: stem === 0 ? random.between(3.1, 3.7) : random.between(1.7, 3.3),
      leanX: Math.cos(angle) * lean,
      leanZ: Math.sin(angle) * lean,
      radius: random.between(0.16, 0.21),
      x: stem === 0 ? 0 : Math.cos(angle) * 0.14,
      z: stem === 0 ? 0 : Math.sin(angle) * 0.14,
    };

    if (stem < detail.maximumStems) {
      addColumn(builder, column, stemDetail);
    }
  }
}

function barrelSections(height: number, radius: number, ribs: number): LoftSection[] {
  const ripple = ribbed(ribs, 0.14);

  return [
    { radiusX: radius * 0.86, radiusZ: radius * 0.86, ripple, y: -0.06 },
    { radiusX: radius, radiusZ: radius, ripple, y: height * 0.3 },
    { radiusX: radius * 0.96, radiusZ: radius * 0.96, ripple, y: height * 0.68 },
    { radiusX: radius * 0.72, radiusZ: radius * 0.72, ripple, y: height * 0.9 },
    { radiusX: radius * 0.34, radiusZ: radius * 0.34, ripple, y: height },
    { radiusX: 0, radiusZ: 0, y: height * 0.97 },
  ];
}

function addBarrel(builder: MeshBuilder, random: RandomSource, detail: CactusDetail): void {
  const barrels = random.integer(2, 5);

  for (let index = 0; index < barrels; index += 1) {
    const height = index === 0 ? random.between(1, 1.35) : random.between(0.45, 0.85);
    const radius = height * random.between(0.38, 0.46);
    const angle = random.next() * FULL_TURN;
    const offset = index === 0 ? 0 : random.between(0.5, 0.7);
    const position = new Vector3(Math.cos(angle) * offset, 0, Math.sin(angle) * offset);

    if (index >= detail.maximumStems) {
      continue;
    }

    builder.add(loft(barrelSections(height, radius, detail.ribs === 0 ? 0 : detail.ribs + 4), detail.segments + 2), {
      seam: radius * STEM_SEAM,
      style: { shade: stemShade(height) },
      transform: transformOf({ position: position.toArray() }),
    });

    if (detail.hasFlowers) {
      addFlowerCrown(builder, position.clone().setY(height * 0.98), radius * 0.24, 5, 0.085);
    }
  }
}

function padTransform(pad: Pad): Matrix4 {
  return transformOf({
    position: pad.center.toArray(),
    rotation: [0, pad.turn, pad.tilt],
    scale: [pad.size, pad.size * PAD_STRETCH, pad.size * PAD_THICKNESS],
  });
}

function padRim(pad: Pad, angle: number): Vector3 {
  const local = new Vector3(Math.sin(angle) * pad.size, Math.cos(angle) * pad.size * PAD_STRETCH, 0);

  return local.applyMatrix4(transformOf({ rotation: [0, pad.turn, pad.tilt] })).add(pad.center);
}

function childPad(parent: Pad, random: RandomSource): Pad {
  const rimAngle = random.signed() * 1.25;
  const size = parent.size * random.between(0.78, 0.92);
  const tilt = parent.tilt - rimAngle * 0.9;
  const turn = parent.turn + random.signed() * 0.7;
  const upward = new Vector3(0, 1, 0).applyMatrix4(transformOf({ rotation: [0, turn, tilt] }));

  return {
    center: padRim(parent, rimAngle).addScaledVector(upward, size * PAD_STRETCH * PAD_ROOTING),
    size,
    tilt,
    turn,
  };
}

function addPricklyPear(builder: MeshBuilder, random: RandomSource, detail: CactusDetail): void {
  const bases = random.integer(2, 4);
  const pads: Pad[] = [];
  const tips: Pad[] = [];

  for (let base = 0; base < bases; base += 1) {
    const size = random.between(0.27, 0.33);

    const pad: Pad = {
      center: new Vector3(random.signed() * 0.3, size * PAD_STRETCH * 0.85, random.signed() * 0.3),
      size,
      tilt: random.signed() * 0.6,
      turn: (base / bases) * Math.PI + random.signed() * 0.3,
    };

    pads.push(pad);
    tips.push(pad);
  }

  for (let layer = 0; layer < 2; layer += 1) {
    const grown = tips.splice(0).flatMap((parent) => {
      const count = random.chance(0.4) ? 2 : 1;

      return Array.from({ length: count }, () => {
        return childPad(parent, random);
      });
    });

    pads.push(...grown);
    tips.push(...grown);
  }

  const segments = Math.max(5, detail.segments - 4);
  const padShape = sphere(1, segments, Math.max(4, Math.floor(segments * 0.6)));

  for (const pad of pads.slice(0, detail.maximumStems * 2)) {
    builder.add(padShape, {
      seam: PAD_SEAM,
      style: { shade: stemShade(1.6) },
      transform: padTransform(pad),
    });
  }

  if (!detail.hasFlowers) {
    return;
  }

  for (const pad of tips) {
    for (const rimAngle of [-0.5, 0, 0.5]) {
      if (random.chance(0.4)) {
        continue;
      }

      const isFruit = random.chance(0.5);

      builder.add(sphere(isFruit ? 0.055 : 0.07, 6, 4), {
        style: { shade: 1, slot: isFruit ? MaterialSlot.Berry : MaterialSlot.Blossom },
        transform: transformOf({ position: padRim(pad, rimAngle).toArray(), scale: [1, isFruit ? 1.3 : 0.7, 1] }),
      });
    }
  }
}

export function cactusForm(variant: number): CactusForm {
  return CACTUS_FORMS[variant % CACTUS_FORMS.length];
}

export function meshCactus(seed: number, level: PlantDetailLevel, form: CactusForm): MeshData {
  const builder = new MeshBuilder({ slot: MaterialSlot.Cactus });

  FORM_BUILDERS[form](builder, createRandom(seed), CACTUS_DETAILS[level]);

  return builder.build();
}
