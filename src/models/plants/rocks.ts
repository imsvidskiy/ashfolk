import { PlantSpecies, type PlantSpeciesIndex } from "../../content/plants.ts";
import { FULL_TURN } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom, type RandomSource } from "../../shared/random.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { MeshBuilder, type SurfacePoint } from "../mesh/mesh-builder.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { facetShape, type Shape } from "../mesh/shape.ts";
import { blob, type LoftSection, loft } from "../mesh/shapes.ts";
import { type Triple, transformOf } from "../mesh/transforms.ts";
import { addStone, type ChiselOptions, chiseledStone, groundShade, STONE_NOISE, type StoneContext } from "../stones.ts";
import type { PlantDetailLevel } from "./tree-mesher.ts";

export const ROCK_HEIGHTS = {
  [PlantSpecies.Boulder]: 1.7,
  [PlantSpecies.Sandstone]: 2.6,
} as const satisfies Readonly<Record<RockSpecies, number>>;

const BOULDER_NOISE = createVolumeNoise(createRandom(8080));
const STONE_DETAIL: Readonly<Record<PlantDetailLevel, number>> = { far: 0, high: 1, low: 0, medium: 1 };
const STRATA_SEGMENTS: Readonly<Record<PlantDetailLevel, number>> = { far: 4, high: 14, low: 6, medium: 9 };
const UP: Triple = [0, 1, 0];
const DOWN: Triple = [0, -1, 0];
const BOULDER_COMPANIONS: readonly (readonly number[])[] = [[], [0.62], [], [0.58, 0.46]];

const SANDSTONE_STRATA: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0.62, 0.6],
    [0.5, 0.55],
    [0.42, 0.5],
    [0.36, 0.45],
  ],
  [
    [1.85, 0.7],
    [1.55, 0.68],
    [1.22, 0.66],
    [0.85, 0.62],
  ],
  [
    [1.3, 0.45],
    [1.12, 0.4],
    [1.36, 0.45],
    [1.18, 0.4],
    [1.0, 0.4],
  ],
];

export const ROCK_VARIANT_COUNTS = {
  [PlantSpecies.Boulder]: BOULDER_COMPANIONS.length,
  [PlantSpecies.Sandstone]: SANDSTONE_STRATA.length,
} as const satisfies Readonly<Record<RockSpecies, number>>;

type RockSpecies = typeof PlantSpecies.Boulder | typeof PlantSpecies.Sandstone;

interface RockContext extends StoneContext {
  readonly level: PlantDetailLevel;
  readonly variant: number;
}

const ROCK_MESHERS: Readonly<Record<RockSpecies, (context: RockContext) => void>> = {
  [PlantSpecies.Boulder]: addBoulder,
  [PlantSpecies.Sandstone]: addSandstone,
};

const ROCK_SPECIES: ReadonlySet<number> = new Set(Object.keys(ROCK_MESHERS).map(Number));

interface Stratum {
  readonly bottom: number;
  readonly radius: number;
  readonly top: number;
}

function chisel(context: RockContext, options: ChiselOptions): Shape {
  return chiseledStone(context.random, options, STONE_DETAIL[context.level]);
}

function roundStone(context: RockContext, radius: number, roughness: number): Shape {
  return facetShape(
    blob({
      detail: STONE_DETAIL[context.level],
      frequency: 1.1,
      noise: BOULDER_NOISE,
      offset: [context.random.next() * 97, context.random.next() * 13, context.random.next() * 31],
      radius,
      roughness,
    })
  );
}

function addBoulder(context: RockContext): void {
  const { random, variant } = context;

  const radius = variant === 2 ? 1.35 : 1.25;
  const flatness = variant === 2 ? random.between(0.5, 0.6) : random.between(0.66, 0.84);

  addStone(
    context,
    roundStone(context, radius, 0.32),
    {
      position: [0, radius * flatness * 0.75, 0],
      rotation: [random.signed() * 0.3, random.next() * FULL_TURN, random.signed() * 0.3],
      scale: [1, flatness, random.between(0.85, 1.1)],
    },
    { lichen: 0.14, moss: 0.3 }
  );

  for (const [index, companion] of BOULDER_COMPANIONS[variant].entries()) {
    const angle = random.next() * FULL_TURN + index * 2.4;
    const reach = radius * 0.7 + companion * 0.4;
    const squash = random.between(0.62, 0.85);

    addStone(
      context,
      roundStone(context, companion, 0.3),
      {
        position: [Math.cos(angle) * reach, companion * squash * 0.7, Math.sin(angle) * reach],
        rotation: [random.signed() * 0.4, random.next() * FULL_TURN, random.signed() * 0.4],
        scale: [1, squash, random.between(0.85, 1.15)],
      },
      { lichen: 0.12, moss: 0.25 }
    );
  }
}

function strataSections(strata: readonly Stratum[], random: RandomSource): LoftSection[] {
  const [first] = strata;

  const offset = random.next() * 30;
  const last = strata.at(-1);

  if (last === undefined) {
    return [];
  }

  function ring(radius: number, y: number, centerX = 0): LoftSection {
    return {
      centerX,
      radiusX: radius,
      radiusZ: radius * 0.8,
      ripple: (around) => {
        const angle = around * FULL_TURN;

        return 1 + 0.16 * STONE_NOISE.sample(Math.cos(angle) * 1.3 + offset, Math.sin(angle) * 1.3, y * 0.6);
      },
      y,
    };
  }

  const sections: LoftSection[] = [{ radiusX: 0, radiusZ: 0, y: first.bottom - 0.05 }];

  for (const [index, stratum] of strata.entries()) {
    const thickness = stratum.top - stratum.bottom;
    const drift = (index % 2 === 0 ? 1 : -1) * 0.06;

    sections.push(
      ring(stratum.radius * 0.92, stratum.bottom, drift),
      ring(stratum.radius, stratum.bottom + thickness * 0.3, drift),
      ring(stratum.radius * 0.96, stratum.top - thickness * 0.15, drift)
    );
  }

  sections.push(ring(last.radius * 0.7, last.top), { radiusX: 0, radiusZ: 0, y: last.top + 0.04 });

  return sections;
}

function stack(bottom: number, layers: readonly (readonly [number, number])[]): Stratum[] {
  const strata: Stratum[] = [];
  let floor = bottom;

  for (const [radius, thickness] of layers) {
    strata.push({ bottom: floor, radius, top: floor + thickness });
    floor += thickness;
  }

  return strata;
}

function bandSlot(height: number, seed: number): (point: SurfacePoint) => MaterialSlotIndex {
  return (point) => {
    const { position } = point;

    const wobble = STONE_NOISE.sample(position.x * 0.8 + seed, position.z * 0.8, 3) * 0.12;
    const band = Math.floor((position.y + wobble) / height);

    return band % 2 === 0 ? MaterialSlot.Sandstone : MaterialSlot.SandstoneBand;
  };
}

function addSandstone(context: RockContext): void {
  const { builder, level, random, variant } = context;

  const strata = stack(-0.3, SANDSTONE_STRATA[variant]);
  const seed = random.next() * 20;

  builder.add(facetShape(loft(strataSections(strata, random), STRATA_SEGMENTS[level])), {
    style: { shade: groundShade(context.height), slot: bandSlot(0.32, seed) },
    transform: transformOf({ rotation: [0, random.next() * FULL_TURN, 0] }),
  });

  if (variant !== 0) {
    return;
  }

  const top = strata.at(-1);

  if (top === undefined) {
    return;
  }

  addStone(
    context,
    chisel(context, {
      cuts: 5,
      depth: 0.35,
      flats: [
        { distance: 0.34, normal: UP },
        { distance: 0.34, normal: DOWN },
      ],
      radius: 1.05,
      roughness: 0.06,
    }),
    { position: [0.08, top.top + 0.22, 0], rotation: [0.04, random.next() * FULL_TURN, -0.05], scale: [1, 0.9, 0.85] },
    { lichen: 0, moss: 0, slot: MaterialSlot.SandstoneBand }
  );
}

export function isRockModel(species: PlantSpeciesIndex): species is RockSpecies {
  return ROCK_SPECIES.has(species);
}

export function meshRock(species: RockSpecies, seed: number, variant: number, level: PlantDetailLevel): MeshData {
  const builder = new MeshBuilder();

  ROCK_MESHERS[species]({ builder, height: ROCK_HEIGHTS[species], level, random: createRandom(seed), variant });

  return builder.build();
}
