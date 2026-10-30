export const Biome = {
  Alpine: 2,
  Beach: 11,
  Desert: 9,
  Forest: 5,
  Glacier: 1,
  Meadow: 6,
  Mesa: 12,
  Scrub: 8,
  Steppe: 7,
  Swamp: 10,
  Taiga: 4,
  Tundra: 3,
  Water: 0,
} as const;

export const WOODED_BIOMES: ReadonlySet<number> = new Set([Biome.Forest, Biome.Taiga]);

const BIOME_INDICES: ReadonlySet<number> = new Set(Object.values(Biome));

export type BiomeIndex = (typeof Biome)[keyof typeof Biome];

interface BiomeDefinition {
  index: BiomeIndex;
  name: string;
}

export const BIOMES: readonly BiomeDefinition[] = [
  { index: Biome.Water, name: "Water" },
  { index: Biome.Glacier, name: "Glacier" },
  { index: Biome.Alpine, name: "Alpine rock" },
  { index: Biome.Tundra, name: "Tundra" },
  { index: Biome.Taiga, name: "Taiga" },
  { index: Biome.Forest, name: "Broadleaf forest" },
  { index: Biome.Meadow, name: "Meadow" },
  { index: Biome.Steppe, name: "Dry steppe" },
  { index: Biome.Scrub, name: "Scrubland" },
  { index: Biome.Desert, name: "Desert" },
  { index: Biome.Swamp, name: "Swamp" },
  { index: Biome.Beach, name: "Shore" },
  { index: Biome.Mesa, name: "Mesa" },
];

export function isBiomeIndex(value: number): value is BiomeIndex {
  return BIOME_INDICES.has(value);
}

export function biomeDefinition(index: number): BiomeDefinition {
  const definition = BIOMES[index];

  if (definition === undefined) {
    throw new RangeError(`Unknown biome ${index}`);
  }

  return definition;
}
