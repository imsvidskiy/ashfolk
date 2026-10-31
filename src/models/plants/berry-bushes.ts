import { Vector3 } from "three";
import { CultivatedSpecies } from "../../content/cultivated-plants.ts";
import type { PlantSpeciesIndex } from "../../content/plants.ts";
import { FULL_TURN, smoothstep } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { thinned } from "../level-of-detail.ts";
import { MaterialSlot } from "../materials.ts";
import { withoutBuriedOverlaps, withoutBuriedTriangles } from "../mesh/buried-triangles.ts";
import { MeshBuilder, type VertexStyle } from "../mesh/mesh-builder.ts";
import { type MeshData, mergeMeshes } from "../mesh/mesh-data.ts";
import type { Shape } from "../mesh/shape.ts";
import { blob, icosphere } from "../mesh/shapes.ts";
import { transformOf } from "../mesh/transforms.ts";
import { pointAlong, type TubePoint, tube } from "../mesh/tubes.ts";
import { DISTANT_BERRY, type FruitLook, fruitMeshes, ROUND_FRUIT } from "./orchard-fruit.ts";
import { BLOB_TINT, createGrowth, type Growth } from "./tree-growth.ts";
import {
  BROADLEAF_LOOK,
  foliageStyle,
  isDistantLevel,
  type NearLevel,
  type PlantDetailLevel,
  plantSway,
} from "./tree-mesher.ts";
import { GOLDEN_ANGLE, growBranch, jitter, tiltedDirection, tipOf, toVector } from "./tree-structure.ts";

export const BERRY_BUSH_HEIGHTS = {
  [CultivatedSpecies.Blueberry]: 0.75,
  [CultivatedSpecies.Currant]: 1.4,
  [CultivatedSpecies.Raspberry]: 1.65,
} as const satisfies Readonly<Partial<Record<PlantSpeciesIndex, number>>>;

const STEM_SIDES = 3;
const STEM_WIDENING = 1.18;
const LEAF_NOISE = createVolumeNoise(createRandom(7171));
const GROUNDED_ENVELOPE = 0.8;

export type BerryBushSpecies = keyof typeof BERRY_BUSH_HEIGHTS;

const BERRY_LOOKS: Readonly<Record<BerryBushSpecies, FruitLook>> = {
  [CultivatedSpecies.Blueberry]: {
    counts: { high: 30, medium: 12 },
    hanging: 0,
    highest: 0.9,
    lowest: -0.2,
    radius: 0.04,
    shape: "round",
    slot: MaterialSlot.Blueberry,
    tessellation: { high: { rings: 2, segments: 5 }, medium: DISTANT_BERRY },
  },
  [CultivatedSpecies.Currant]: {
    counts: { high: 16, medium: 8 },
    hanging: 3,
    highest: 0.3,
    lowest: -0.7,
    radius: 0.045,
    shape: "round",
    slot: MaterialSlot.Currant,
    tessellation: { high: { rings: 3, segments: 4 }, medium: DISTANT_BERRY },
  },
  [CultivatedSpecies.Raspberry]: {
    counts: { high: 22, medium: 10 },
    hanging: 0,
    highest: 0.7,
    lowest: -0.5,
    radius: 0.05,
    shape: "round",
    slot: MaterialSlot.Raspberry,
    tessellation: { high: ROUND_FRUIT, medium: DISTANT_BERRY },
  },
};

interface StemOptions {
  readonly gravity: number;
  readonly length: number;
  readonly radiusEnd: number;
  readonly radiusStart: number;
  readonly spread: number;
  readonly tilt: number;
  readonly wobble: number;
}

interface BushLeaf {
  readonly center: Vector3;
  readonly radius: number;
  readonly squash: number;
  readonly tint: number;
}

interface BushStructure {
  readonly height: number;
  readonly leaves: readonly BushLeaf[];
  readonly stems: readonly (readonly TubePoint[])[];
}

interface BushGrowth extends Growth {
  readonly leaves: BushLeaf[];
  readonly stems: TubePoint[][];
}

const BUSH_GENERATORS: Readonly<Record<BerryBushSpecies, (seed: number) => BushStructure>> = {
  [CultivatedSpecies.Blueberry]: blueberry,
  [CultivatedSpecies.Currant]: currant,
  [CultivatedSpecies.Raspberry]: raspberry,
};

function createBushGrowth(seed: number): BushGrowth {
  return { ...createGrowth(seed), leaves: [], stems: [] };
}

function addLeaf(growth: BushGrowth, center: Vector3, radius: number, squash: number): void {
  growth.leaves.push({ center, radius, squash, tint: jitter(growth.random, BLOB_TINT) });
}

function addBushStem(growth: BushGrowth, azimuth: number, options: StemOptions): TubePoint[] {
  const { random } = growth;

  const points = growBranch({
    bend: 0.04,
    direction: tiltedDirection(azimuth, options.tilt),
    gravity: options.gravity,
    length: options.length,
    noise: growth.noise,
    radiusEnd: options.radiusEnd,
    radiusStart: options.radiusStart,
    segments: 4,
    start: new Vector3(jitter(random, options.spread), 0, jitter(random, options.spread)),
    wobble: options.wobble,
  });

  growth.stems.push(points);

  return points;
}

function finishBush(growth: BushGrowth, species: BerryBushSpecies): BushStructure {
  return { height: BERRY_BUSH_HEIGHTS[species], leaves: growth.leaves, stems: growth.stems };
}

function raspberry(seed: number): BushStructure {
  const growth = createBushGrowth(seed);

  const { random } = growth;

  const canes = random.integer(6, 9);

  for (let cane = 0; cane < canes; cane += 1) {
    const points = addBushStem(growth, cane * GOLDEN_ANGLE + jitter(random, 0.4), {
      gravity: random.between(0.14, 0.22),
      length: random.between(1.25, 1.55),
      radiusEnd: 0.009,
      radiusStart: 0.022,
      spread: 0.12,
      tilt: random.between(0.03, 0.12),
      wobble: 0.16,
    });

    addLeaf(growth, toVector(pointAlong(points, 0.55)), random.between(0.14, 0.18), 0.8);
    addLeaf(growth, toVector(tipOf(points)), random.between(0.17, 0.22), 0.78);
  }

  return finishBush(growth, CultivatedSpecies.Raspberry);
}

function blueberry(seed: number): BushStructure {
  const growth = createBushGrowth(seed);

  const { random } = growth;

  const stems = random.integer(7, 10);

  for (let stem = 0; stem < stems; stem += 1) {
    const points = addBushStem(growth, (stem / stems) * FULL_TURN + jitter(random, 0.4), {
      gravity: 0.12,
      length: random.between(0.42, 0.58),
      radiusEnd: 0.008,
      radiusStart: 0.018,
      spread: 0.08,
      tilt: random.between(0.75, 1.1),
      wobble: 0.3,
    });

    addLeaf(growth, toVector(tipOf(points)), random.between(0.21, 0.28), 0.7);
  }

  addLeaf(growth, new Vector3(jitter(random, 0.05), random.between(0.38, 0.44), jitter(random, 0.05)), 0.34, 0.72);

  return finishBush(growth, CultivatedSpecies.Blueberry);
}

function currant(seed: number): BushStructure {
  const growth = createBushGrowth(seed);

  const { random } = growth;

  const stems = random.integer(5, 7);

  for (let stem = 0; stem < stems; stem += 1) {
    const points = addBushStem(growth, (stem / stems) * FULL_TURN + jitter(random, 0.5), {
      gravity: 0.14,
      length: random.between(0.95, 1.2),
      radiusEnd: 0.012,
      radiusStart: 0.03,
      spread: 0.08,
      tilt: random.between(0.14, 0.3),
      wobble: 0.25,
    });

    addLeaf(growth, toVector(pointAlong(points, 0.55)), random.between(0.2, 0.24), 0.85);
    addLeaf(growth, toVector(tipOf(points)), random.between(0.26, 0.32), 0.85);
  }

  addLeaf(growth, new Vector3(0, random.between(0.72, 0.82), 0), random.between(0.34, 0.4), 0.85);

  return finishBush(growth, CultivatedSpecies.Currant);
}

function stemStyle(structure: BushStructure): VertexStyle {
  return {
    shade: (point) => {
      return 0.7 + 0.3 * smoothstep(0, structure.height * 0.4, point.position.y);
    },
    slot: MaterialSlot.Wood,
    sway: (point) => {
      return plantSway(point.position.y, structure.height);
    },
  };
}

function leafShape(leaf: BushLeaf, level: NearLevel): Shape {
  if (level !== "high") {
    return icosphere(leaf.radius, 0);
  }

  const { x, y, z } = leaf.center;

  return blob({
    detail: 1,
    noise: LEAF_NOISE,
    offset: [x * 2.3, y * 2.9, z * 2.1],
    radius: leaf.radius,
    roughness: 0.25,
  });
}

function envelopeLeaf(structure: BushStructure): BushLeaf {
  const minimum = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const maximum = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  for (const leaf of structure.leaves) {
    const extent = new Vector3(leaf.radius, leaf.radius * leaf.squash, leaf.radius);

    minimum.min(leaf.center.clone().sub(extent));
    maximum.max(leaf.center.clone().add(extent));
  }

  const radius = Math.max(maximum.x - minimum.x, maximum.z - minimum.z) / 2;
  const halfHeight = maximum.y / 2;

  return {
    center: new Vector3((minimum.x + maximum.x) / 2, halfHeight * GROUNDED_ENVELOPE, (minimum.z + maximum.z) / 2),
    radius,
    squash: halfHeight / Math.max(radius, 0.001),
    tint: 0,
  };
}

function distantBush(structure: BushStructure): MeshData {
  const builder = new MeshBuilder();
  const envelope = envelopeLeaf(structure);

  builder.add(icosphere(envelope.radius, 0), {
    style: foliageStyle(structure, BROADLEAF_LOOK, envelope.tint, envelope.center),
    transform: transformOf({ position: envelope.center.toArray(), scale: [1, envelope.squash, 1] }),
  });

  return builder.build();
}

function stemPoints(stem: readonly TubePoint[], level: NearLevel): TubePoint[] {
  if (level === "high") {
    return stem.map((point) => {
      return { ...point, radius: point.radius * STEM_WIDENING };
    });
  }

  return thinned(stem);
}

function bushStems(structure: BushStructure, level: NearLevel): MeshData {
  const builder = new MeshBuilder();
  const style = stemStyle(structure);

  for (const stem of structure.stems) {
    builder.add(tube(stemPoints(stem, level), { radialSegments: STEM_SIDES }), { style });
  }

  return builder.build();
}

function bushLeaf(structure: BushStructure, leaf: BushLeaf, level: NearLevel): MeshData {
  const builder = new MeshBuilder();

  builder.add(leafShape(leaf, level), {
    style: foliageStyle(structure, BROADLEAF_LOOK, leaf.tint, leaf.center),
    transform: transformOf({ position: leaf.center.toArray(), scale: [1, leaf.squash, 1] }),
  });

  return builder.build();
}

function othersThan<Item>(items: readonly Item[], skipped: number): Item[] {
  return items.filter((_, index) => {
    return index !== skipped;
  });
}

export function meshBerryBush(species: BerryBushSpecies, seed: number, level: PlantDetailLevel): MeshData {
  const structure = BUSH_GENERATORS[species](seed);

  if (isDistantLevel(level)) {
    return distantBush(structure);
  }

  const stems = bushStems(structure, level);
  const leaves = structure.leaves.map((leaf) => {
    return bushLeaf(structure, leaf, level);
  });

  const berries = fruitMeshes(mergeMeshes([stems, ...leaves]), {
    detail: level,
    height: structure.height,
    hosts: structure.leaves,
    look: BERRY_LOOKS[species],
    seed: seed + 1,
  });

  const shownBerries = berries.map((berry, index) => {
    return withoutBuriedTriangles(berry, [...leaves, ...othersThan(berries, index)]);
  });

  return mergeMeshes([stems, ...withoutBuriedOverlaps(leaves), ...shownBerries]);
}
