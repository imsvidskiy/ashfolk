import type { BuildingKind } from "./buildings.ts";
import type { ResourceAmounts } from "./resources.ts";
import type { TechnologyId } from "./technologies.ts";

const RECIPE_IDS = ["pottery", "copper", "bronze", "iron", "spears", "bows", "arrows", "tools"] as const;

export type RecipeId = (typeof RECIPE_IDS)[number];

interface RecipeDefinition {
  inputs: ResourceAmounts;
  isHeadedWithMetal: boolean;
  label: string;
  outputs: ResourceAmounts;
  seconds: number;
  station: BuildingKind;
  technology: TechnologyId;
}

export const RECIPES: Readonly<Record<RecipeId, RecipeDefinition>> = {
  arrows: {
    inputs: { stone: 1, wood: 1 },
    isHeadedWithMetal: true,
    label: "Fletching arrows",
    outputs: { arrows: 12 },
    seconds: 10,
    station: "workshop",
    technology: "archery",
  },
  bows: {
    inputs: { wood: 3 },
    isHeadedWithMetal: false,
    label: "Carving a bow",
    outputs: { bows: 1 },
    seconds: 12,
    station: "workshop",
    technology: "archery",
  },
  bronze: {
    inputs: { copperOre: 2, tinOre: 1, wood: 2 },
    isHeadedWithMetal: false,
    label: "Casting bronze",
    outputs: { bronze: 2 },
    seconds: 18,
    station: "smelter",
    technology: "bronze",
  },
  copper: {
    inputs: { copperOre: 3, wood: 2 },
    isHeadedWithMetal: false,
    label: "Smelting copper",
    outputs: { copper: 2 },
    seconds: 16,
    station: "smelter",
    technology: "copper",
  },
  iron: {
    inputs: { ironOre: 3, wood: 3 },
    isHeadedWithMetal: false,
    label: "Forging iron",
    outputs: { iron: 2 },
    seconds: 20,
    station: "forge",
    technology: "iron",
  },
  pottery: {
    inputs: { clay: 3, wood: 1 },
    isHeadedWithMetal: false,
    label: "Firing pots",
    outputs: { pottery: 2 },
    seconds: 14,
    station: "kiln",
    technology: "pottery",
  },
  spears: {
    inputs: { stone: 1, wood: 2 },
    isHeadedWithMetal: true,
    label: "Making spears",
    outputs: { spears: 2 },
    seconds: 10,
    station: "workshop",
    technology: "spear",
  },
  tools: {
    inputs: {},
    isHeadedWithMetal: true,
    label: "Making tools",
    outputs: {},
    seconds: 16,
    station: "workshop",
    technology: "copper",
  },
};
