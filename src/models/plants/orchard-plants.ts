import { Vector3 } from "three";
import { CultivatedSpecies } from "../../content/cultivated-plants.ts";
import type { PlantSpeciesIndex } from "../../content/plants.ts";
import { FULL_TURN, lerp, smoothstep } from "../../shared/math.ts";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { thinned } from "../level-of-detail.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { withoutBuriedOverlaps, withoutBuriedTriangles } from "../mesh/buried-triangles.ts";
import { MeshBuilder, type VertexStyle } from "../mesh/mesh-builder.ts";
import { type MeshData, mergeMeshes } from "../mesh/mesh-data.ts";
import type { Shape } from "../mesh/shape.ts";
import { blob, icosphere, lathe, pointAlong, sphere, type TubePoint, tube } from "../mesh/shapes.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { transformOf } from "../mesh/transforms.ts";
import { BERRY_PART } from "./berries.ts";
import { addBlob, addLimb, addTrunk, BLOB_TINT, createGrowth, finish, type Growth } from "./tree-growth.ts";
import {
  BROADLEAF_LOOK,
  FOLIAGE_FLUTTER,
  foliageStyle,
  meshTree,
  type PlantDetailLevel,
  plantSway,
} from "./tree-mesher.ts";
import {
  type FoliageBlob,
  GOLDEN_ANGLE,
  growBranch,
  jitter,
  type TreeStructure,
  tiltedDirection,
  tipOf,
  toVector,
} from "./tree-structure.ts";

export const ORCHARD_HEIGHTS = {
  [CultivatedSpecies.AppleTree]: 5.5,
  [CultivatedSpecies.Blueberry]: 0.75,
  [CultivatedSpecies.Currant]: 1.4,
  [CultivatedSpecies.PearTree]: 6.8,
  [CultivatedSpecies.PlumTree]: 5,
  [CultivatedSpecies.Raspberry]: 1.65,
} as const satisfies Readonly<Partial<Record<PlantSpeciesIndex, number>>>;

export const ORCHARD_VARIANT_COUNTS = {
  [CultivatedSpecies.AppleTree]: 3,
  [CultivatedSpecies.Blueberry]: 3,
  [CultivatedSpecies.Currant]: 3,
  [CultivatedSpecies.PearTree]: 3,
  [CultivatedSpecies.PlumTree]: 3,
  [CultivatedSpecies.Raspberry]: 3,
} as const satisfies Readonly<Partial<Record<PlantSpeciesIndex, number>>>;

const TRUNK_SEGMENTS = 3;
const STEM_SIDES = 3;
const STEM_WIDENING = 1.18;
const HANGING_STEP = 1.45;
const FRUIT_SINK = 0.4;
const PEAR_CENTER = 0.72;
const ORCHARD_SPECIES: ReadonlySet<number> = new Set(Object.keys(ORCHARD_HEIGHTS).map(Number));
const LEAF_NOISE = createVolumeNoise(createRandom(7171));
const GROUNDED_ENVELOPE = 0.8;

type OrchardSpecies = keyof typeof ORCHARD_HEIGHTS;

type FruitShape = "pear" | "round";

type FruitDetail = Exclude<PlantDetailLevel, "far" | "low">;

interface Tessellation {
  readonly rings: number;
  readonly segments: number;
}

const ROUND_FRUIT: Tessellation = { rings: 3, segments: 5 };
const POINTED_BERRY: Tessellation = { rings: 2, segments: 5 };
const SQUARE_BERRY: Tessellation = { rings: 3, segments: 4 };
const DISTANT_BERRY: Tessellation = { rings: 2, segments: 4 };
const TREE_FRUIT: Readonly<Record<FruitDetail, Tessellation>> = { high: ROUND_FRUIT, medium: ROUND_FRUIT };
const ROUND_BERRY: Readonly<Record<FruitDetail, Tessellation>> = { high: ROUND_FRUIT, medium: DISTANT_BERRY };

interface FruitLook {
  readonly counts: Readonly<Record<FruitDetail, number>>;
  readonly hanging: number;
  readonly highest: number;
  readonly lowest: number;
  readonly radius: number;
  readonly shape: FruitShape;
  readonly slot: MaterialSlotIndex;
  readonly tessellation: Readonly<Record<FruitDetail, Tessellation>>;
}

const FRUIT_LOOKS: Readonly<Record<OrchardSpecies, FruitLook>> = {
  [CultivatedSpecies.AppleTree]: {
    counts: { high: 34, medium: 14 },
    hanging: 0,
    highest: 0.55,
    lowest: -0.7,
    radius: 0.1,
    shape: "round",
    slot: MaterialSlot.Apple,
    tessellation: TREE_FRUIT,
  },
  [CultivatedSpecies.Blueberry]: {
    counts: { high: 30, medium: 12 },
    hanging: 0,
    highest: 0.9,
    lowest: -0.2,
    radius: 0.04,
    shape: "round",
    slot: MaterialSlot.Blueberry,
    tessellation: { high: POINTED_BERRY, medium: DISTANT_BERRY },
  },
  [CultivatedSpecies.Currant]: {
    counts: { high: 16, medium: 8 },
    hanging: 3,
    highest: 0.3,
    lowest: -0.7,
    radius: 0.045,
    shape: "round",
    slot: MaterialSlot.Currant,
    tessellation: { high: SQUARE_BERRY, medium: DISTANT_BERRY },
  },
  [CultivatedSpecies.PearTree]: {
    counts: { high: 26, medium: 12 },
    hanging: 0,
    highest: 0.4,
    lowest: -0.75,
    radius: 0.085,
    shape: "pear",
    slot: MaterialSlot.Pear,
    tessellation: TREE_FRUIT,
  },
  [CultivatedSpecies.PlumTree]: {
    counts: { high: 40, medium: 16 },
    hanging: 0,
    highest: 0.6,
    lowest: -0.75,
    radius: 0.065,
    shape: "round",
    slot: MaterialSlot.Plum,
    tessellation: TREE_FRUIT,
  },
  [CultivatedSpecies.Raspberry]: {
    counts: { high: 22, medium: 10 },
    hanging: 0,
    highest: 0.7,
    lowest: -0.5,
    radius: 0.05,
    shape: "round",
    slot: MaterialSlot.Raspberry,
    tessellation: ROUND_BERRY,
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

type FruitTreeSpecies =
  | typeof CultivatedSpecies.AppleTree
  | typeof CultivatedSpecies.PearTree
  | typeof CultivatedSpecies.PlumTree;

type BushSpecies = Exclude<OrchardSpecies, FruitTreeSpecies>;

const FRUIT_TREE_GENERATORS: Readonly<Record<FruitTreeSpecies, (seed: number) => TreeStructure>> = {
  [CultivatedSpecies.AppleTree]: apple,
  [CultivatedSpecies.PearTree]: pear,
  [CultivatedSpecies.PlumTree]: plum,
};

const BUSH_GENERATORS: Readonly<Record<BushSpecies, (seed: number) => BushStructure>> = {
  [CultivatedSpecies.Blueberry]: blueberry,
  [CultivatedSpecies.Currant]: currant,
  [CultivatedSpecies.Raspberry]: raspberry,
};

interface FruitHost {
  readonly center: Vector3;
  readonly squash: number;
}

interface FruitPlacement {
  readonly detail: FruitDetail;
  readonly height: number;
  readonly hosts: readonly FruitHost[];
  readonly look: FruitLook;
  readonly seed: number;
}

function growStem(growth: Growth, azimuth: number, options: StemOptions): TubePoint[] {
  const { random } = growth;

  const direction = tiltedDirection(azimuth, options.tilt);

  return growBranch({
    bend: 0.04,
    direction,
    gravity: options.gravity,
    length: options.length,
    noise: growth.noise,
    radiusEnd: options.radiusEnd,
    radiusStart: options.radiusStart,
    segments: 4,
    start: new Vector3(jitter(random, options.spread), 0, jitter(random, options.spread)),
    wobble: options.wobble,
  });
}

function apple(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const trunk = addTrunk(growth, {
    height: random.between(1.3, 1.75),
    isForked: true,
    lean: random.between(0.03, 0.15),
    radiusBottom: 0.245,
    radiusTop: 0.17,
    segments: TRUNK_SEGMENTS,
    wobble: 0.3,
  });

  const limbCount = random.integer(4, 6);

  for (let limb = 0; limb < limbCount; limb += 1) {
    const azimuth = limb * GOLDEN_ANGLE + jitter(random, 0.4);

    const main = addLimb(growth, trunk, random.between(0.75, 1), azimuth, {
      bend: 0.09,
      depth: 1,
      gravity: 0.08,
      length: random.between(1.7, 2.1),
      radiusEnd: 0.05,
      segments: 4,
      tilt: random.between(0.65, 0.95),
      wobble: 0.4,
    });

    const twig = addLimb(growth, main, random.between(0.45, 0.8), random.next() * FULL_TURN, {
      bend: 0.1,
      depth: 2,
      gravity: 0.06,
      length: random.between(0.7, 1),
      radiusEnd: 0.02,
      segments: 3,
      tilt: random.between(0.5, 0.9),
      wobble: 0.35,
    });

    addBlob(growth, toVector(tipOf(twig)), random.between(0.8, 1), 0.8);
    addBlob(growth, toVector(tipOf(main)), random.between(0.95, 1.15), 0.78);
  }

  addBlob(growth, toVector(tipOf(trunk)).add(new Vector3(0, 2.5, 0)), random.between(1.3, 1.5), 0.75);

  return finish(growth, ORCHARD_HEIGHTS[CultivatedSpecies.AppleTree]);
}

function pear(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const trunk = addTrunk(growth, {
    height: random.between(1.6, 2.1),
    isForked: false,
    lean: random.between(0, 0.06),
    radiusBottom: 0.225,
    radiusTop: 0.15,
    segments: TRUNK_SEGMENTS,
    wobble: 0.15,
  });

  const leader = addLimb(growth, trunk, 1, 0, {
    bend: 0.02,
    depth: 1,
    gravity: 0,
    length: random.between(3.3, 3.9),
    radiusEnd: 0.04,
    segments: 4,
    tilt: 0.06,
    wobble: 0.15,
  });

  const limbCount = random.integer(5, 7);

  for (let limb = 0; limb < limbCount; limb += 1) {
    const along = lerp(0.12, 0.78, limb / limbCount) + jitter(random, 0.04);

    const side = addLimb(growth, leader, along, limb * GOLDEN_ANGLE + jitter(random, 0.3), {
      bend: 0.08,
      depth: 2,
      gravity: 0.04,
      length: random.between(1.3, 1.8) * (1.15 - along * 0.55),
      radiusEnd: 0.025,
      segments: 3,
      tilt: random.between(0.45, 0.7),
      wobble: 0.25,
    });

    addBlob(growth, toVector(tipOf(side)), random.between(0.75, 0.95), 1.15);
  }

  addBlob(growth, toVector(tipOf(leader)).add(new Vector3(0, 0.25, 0)), random.between(0.8, 0.95), 1.2);

  return finish(growth, ORCHARD_HEIGHTS[CultivatedSpecies.PearTree]);
}

function plum(seed: number): TreeStructure {
  const growth = createGrowth(seed);

  const { random } = growth;

  const trunk = addTrunk(growth, {
    height: random.between(1.05, 1.4),
    isForked: true,
    lean: random.between(0.03, 0.15),
    radiusBottom: 0.205,
    radiusTop: 0.15,
    segments: TRUNK_SEGMENTS,
    wobble: 0.3,
  });

  const limbCount = random.integer(5, 7);

  for (let limb = 0; limb < limbCount; limb += 1) {
    const azimuth = limb * GOLDEN_ANGLE + jitter(random, 0.35);

    const main = addLimb(growth, trunk, random.between(0.7, 1), azimuth, {
      bend: 0.09,
      depth: 1,
      gravity: 0.05,
      length: random.between(1.8, 2.2),
      radiusEnd: 0.04,
      segments: 4,
      tilt: random.between(0.5, 0.8),
      wobble: 0.35,
    });

    addBlob(growth, toVector(tipOf(main)), random.between(0.8, 1), 0.88);
  }

  addBlob(growth, toVector(tipOf(trunk)).add(new Vector3(0, 2.5, 0)), random.between(1.1, 1.3), 0.85);

  return finish(growth, ORCHARD_HEIGHTS[CultivatedSpecies.PlumTree]);
}

function createBushGrowth(seed: number): BushGrowth {
  return { ...createGrowth(seed), leaves: [], stems: [] };
}

function addLeaf(growth: BushGrowth, center: Vector3, radius: number, squash: number): void {
  growth.leaves.push({ center, radius, squash, tint: jitter(growth.random, BLOB_TINT) });
}

function addBushStem(growth: BushGrowth, azimuth: number, options: StemOptions): TubePoint[] {
  const points = growStem(growth, azimuth, options);

  growth.stems.push(points);

  return points;
}

function finishBush(growth: BushGrowth, species: OrchardSpecies): BushStructure {
  return { height: ORCHARD_HEIGHTS[species], leaves: growth.leaves, stems: growth.stems };
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

export function isOrchardModel(species: number): species is OrchardSpecies {
  return ORCHARD_SPECIES.has(species);
}

function fruitShape(look: FruitLook, detail: FruitDetail): Shape {
  const { rings, segments } = look.tessellation[detail];

  if (look.shape === "round") {
    return sphere(look.radius, segments, rings);
  }

  const { radius } = look;

  return lathe(
    [
      { radius: 0, y: 0 },
      { radius: radius * 0.75, y: radius * 0.18 },
      { radius, y: radius * 0.7 },
      { radius: radius * 0.78, y: radius * 1.35 },
      { radius: radius * 0.42, y: radius * 1.85 },
      { radius: 0, y: radius * 2.2 },
    ],
    segments
  );
}

function fruitLift(look: FruitLook): number {
  if (look.shape === "pear") {
    return -look.radius * 2.2 * PEAR_CENTER;
  }

  return 0;
}

function fruitMeshes(plant: MeshData, placement: FruitPlacement): MeshData[] {
  const { hosts, look } = placement;

  const random = createRandom(placement.seed);
  const shape = fruitShape(look, placement.detail);
  const lift = fruitLift(look);
  const style: VertexStyle = {
    sway: (point) => {
      return plantSway(point.position.y, placement.height);
    },
  };
  const fruits: MeshData[] = [];

  function isFoliage(triangle: number): boolean {
    return plant.channels.slot[plant.indices[triangle * 3]] === MaterialSlot.Leaf;
  }

  for (let fruit = 0; fruit < look.counts[placement.detail]; fruit += 1) {
    const host = random.pick(hosts);
    const angle = random.next() * FULL_TURN;
    const height = random.between(look.lowest, look.highest);
    const horizontal = Math.sqrt(1 - height * height);
    const outward = new Vector3(Math.cos(angle) * horizontal, height * host.squash, Math.sin(angle) * horizontal);

    const hit = outermostHit(plant, host.center, outward, isFoliage);

    if (hit === null) {
      continue;
    }

    const center = hit.point.clone().addScaledVector(outward.normalize(), -look.radius * FRUIT_SINK);

    for (let link = 0; link <= look.hanging; link += 1) {
      const drop = link * look.radius * HANGING_STEP;
      const builder = new MeshBuilder({ flutter: FOLIAGE_FLUTTER, part: BERRY_PART, slot: look.slot });

      builder.add(shape, {
        style,
        transform: transformOf({ position: [center.x, center.y + lift - drop, center.z] }),
      });

      fruits.push(builder.build());
    }
  }

  return fruits;
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

function leafShape(leaf: BushLeaf, level: PlantDetailLevel): Shape {
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

function stemPoints(stem: readonly TubePoint[], level: PlantDetailLevel): TubePoint[] {
  if (level === "high") {
    return stem.map((point) => {
      return { ...point, radius: point.radius * STEM_WIDENING };
    });
  }

  return thinned(stem);
}

function bushStems(structure: BushStructure, level: PlantDetailLevel): MeshData {
  const builder = new MeshBuilder();
  const style = stemStyle(structure);

  for (const stem of structure.stems) {
    builder.add(tube(stemPoints(stem, level), { radialSegments: STEM_SIDES }), { style });
  }

  return builder.build();
}

function bushLeaf(structure: BushStructure, leaf: BushLeaf, level: PlantDetailLevel): MeshData {
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

function fruitDetail(level: PlantDetailLevel): FruitDetail | null {
  if (level === "high" || level === "medium") {
    return level;
  }

  return null;
}

function isFruitTree(species: OrchardSpecies): species is FruitTreeSpecies {
  return (
    species === CultivatedSpecies.AppleTree ||
    species === CultivatedSpecies.PearTree ||
    species === CultivatedSpecies.PlumTree
  );
}

function meshFruitTree(species: FruitTreeSpecies, seed: number, level: PlantDetailLevel): MeshData {
  const structure = FRUIT_TREE_GENERATORS[species](seed);
  const tree = meshTree(structure, BROADLEAF_LOOK, level);

  const detail = fruitDetail(level);

  if (detail === null) {
    return tree;
  }

  const hosts = structure.foliage
    .filter((foliage): foliage is FoliageBlob => {
      return foliage.kind === "blob";
    })
    .map((foliage) => {
      return { center: new Vector3(...foliage.center), squash: foliage.squash };
    });

  const fruit = fruitMeshes(tree, {
    detail,
    height: structure.height,
    hosts,
    look: FRUIT_LOOKS[species],
    seed: seed + 1,
  });

  return mergeMeshes([tree, ...fruit]);
}

function meshBerryBush(species: BushSpecies, seed: number, level: PlantDetailLevel): MeshData {
  const structure = BUSH_GENERATORS[species](seed);

  const detail = fruitDetail(level);

  if (detail === null) {
    return distantBush(structure);
  }

  const stems = bushStems(structure, level);
  const leaves = structure.leaves.map((leaf) => {
    return bushLeaf(structure, leaf, level);
  });

  const berries = fruitMeshes(mergeMeshes([stems, ...leaves]), {
    detail,
    height: structure.height,
    hosts: structure.leaves,
    look: FRUIT_LOOKS[species],
    seed: seed + 1,
  });

  const shownBerries = berries.map((berry, index) => {
    return withoutBuriedTriangles(berry, [...leaves, ...othersThan(berries, index)]);
  });

  return mergeMeshes([stems, ...withoutBuriedOverlaps(leaves), ...shownBerries]);
}

export function meshOrchardPlant(species: OrchardSpecies, seed: number, level: PlantDetailLevel): MeshData {
  if (isFruitTree(species)) {
    return meshFruitTree(species, seed, level);
  }

  return meshBerryBush(species, seed, level);
}
