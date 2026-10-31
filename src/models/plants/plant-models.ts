import { isMonumentPiece, PIECE_FORMS } from "../../content/monuments.ts";
import { PLANT_SPECIES, PlantSpecies, type PlantSpeciesIndex } from "../../content/plants.ts";
import { MaterialSlot } from "../materials.ts";
import { isClosed, shellsOf, withoutBuriedOverlaps, withoutBuriedTriangles } from "../mesh/buried-triangles.ts";
import { type MeshData, mergeMeshes, vertexCount } from "../mesh/mesh-data.ts";
import { MONUMENT_HEIGHTS, meshMonument } from "../structures/monuments.ts";
import { berryClusters } from "./berries.ts";
import { CACTUS_FORMS, meshCactus } from "./cacti.ts";
import { isOrchardModel, meshOrchardPlant, ORCHARD_HEIGHTS, ORCHARD_VARIANT_COUNTS } from "./orchard-plants.ts";
import { isRockModel, meshRock, ROCK_HEIGHTS, ROCK_VARIANT_COUNTS } from "./rocks.ts";
import { BROADLEAF_LOOK, isDistantLevel, meshTree, type PlantDetailLevel, type TreeLook } from "./tree-mesher.ts";
import { DESERT_SHRUB_FORM_COUNT, TREE_GENERATORS, TREE_HEIGHTS } from "./tree-species.ts";

export const PLANT_DETAIL_LEVELS: readonly PlantDetailLevel[] = ["high", "medium", "low", "far"];

const VARIANT_COUNTS: Readonly<Record<PlantSpeciesIndex, number>> = {
  ...ROCK_VARIANT_COUNTS,
  ...ORCHARD_VARIANT_COUNTS,
  [PlantSpecies.Acacia]: 3,
  [PlantSpecies.Alder]: 4,
  [PlantSpecies.Arch]: PIECE_FORMS[PlantSpecies.Arch].length,
  [PlantSpecies.Birch]: 4,
  [PlantSpecies.Bush]: 4,
  [PlantSpecies.Cairn]: PIECE_FORMS[PlantSpecies.Cairn].length,
  [PlantSpecies.Cactus]: CACTUS_FORMS.length,
  [PlantSpecies.DeadTree]: 3,
  [PlantSpecies.DesertShrub]: DESERT_SHRUB_FORM_COUNT,
  [PlantSpecies.Dolmen]: PIECE_FORMS[PlantSpecies.Dolmen].length,
  [PlantSpecies.Idol]: PIECE_FORMS[PlantSpecies.Idol].length,
  [PlantSpecies.Maple]: 4,
  [PlantSpecies.Menhir]: PIECE_FORMS[PlantSpecies.Menhir].length,
  [PlantSpecies.Oak]: 4,
  [PlantSpecies.Palm]: 2,
  [PlantSpecies.Pillar]: PIECE_FORMS[PlantSpecies.Pillar].length,
  [PlantSpecies.Pine]: 4,
  [PlantSpecies.Poplar]: 2,
  [PlantSpecies.Spruce]: 4,
  [PlantSpecies.Willow]: 4,
};

const SHAPE_SEEDS: Readonly<Record<PlantSpeciesIndex, number>> = {
  [PlantSpecies.Acacia]: 10,
  [PlantSpecies.Alder]: 31,
  [PlantSpecies.AppleTree]: 25,
  [PlantSpecies.Arch]: 24,
  [PlantSpecies.Birch]: 3,
  [PlantSpecies.Blueberry]: 29,
  [PlantSpecies.Boulder]: 8,
  [PlantSpecies.Bush]: 6,
  [PlantSpecies.Cactus]: 7,
  [PlantSpecies.Cairn]: 15,
  [PlantSpecies.Currant]: 30,
  [PlantSpecies.DeadTree]: 12,
  [PlantSpecies.DesertShrub]: 13,
  [PlantSpecies.Dolmen]: 21,
  [PlantSpecies.Idol]: 22,
  [PlantSpecies.Maple]: 5,
  [PlantSpecies.Menhir]: 20,
  [PlantSpecies.Oak]: 2,
  [PlantSpecies.Palm]: 9,
  [PlantSpecies.PearTree]: 26,
  [PlantSpecies.Pillar]: 23,
  [PlantSpecies.Pine]: 1,
  [PlantSpecies.PlumTree]: 27,
  [PlantSpecies.Poplar]: 11,
  [PlantSpecies.Raspberry]: 28,
  [PlantSpecies.Sandstone]: 18,
  [PlantSpecies.Spruce]: 0,
  [PlantSpecies.Willow]: 4,
};

const CANONICAL_HEIGHTS: Readonly<Record<PlantSpeciesIndex, number>> = {
  ...TREE_HEIGHTS,
  ...ROCK_HEIGHTS,
  ...MONUMENT_HEIGHTS,
  ...ORCHARD_HEIGHTS,
};

const CROWNS_WITHOUT_BURIED_FOLIAGE: ReadonlySet<PlantSpeciesIndex> = new Set([
  PlantSpecies.Acacia,
  PlantSpecies.Birch,
  PlantSpecies.Bush,
  PlantSpecies.DesertShrub,
  PlantSpecies.Maple,
  PlantSpecies.Oak,
  PlantSpecies.Poplar,
  PlantSpecies.Spruce,
]);

const FORM_PER_VARIANT: ReadonlySet<PlantSpeciesIndex> = new Set([PlantSpecies.Cactus, PlantSpecies.DesertShrub]);
const FOOTPRINT_HEIGHT = 0.3;
const CONIFER: TreeLook = { bark: MaterialSlot.Bark, foliage: MaterialSlot.Needle, hasBarkMarks: false };
const BIRCH: TreeLook = { bark: MaterialSlot.BirchBark, foliage: MaterialSlot.Leaf, hasBarkMarks: true };
const PALM: TreeLook = { bark: MaterialSlot.Wood, foliage: MaterialSlot.Leaf, hasBarkMarks: true };
const DEADWOOD: TreeLook = { bark: MaterialSlot.Deadwood, foliage: MaterialSlot.Leaf, hasBarkMarks: false };

const TREE_LOOKS: Readonly<Partial<Record<PlantSpeciesIndex, TreeLook>>> = {
  [PlantSpecies.Acacia]: BROADLEAF_LOOK,
  [PlantSpecies.Alder]: BROADLEAF_LOOK,
  [PlantSpecies.Birch]: BIRCH,
  [PlantSpecies.Bush]: BROADLEAF_LOOK,
  [PlantSpecies.DeadTree]: DEADWOOD,
  [PlantSpecies.DesertShrub]: DEADWOOD,
  [PlantSpecies.Maple]: BROADLEAF_LOOK,
  [PlantSpecies.Oak]: BROADLEAF_LOOK,
  [PlantSpecies.Palm]: PALM,
  [PlantSpecies.Pine]: CONIFER,
  [PlantSpecies.Poplar]: BROADLEAF_LOOK,
  [PlantSpecies.Spruce]: CONIFER,
  [PlantSpecies.Willow]: BROADLEAF_LOOK,
};

function withoutBuriedFoliage(tree: MeshData, berries: readonly MeshData[], look: TreeLook): MeshData {
  const shells = shellsOf(tree);

  const foliage = shells.filter((shell) => {
    return shell.channels.slot[0] === look.foliage && isClosed(shell);
  });
  const wood = shells.filter((shell) => {
    return !foliage.includes(shell);
  });

  return mergeMeshes([
    ...wood,
    ...withoutBuriedOverlaps(foliage),
    ...berries.map((berry) => {
      return withoutBuriedTriangles(berry, foliage);
    }),
  ]);
}

function variantSeed(species: PlantSpeciesIndex, variant: number): number {
  return SHAPE_SEEDS[species] * 1000 + variant * 77 + 13;
}

export function buildPlantVariant(species: PlantSpeciesIndex, variant: number, level: PlantDetailLevel): MeshData {
  const seed = variantSeed(species, variant);

  if (species === PlantSpecies.Cactus) {
    return meshCactus(seed, level, CACTUS_FORMS[variant]);
  }

  if (isRockModel(species)) {
    return meshRock(species, seed, variant, level);
  }

  if (isMonumentPiece(species)) {
    return meshMonument(species, seed, variant, level);
  }

  if (isOrchardModel(species)) {
    return meshOrchardPlant(species, seed, level);
  }

  const generator = TREE_GENERATORS[species];
  const look = TREE_LOOKS[species];

  if (generator === undefined || look === undefined) {
    throw new RangeError(`No model for plant species ${PLANT_SPECIES[species].name}`);
  }

  const structure = generator(seed, variant);
  const tree = meshTree(structure, look, level);

  if (isDistantLevel(level) || !CROWNS_WITHOUT_BURIED_FOLIAGE.has(species)) {
    return tree;
  }

  if (species !== PlantSpecies.Bush) {
    return withoutBuriedFoliage(tree, [], look);
  }

  return withoutBuriedFoliage(tree, [berryClusters(tree, structure, look, seed + 1, level)], look);
}

export function plantVariantCount(species: PlantSpeciesIndex): number {
  return VARIANT_COUNTS[species];
}

export function farVariantOf(species: PlantSpeciesIndex, variant: number): number {
  return FORM_PER_VARIANT.has(species) || isMonumentPiece(species) ? variant : 0;
}

export function buildPlantVariants(species: PlantSpeciesIndex, level: PlantDetailLevel): MeshData[] {
  return Array.from({ length: plantVariantCount(species) }, (_, variant) => {
    return buildPlantVariant(species, variant, level);
  });
}

export function canonicalHeight(species: PlantSpeciesIndex): number {
  return CANONICAL_HEIGHTS[species];
}

function baseRadius(mesh: MeshData): number {
  let radius = 0;

  for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
    const offset = vertex * 3;

    if (mesh.positions[offset + 1] < FOOTPRINT_HEIGHT) {
      radius = Math.max(radius, Math.hypot(mesh.positions[offset], mesh.positions[offset + 2]));
    }
  }

  return radius;
}

export function footprintRadius(species: PlantSpeciesIndex): number {
  return buildPlantVariants(species, "low").reduce((widest, mesh) => {
    return Math.max(widest, baseRadius(mesh));
  }, 0);
}
