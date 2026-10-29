import { RECIPES, type RecipeId, type ResourceAmounts } from "../../content/recipes.ts";
import { isBetterMaterial, TOOL_MATERIAL_DEFINITIONS, type ToolMaterial } from "../../content/weapons.ts";
import type { Building } from "./buildings.ts";
import { completedOfKind } from "./camp-plan.ts";
import type { SocietyContext } from "./society-context.ts";
import { amountOf, hasResources } from "./stock.ts";
import { knows, type Tribe } from "./tribe.ts";
import { headMaterial, METALS_BY_STRENGTH } from "./weapons.ts";

const POTTERY_TARGET = 12;
const METAL_TARGET = 10;
const ARROW_TARGET = 36;
const TOOLSET_METAL = 6;
const SPEARS_PER_MEMBER = 0.25;
const BOWS_PER_MEMBER = 0.2;
const CRAFT_ORDER: readonly RecipeId[] = ["tools", "pottery", "copper", "bronze", "iron", "spears", "bows", "arrows"];

export interface CraftOrder {
  inputs: ResourceAmounts;
  material: ToolMaterial | null;
  outputs: ResourceAmounts;
  recipe: RecipeId;
  station: Building | null;
}

function nextToolMaterial(tribe: Tribe): ToolMaterial | null {
  for (const material of METALS_BY_STRENGTH) {
    const { metal, technology } = TOOL_MATERIAL_DEFINITIONS[material];

    if (metal === null || technology === null || !knows(tribe, technology)) {
      continue;
    }

    if (isBetterMaterial(material, tribe.tools) && tribe.stock[metal] >= TOOLSET_METAL) {
      return material;
    }
  }

  return null;
}

function isWanted(tribe: Tribe, recipe: RecipeId, construction: ResourceAmounts): boolean {
  const { stock } = tribe;

  const members = tribe.memberCount;

  switch (recipe) {
    case "arrows":
      return stock.arrows < ARROW_TARGET;
    case "bows":
      return stock.bows < 1 + members * BOWS_PER_MEMBER;
    case "bronze":
      return stock.bronze < METAL_TARGET;
    case "copper":
      return stock.copper < METAL_TARGET;
    case "iron":
      return stock.iron < METAL_TARGET;
    case "pottery":
      return stock.pottery < POTTERY_TARGET + amountOf(construction, "pottery");
    case "spears":
      return stock.spears < 2 + members * SPEARS_PER_MEMBER;
    case "tools":
      return nextToolMaterial(tribe) !== null;
    default:
      return recipe satisfies never;
  }
}

function headedInputs(inputs: ResourceAmounts, material: ToolMaterial): ResourceAmounts {
  const { metal } = TOOL_MATERIAL_DEFINITIONS[material];

  if (metal === null) {
    return inputs;
  }

  return { ...inputs, [metal]: amountOf(inputs, metal) + 1, stone: 0 };
}

function resolveOrder(tribe: Tribe, context: SocietyContext, recipe: RecipeId): CraftOrder | null {
  const definition = RECIPES[recipe];

  if (!knows(tribe, definition.technology)) {
    return null;
  }

  const station = completedOfKind(tribe, context, definition.station);

  if (station === null && definition.station !== "workshop") {
    return null;
  }

  const order = orderFor(tribe, recipe, station);

  if (order === null || !hasResources(tribe.stock, order.inputs)) {
    return null;
  }

  return order;
}

function orderFor(tribe: Tribe, recipe: RecipeId, station: Building | null): CraftOrder | null {
  const definition = RECIPES[recipe];

  if (recipe === "tools") {
    const material = nextToolMaterial(tribe);

    if (material === null) {
      return null;
    }

    const { metal } = TOOL_MATERIAL_DEFINITIONS[material];

    const inputs: ResourceAmounts = metal === null ? {} : { [metal]: TOOLSET_METAL };

    return { inputs, material, outputs: {}, recipe, station };
  }

  if (!definition.isHeadedWithMetal) {
    return { inputs: definition.inputs, material: null, outputs: definition.outputs, recipe, station };
  }

  const material = headMaterial(tribe);

  return { inputs: headedInputs(definition.inputs, material), material, outputs: definition.outputs, recipe, station };
}

export function chooseCraft(tribe: Tribe, context: SocietyContext, construction: ResourceAmounts): CraftOrder | null {
  for (const recipe of CRAFT_ORDER) {
    if (!isWanted(tribe, recipe, construction)) {
      continue;
    }

    const order = resolveOrder(tribe, context, recipe);

    if (order !== null) {
      return order;
    }
  }

  return null;
}
