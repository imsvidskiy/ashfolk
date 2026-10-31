export const FOOD_KINDS = ["berries", "fruit", "meat", "fish", "grain", "vegetables"] as const;

export type FoodKind = (typeof FOOD_KINDS)[number];

const MATERIAL_KINDS = [
  "wood",
  "stone",
  "clay",
  "linen",
  "pottery",
  "copperOre",
  "tinOre",
  "ironOre",
  "copper",
  "bronze",
  "iron",
] as const;

export type MaterialKind = (typeof MATERIAL_KINDS)[number];

const ARM_KINDS = ["spears", "bows", "arrows"] as const;

export const RESOURCE_KINDS = [...FOOD_KINDS, ...MATERIAL_KINDS, ...ARM_KINDS] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export type ResourceAmounts = Readonly<Partial<Record<ResourceKind, number>>>;

export type ResourceGroup = "arms" | "food" | "material" | "metal" | "ore";

export const RESOURCE_GROUPS: readonly ResourceGroup[] = ["food", "material", "ore", "metal", "arms"];

interface ResourceDefinition {
  group: ResourceGroup;
  isKeptInGranary: boolean;
  name: string;
  spoilagePerDay: number;
}

export const RESOURCES: Readonly<Record<ResourceKind, ResourceDefinition>> = {
  arrows: { group: "arms", isKeptInGranary: false, name: "Arrows", spoilagePerDay: 0 },
  berries: { group: "food", isKeptInGranary: false, name: "Berries", spoilagePerDay: 0.06 },
  bows: { group: "arms", isKeptInGranary: false, name: "Bows", spoilagePerDay: 0 },
  bronze: { group: "metal", isKeptInGranary: false, name: "Bronze", spoilagePerDay: 0 },
  clay: { group: "material", isKeptInGranary: false, name: "Clay", spoilagePerDay: 0 },
  copper: { group: "metal", isKeptInGranary: false, name: "Copper", spoilagePerDay: 0 },
  copperOre: { group: "ore", isKeptInGranary: false, name: "Copper ore", spoilagePerDay: 0 },
  fish: { group: "food", isKeptInGranary: false, name: "Fish", spoilagePerDay: 0.08 },
  fruit: { group: "food", isKeptInGranary: true, name: "Fruit", spoilagePerDay: 0.05 },
  grain: { group: "food", isKeptInGranary: true, name: "Grain", spoilagePerDay: 0.012 },
  iron: { group: "metal", isKeptInGranary: false, name: "Iron", spoilagePerDay: 0 },
  ironOre: { group: "ore", isKeptInGranary: false, name: "Iron ore", spoilagePerDay: 0 },
  linen: { group: "material", isKeptInGranary: false, name: "Linen", spoilagePerDay: 0 },
  meat: { group: "food", isKeptInGranary: false, name: "Meat", spoilagePerDay: 0.07 },
  pottery: { group: "material", isKeptInGranary: false, name: "Pottery", spoilagePerDay: 0 },
  spears: { group: "arms", isKeptInGranary: false, name: "Spears", spoilagePerDay: 0 },
  stone: { group: "material", isKeptInGranary: false, name: "Stone", spoilagePerDay: 0 },
  tinOre: { group: "ore", isKeptInGranary: false, name: "Tin ore", spoilagePerDay: 0 },
  vegetables: { group: "food", isKeptInGranary: true, name: "Vegetables", spoilagePerDay: 0.03 },
  wood: { group: "material", isKeptInGranary: false, name: "Wood", spoilagePerDay: 0 },
};

export function isFoodKind(kind: string): kind is FoodKind {
  return FOOD_KINDS.some((food) => {
    return food === kind;
  });
}

export function resourcesInGroup(group: ResourceGroup): readonly ResourceKind[] {
  return RESOURCE_KINDS.filter((kind) => {
    return RESOURCES[kind].group === group;
  });
}
