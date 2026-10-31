import type { MaterialKind } from "./resources.ts";

const TECHNOLOGY_IDS = [
  "fire",
  "shelter",
  "spear",
  "fishing",
  "storage",
  "archery",
  "huts",
  "pottery",
  "farming",
  "totem",
  "weaving",
  "orchards",
  "mining",
  "copper",
  "ploughing",
  "bronze",
  "forestry",
  "iron",
  "masonry",
] as const;

export type TechnologyId = (typeof TECHNOLOGY_IDS)[number];

interface MaterialNeed {
  amount: number;
  resource: MaterialKind;
}

export interface TechnologyDefinition {
  cost: number;
  id: TechnologyId;
  name: string;
  needs: MaterialNeed | null;
  requires: readonly TechnologyId[];
}

export const TECHNOLOGIES: readonly TechnologyDefinition[] = [
  {
    cost: 40,
    id: "fire",
    name: "Fire",
    needs: null,
    requires: [],
  },
  {
    cost: 60,
    id: "shelter",
    name: "Shelters",
    needs: null,
    requires: ["fire"],
  },
  {
    cost: 90,
    id: "spear",
    name: "Spears",
    needs: null,
    requires: ["fire"],
  },
  {
    cost: 125,
    id: "fishing",
    name: "Fishing",
    needs: null,
    requires: ["spear"],
  },
  {
    cost: 160,
    id: "storage",
    name: "Storage",
    needs: null,
    requires: ["shelter"],
  },
  {
    cost: 190,
    id: "archery",
    name: "Archery",
    needs: null,
    requires: ["spear"],
  },
  {
    cost: 220,
    id: "huts",
    name: "Huts",
    needs: null,
    requires: ["shelter", "storage"],
  },
  {
    cost: 250,
    id: "pottery",
    name: "Pottery",
    needs: null,
    requires: ["huts"],
  },
  {
    cost: 280,
    id: "farming",
    name: "Farming",
    needs: null,
    requires: ["huts", "pottery"],
  },
  {
    cost: 330,
    id: "totem",
    name: "Totem",
    needs: null,
    requires: ["huts"],
  },
  {
    cost: 370,
    id: "weaving",
    name: "Weaving",
    needs: null,
    requires: ["farming"],
  },
  {
    cost: 410,
    id: "orchards",
    name: "Orchards",
    needs: null,
    requires: ["farming"],
  },
  {
    cost: 450,
    id: "mining",
    name: "Mining",
    needs: null,
    requires: ["farming"],
  },
  {
    cost: 510,
    id: "copper",
    name: "Copper smelting",
    needs: { amount: 6, resource: "copperOre" },
    requires: ["mining"],
  },
  {
    cost: 570,
    id: "ploughing",
    name: "Plowing",
    needs: null,
    requires: ["copper"],
  },
  {
    cost: 630,
    id: "bronze",
    name: "Bronze",
    needs: { amount: 4, resource: "tinOre" },
    requires: ["copper"],
  },
  {
    cost: 700,
    id: "forestry",
    name: "Forestry",
    needs: null,
    requires: ["bronze"],
  },
  {
    cost: 780,
    id: "iron",
    name: "Ironworking",
    needs: { amount: 6, resource: "ironOre" },
    requires: ["bronze"],
  },
  {
    cost: 880,
    id: "masonry",
    name: "Masonry",
    needs: null,
    requires: ["iron"],
  },
];

export function technologyDefinition(id: TechnologyId): TechnologyDefinition {
  const definition = TECHNOLOGIES.find((technology) => {
    return technology.id === id;
  });

  if (definition === undefined) {
    throw new RangeError(`Unknown technology ${id}`);
  }

  return definition;
}

export function nextTechnology(known: ReadonlySet<TechnologyId>): TechnologyDefinition | undefined {
  return TECHNOLOGIES.find((technology) => {
    return (
      !known.has(technology.id) &&
      technology.requires.every((required) => {
        return known.has(required);
      })
    );
  });
}
