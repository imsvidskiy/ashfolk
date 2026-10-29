import { lerp } from "../shared/math.ts";
import { Biome, type BiomeIndex } from "./biomes.ts";
import { CULTIVATED_PLANT_SPECIES, CultivatedSpecies } from "./cultivated-plants.ts";

export const PlantSpecies = {
  Acacia: 10,
  Alder: 27,
  Arch: 20,
  Birch: 3,
  Boulder: 8,
  Bush: 6,
  Cactus: 7,
  Cairn: 14,
  DeadTree: 12,
  DesertShrub: 13,
  Dolmen: 17,
  Idol: 18,
  Maple: 5,
  Menhir: 16,
  Oak: 2,
  Palm: 9,
  Pillar: 19,
  Pine: 1,
  Poplar: 11,
  Sandstone: 15,
  Spruce: 0,
  Willow: 4,
  ...CultivatedSpecies,
} as const;

export type PlantSpeciesIndex = (typeof PlantSpecies)[keyof typeof PlantSpecies];

export const TREE_SPACING = 5;

const UNDERGROWTH_IN_CLEARINGS = 0.55;
const WARM = 12;

type PlantForm = "broadleaf" | "conifer" | "deadwood" | "monument" | "shrub" | "succulent" | "stone";

export interface PlantSpeciesDefinition {
  canopyFuel: number;
  form: PlantForm;
  givesBerries: boolean;
  heightRange: readonly [number, number];
  index: PlantSpeciesIndex;
  name: string;
  radiusPerMeter: number;
  steepestSlope: number;
  wood: number;
}

export const PLANT_SPECIES: readonly PlantSpeciesDefinition[] = [
  {
    canopyFuel: 2.6,
    form: "conifer",
    givesBerries: false,
    heightRange: [16, 32],
    index: PlantSpecies.Spruce,
    name: "Spruce",
    radiusPerMeter: 0.024,
    steepestSlope: 1,
    wood: 3,
  },
  {
    canopyFuel: 2.2,
    form: "conifer",
    givesBerries: false,
    heightRange: [18, 30],
    index: PlantSpecies.Pine,
    name: "Pine",
    radiusPerMeter: 0.024,
    steepestSlope: 1,
    wood: 3,
  },
  {
    canopyFuel: 2.4,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [12, 21],
    index: PlantSpecies.Oak,
    name: "Oak",
    radiusPerMeter: 0.047,
    steepestSlope: 0.65,
    wood: 4,
  },
  {
    canopyFuel: 1.7,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [14, 24],
    index: PlantSpecies.Birch,
    name: "Birch",
    radiusPerMeter: 0.021,
    steepestSlope: 0.7,
    wood: 2,
  },
  {
    canopyFuel: 1.6,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [9, 15],
    index: PlantSpecies.Willow,
    name: "Willow",
    radiusPerMeter: 0.062,
    steepestSlope: 0.45,
    wood: 2,
  },
  {
    canopyFuel: 2.1,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [12, 20],
    index: PlantSpecies.Maple,
    name: "Maple",
    radiusPerMeter: 0.038,
    steepestSlope: 0.65,
    wood: 3,
  },
  {
    canopyFuel: 0.5,
    form: "shrub",
    givesBerries: true,
    heightRange: [1.6, 2.8],
    index: PlantSpecies.Bush,
    name: "Berry bush",
    radiusPerMeter: 0.75,
    steepestSlope: 1.05,
    wood: 0,
  },
  {
    canopyFuel: 0.2,
    form: "succulent",
    givesBerries: false,
    heightRange: [2.5, 5.5],
    index: PlantSpecies.Cactus,
    name: "Cactus",
    radiusPerMeter: 0.18,
    steepestSlope: 1.05,
    wood: 0,
  },
  {
    canopyFuel: 0,
    form: "stone",
    givesBerries: false,
    heightRange: [1.2, 4],
    index: PlantSpecies.Boulder,
    name: "Boulder",
    radiusPerMeter: 1,
    steepestSlope: 1,
    wood: 0,
  },
  {
    canopyFuel: 1.2,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [7, 12],
    index: PlantSpecies.Palm,
    name: "Palm",
    radiusPerMeter: 0.042,
    steepestSlope: 0.5,
    wood: 2,
  },
  {
    canopyFuel: 1.4,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [6, 11],
    index: PlantSpecies.Acacia,
    name: "Acacia",
    radiusPerMeter: 0.051,
    steepestSlope: 0.6,
    wood: 3,
  },
  {
    canopyFuel: 1.8,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [16, 25],
    index: PlantSpecies.Poplar,
    name: "Poplar",
    radiusPerMeter: 0.026,
    steepestSlope: 0.55,
    wood: 3,
  },
  {
    canopyFuel: 0.5,
    form: "deadwood",
    givesBerries: false,
    heightRange: [5, 11],
    index: PlantSpecies.DeadTree,
    name: "Dead tree",
    radiusPerMeter: 0.063,
    steepestSlope: 0.75,
    wood: 2,
  },
  {
    canopyFuel: 0.3,
    form: "shrub",
    givesBerries: false,
    heightRange: [0.7, 1.6],
    index: PlantSpecies.DesertShrub,
    name: "Desert shrub",
    radiusPerMeter: 0.95,
    steepestSlope: 1.05,
    wood: 0,
  },
  {
    canopyFuel: 0,
    form: "monument",
    givesBerries: false,
    heightRange: [1.3, 4.4],
    index: PlantSpecies.Cairn,
    name: "Cairn",
    radiusPerMeter: 0.79,
    steepestSlope: 0.35,
    wood: 0,
  },
  {
    canopyFuel: 0,
    form: "stone",
    givesBerries: false,
    heightRange: [2, 4],
    index: PlantSpecies.Sandstone,
    name: "Sandstone",
    radiusPerMeter: 0.6,
    steepestSlope: 0.95,
    wood: 0,
  },
  {
    canopyFuel: 0,
    form: "monument",
    givesBerries: false,
    heightRange: [2.6, 6.4],
    index: PlantSpecies.Menhir,
    name: "Standing stone",
    radiusPerMeter: 0.5,
    steepestSlope: 0.35,
    wood: 0,
  },
  {
    canopyFuel: 0,
    form: "monument",
    givesBerries: false,
    heightRange: [3.4, 4.6],
    index: PlantSpecies.Dolmen,
    name: "Dolmen",
    radiusPerMeter: 0.9,
    steepestSlope: 0.35,
    wood: 0,
  },
  {
    canopyFuel: 0,
    form: "monument",
    givesBerries: false,
    heightRange: [6.5, 9.5],
    index: PlantSpecies.Idol,
    name: "Stone head",
    radiusPerMeter: 0.55,
    steepestSlope: 0.35,
    wood: 0,
  },
  {
    canopyFuel: 0,
    form: "monument",
    givesBerries: false,
    heightRange: [5.5, 7],
    index: PlantSpecies.Pillar,
    name: "Broken pillar",
    radiusPerMeter: 1,
    steepestSlope: 0.35,
    wood: 0,
  },
  {
    canopyFuel: 0,
    form: "monument",
    givesBerries: false,
    heightRange: [7, 8.2],
    index: PlantSpecies.Arch,
    name: "Ruined arch",
    radiusPerMeter: 0.45,
    steepestSlope: 0.35,
    wood: 0,
  },
  ...CULTIVATED_PLANT_SPECIES,
  {
    canopyFuel: 1.5,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [9, 16],
    index: PlantSpecies.Alder,
    name: "Alder",
    radiusPerMeter: 0.063,
    steepestSlope: 0.5,
    wood: 2,
  },
];

export interface PlantingRule {
  chancePerCell: number;
  heightScale: number;
  minimumTemperature?: number;
  species: PlantSpeciesIndex;
}

export const PLANTING_RULES: Readonly<Record<BiomeIndex, readonly PlantingRule[]>> = {
  [Biome.Alpine]: [
    { chancePerCell: 0.045, heightScale: 1, species: PlantSpecies.Boulder },
    { chancePerCell: 0.02, heightScale: 0.45, species: PlantSpecies.Spruce },
    { chancePerCell: 0.004, heightScale: 0.7, species: PlantSpecies.DeadTree },
  ],
  [Biome.Beach]: [
    { chancePerCell: 0.004, heightScale: 1, species: PlantSpecies.Boulder },
    { chancePerCell: 0.02, heightScale: 0.9, species: PlantSpecies.Willow },
    { chancePerCell: 0.04, heightScale: 1, minimumTemperature: WARM, species: PlantSpecies.Palm },
  ],
  [Biome.Desert]: [
    { chancePerCell: 0.015, heightScale: 1, species: PlantSpecies.Cactus },
    { chancePerCell: 0.005, heightScale: 1, species: PlantSpecies.Boulder },
    { chancePerCell: 0.008, heightScale: 0.85, species: PlantSpecies.Acacia },
    { chancePerCell: 0.004, heightScale: 0.9, species: PlantSpecies.DeadTree },
    { chancePerCell: 0.003, heightScale: 0.9, minimumTemperature: WARM, species: PlantSpecies.Palm },
  ],
  [Biome.Forest]: [
    { chancePerCell: 0.36, heightScale: 1, species: PlantSpecies.Oak },
    { chancePerCell: 0.28, heightScale: 1, species: PlantSpecies.Birch },
    { chancePerCell: 0.16, heightScale: 1, species: PlantSpecies.Maple },
    { chancePerCell: 0.1, heightScale: 1, species: PlantSpecies.Pine },
    { chancePerCell: 0.14, heightScale: 1, species: PlantSpecies.Bush },
    { chancePerCell: 0.12, heightScale: 0.8, species: PlantSpecies.Oak },
  ],
  [Biome.Glacier]: [{ chancePerCell: 0.01, heightScale: 1, species: PlantSpecies.Boulder }],
  [Biome.Meadow]: [
    { chancePerCell: 0.03, heightScale: 1, species: PlantSpecies.Oak },
    { chancePerCell: 0.025, heightScale: 1, species: PlantSpecies.Birch },
    { chancePerCell: 0.015, heightScale: 1, species: PlantSpecies.Maple },
    { chancePerCell: 0.08, heightScale: 1, species: PlantSpecies.Bush },
    { chancePerCell: 0.02, heightScale: 1, species: PlantSpecies.Pine },
    { chancePerCell: 0.012, heightScale: 1, species: PlantSpecies.Poplar },
  ],
  [Biome.Mesa]: [
    { chancePerCell: 0.02, heightScale: 1.2, species: PlantSpecies.Boulder },
    { chancePerCell: 0.02, heightScale: 1, species: PlantSpecies.DesertShrub },
    { chancePerCell: 0.008, heightScale: 0.9, species: PlantSpecies.Cactus },
    { chancePerCell: 0.006, heightScale: 0.8, species: PlantSpecies.DeadTree },
  ],
  [Biome.Scrub]: [
    { chancePerCell: 0.42, heightScale: 1, species: PlantSpecies.Bush },
    { chancePerCell: 0.06, heightScale: 1, species: PlantSpecies.Pine },
    { chancePerCell: 0.05, heightScale: 0.85, species: PlantSpecies.Oak },
    { chancePerCell: 0.05, heightScale: 1, species: PlantSpecies.Acacia },
    { chancePerCell: 0.05, heightScale: 1, species: PlantSpecies.DesertShrub },
  ],
  [Biome.Steppe]: [
    { chancePerCell: 0.035, heightScale: 1, species: PlantSpecies.Pine },
    { chancePerCell: 0.03, heightScale: 0.9, species: PlantSpecies.Oak },
    { chancePerCell: 0.035, heightScale: 1, species: PlantSpecies.Bush },
    { chancePerCell: 0.03, heightScale: 1, species: PlantSpecies.DesertShrub },
    { chancePerCell: 0.012, heightScale: 0.9, species: PlantSpecies.Poplar },
    { chancePerCell: 0.025, heightScale: 1, minimumTemperature: WARM, species: PlantSpecies.Acacia },
  ],
  [Biome.Swamp]: [
    { chancePerCell: 0.3, heightScale: 1, species: PlantSpecies.Alder },
    { chancePerCell: 0.2, heightScale: 0.9, species: PlantSpecies.Willow },
    { chancePerCell: 0.16, heightScale: 0.8, species: PlantSpecies.Birch },
    { chancePerCell: 0.16, heightScale: 1, species: PlantSpecies.Bush },
    { chancePerCell: 0.05, heightScale: 0.85, species: PlantSpecies.DeadTree },
  ],
  [Biome.Taiga]: [
    { chancePerCell: 0.9, heightScale: 1, species: PlantSpecies.Spruce },
    { chancePerCell: 0.3, heightScale: 0.85, species: PlantSpecies.Spruce },
    { chancePerCell: 0.1, heightScale: 1, species: PlantSpecies.Pine },
    { chancePerCell: 0.05, heightScale: 1, species: PlantSpecies.Birch },
    { chancePerCell: 0.04, heightScale: 1, species: PlantSpecies.Bush },
    { chancePerCell: 0.008, heightScale: 1, species: PlantSpecies.DeadTree },
  ],
  [Biome.Tundra]: [
    { chancePerCell: 0.06, heightScale: 0.35, species: PlantSpecies.Spruce },
    { chancePerCell: 0.04, heightScale: 0.8, species: PlantSpecies.Bush },
    { chancePerCell: 0.025, heightScale: 1, species: PlantSpecies.Boulder },
    { chancePerCell: 0.012, heightScale: 0.6, species: PlantSpecies.DeadTree },
  ],
  [Biome.Water]: [],
};

export const ROCK_RULES: Readonly<Record<BiomeIndex, readonly PlantingRule[]>> = {
  [Biome.Alpine]: [],
  [Biome.Beach]: [],
  [Biome.Desert]: [{ chancePerCell: 0.005, heightScale: 1, species: PlantSpecies.Sandstone }],
  [Biome.Forest]: [],
  [Biome.Glacier]: [],
  [Biome.Meadow]: [],
  [Biome.Mesa]: [{ chancePerCell: 0.025, heightScale: 1, species: PlantSpecies.Sandstone }],
  [Biome.Scrub]: [],
  [Biome.Steppe]: [],
  [Biome.Swamp]: [],
  [Biome.Taiga]: [],
  [Biome.Tundra]: [],
  [Biome.Water]: [],
};

export function plantSpeciesDefinition(index: number): PlantSpeciesDefinition {
  const definition = PLANT_SPECIES[index];

  if (definition === undefined) {
    throw new RangeError(`Unknown plant species ${index}`);
  }

  return definition;
}

export function isLivingTreeSpecies(index: number): boolean {
  const { form } = plantSpeciesDefinition(index);

  return form === "broadleaf" || form === "conifer";
}

export function isTreeSpecies(index: number): boolean {
  return isLivingTreeSpecies(index) || plantSpeciesDefinition(index).form === "deadwood";
}

export function isShrubSpecies(index: number): boolean {
  const { form } = plantSpeciesDefinition(index);

  return form === "shrub" || form === "succulent";
}

export function isRockSpecies(index: number): boolean {
  return plantSpeciesDefinition(index).form === "stone";
}

export function isMonumentSpecies(index: number): boolean {
  return plantSpeciesDefinition(index).form === "monument";
}

export function woodlandShare(index: number, woodland: number): number {
  if (isTreeSpecies(index)) {
    return woodland;
  }

  if (isShrubSpecies(index)) {
    return lerp(UNDERGROWTH_IN_CLEARINGS, 1, woodland);
  }

  return 1;
}

export function canGrowAt(rule: PlantingRule, temperature: number): boolean {
  return rule.minimumTemperature === undefined || temperature > rule.minimumTemperature;
}

export function regrowingSpecies(biome: BiomeIndex, temperature: number): readonly PlantSpeciesIndex[] {
  return PLANTING_RULES[biome]
    .filter((rule) => {
      return isLivingTreeSpecies(rule.species) && canGrowAt(rule, temperature);
    })
    .map((rule) => {
      return rule.species;
    });
}
