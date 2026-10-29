import { Biome, type BiomeIndex } from "./biomes.ts";
import type { PlantingRule, PlantSpeciesDefinition, PlantSpeciesIndex } from "./plants.ts";

export const CultivatedSpecies = {
  AppleTree: 21,
  Blueberry: 25,
  Currant: 26,
  PearTree: 22,
  PlumTree: 23,
  Raspberry: 24,
} as const;

export const CULTIVATED_PLANT_SPECIES: readonly PlantSpeciesDefinition[] = [
  {
    canopyFuel: 1.2,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [4.5, 6.5],
    index: CultivatedSpecies.AppleTree,
    name: "Apple tree",
    radiusPerMeter: 0.06,
    steepestSlope: 0.5,
    wood: 2,
  },
  {
    canopyFuel: 1.2,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [5.5, 8],
    index: CultivatedSpecies.PearTree,
    name: "Pear tree",
    radiusPerMeter: 0.045,
    steepestSlope: 0.5,
    wood: 2,
  },
  {
    canopyFuel: 1.1,
    form: "broadleaf",
    givesBerries: false,
    heightRange: [4, 6],
    index: CultivatedSpecies.PlumTree,
    name: "Plum tree",
    radiusPerMeter: 0.055,
    steepestSlope: 0.5,
    wood: 2,
  },
  {
    canopyFuel: 0.4,
    form: "shrub",
    givesBerries: true,
    heightRange: [1.3, 2],
    index: CultivatedSpecies.Raspberry,
    name: "Raspberry canes",
    radiusPerMeter: 0.5,
    steepestSlope: 1.05,
    wood: 0,
  },
  {
    canopyFuel: 0.3,
    form: "shrub",
    givesBerries: true,
    heightRange: [0.55, 0.95],
    index: CultivatedSpecies.Blueberry,
    name: "Blueberry",
    radiusPerMeter: 1,
    steepestSlope: 1.05,
    wood: 0,
  },
  {
    canopyFuel: 0.4,
    form: "shrub",
    givesBerries: true,
    heightRange: [1.1, 1.7],
    index: CultivatedSpecies.Currant,
    name: "Currant bush",
    radiusPerMeter: 0.6,
    steepestSlope: 1.05,
    wood: 0,
  },
];

export const FRUIT_TREE_SPECIES: readonly PlantSpeciesIndex[] = [
  CultivatedSpecies.AppleTree,
  CultivatedSpecies.PearTree,
  CultivatedSpecies.PlumTree,
];

export const GARDEN_BERRY_SPECIES: readonly PlantSpeciesIndex[] = [
  CultivatedSpecies.Raspberry,
  CultivatedSpecies.Currant,
  CultivatedSpecies.Blueberry,
];

export const WILD_BERRY_RULES: Readonly<Record<BiomeIndex, readonly PlantingRule[]>> = {
  [Biome.Alpine]: [{ chancePerCell: 0.012, heightScale: 0.8, species: CultivatedSpecies.Blueberry }],
  [Biome.Beach]: [],
  [Biome.Desert]: [],
  [Biome.Forest]: [
    { chancePerCell: 0.03, heightScale: 1, species: CultivatedSpecies.Raspberry },
    { chancePerCell: 0.035, heightScale: 1, species: CultivatedSpecies.Blueberry },
    { chancePerCell: 0.015, heightScale: 1, species: CultivatedSpecies.Currant },
  ],
  [Biome.Glacier]: [],
  [Biome.Meadow]: [
    { chancePerCell: 0.025, heightScale: 1, species: CultivatedSpecies.Raspberry },
    { chancePerCell: 0.012, heightScale: 1, species: CultivatedSpecies.Currant },
  ],
  [Biome.Mesa]: [],
  [Biome.Scrub]: [{ chancePerCell: 0.03, heightScale: 0.9, species: CultivatedSpecies.Raspberry }],
  [Biome.Steppe]: [{ chancePerCell: 0.008, heightScale: 0.9, species: CultivatedSpecies.Currant }],
  [Biome.Swamp]: [
    { chancePerCell: 0.04, heightScale: 1, species: CultivatedSpecies.Currant },
    { chancePerCell: 0.02, heightScale: 0.9, species: CultivatedSpecies.Blueberry },
  ],
  [Biome.Taiga]: [
    { chancePerCell: 0.06, heightScale: 1, species: CultivatedSpecies.Blueberry },
    { chancePerCell: 0.01, heightScale: 1, species: CultivatedSpecies.Raspberry },
  ],
  [Biome.Tundra]: [{ chancePerCell: 0.04, heightScale: 0.85, species: CultivatedSpecies.Blueberry }],
  [Biome.Water]: [],
};

export function isFruitTreeSpecies(species: number): boolean {
  return FRUIT_TREE_SPECIES.some((fruitTree) => {
    return fruitTree === species;
  });
}
