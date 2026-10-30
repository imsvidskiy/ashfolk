import { Vector3 } from "three";
import { CultivatedSpecies } from "../../content/cultivated-plants.ts";
import type { PlantSpeciesIndex } from "../../content/plants.ts";
import { FULL_TURN, lerp } from "../../shared/math.ts";
import { MaterialSlot } from "../materials.ts";
import { type MeshData, mergeMeshes } from "../mesh/mesh-data.ts";
import { BERRY_BUSH_HEIGHTS, meshBerryBush } from "./berry-bushes.ts";
import { type FruitLook, fruitMeshes, ROUND_FRUIT } from "./orchard-fruit.ts";
import { addBlob, addLimb, addTrunk, createGrowth, finish } from "./tree-growth.ts";
import { BROADLEAF_LOOK, isDistantLevel, meshTree, type PlantDetailLevel } from "./tree-mesher.ts";
import { type FoliageBlob, GOLDEN_ANGLE, jitter, type TreeStructure, tipOf, toVector } from "./tree-structure.ts";

const FRUIT_TREE_HEIGHTS = {
  [CultivatedSpecies.AppleTree]: 5.5,
  [CultivatedSpecies.PearTree]: 6.8,
  [CultivatedSpecies.PlumTree]: 5,
} as const satisfies Readonly<Partial<Record<PlantSpeciesIndex, number>>>;

export const ORCHARD_HEIGHTS = {
  ...FRUIT_TREE_HEIGHTS,
  ...BERRY_BUSH_HEIGHTS,
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
const ORCHARD_SPECIES: ReadonlySet<number> = new Set(Object.keys(ORCHARD_HEIGHTS).map(Number));

type OrchardSpecies = keyof typeof ORCHARD_HEIGHTS;

type FruitTreeSpecies = keyof typeof FRUIT_TREE_HEIGHTS;

const TREE_FRUIT = { high: ROUND_FRUIT, medium: ROUND_FRUIT };

const FRUIT_LOOKS: Readonly<Record<FruitTreeSpecies, FruitLook>> = {
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
};

const FRUIT_TREE_GENERATORS: Readonly<Record<FruitTreeSpecies, (seed: number) => TreeStructure>> = {
  [CultivatedSpecies.AppleTree]: apple,
  [CultivatedSpecies.PearTree]: pear,
  [CultivatedSpecies.PlumTree]: plum,
};

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

  return finish(growth, FRUIT_TREE_HEIGHTS[CultivatedSpecies.AppleTree]);
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

  return finish(growth, FRUIT_TREE_HEIGHTS[CultivatedSpecies.PearTree]);
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

  return finish(growth, FRUIT_TREE_HEIGHTS[CultivatedSpecies.PlumTree]);
}

export function isOrchardModel(species: number): species is OrchardSpecies {
  return ORCHARD_SPECIES.has(species);
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

  if (isDistantLevel(level)) {
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
    detail: level,
    height: structure.height,
    hosts,
    look: FRUIT_LOOKS[species],
    seed: seed + 1,
  });

  return mergeMeshes([tree, ...fruit]);
}

export function meshOrchardPlant(species: OrchardSpecies, seed: number, level: PlantDetailLevel): MeshData {
  if (isFruitTree(species)) {
    return meshFruitTree(species, seed, level);
  }

  return meshBerryBush(species, seed, level);
}
