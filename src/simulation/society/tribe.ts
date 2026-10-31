import type { BuildingKind } from "../../content/buildings.ts";
import type { CropKind } from "../../content/crops.ts";
import type { TribeIdentity } from "../../content/names.ts";
import { nextTechnology, type TechnologyDefinition, type TechnologyId } from "../../content/technologies.ts";
import type { ToolMaterial } from "../../content/weapons.ts";
import type { WorldRules } from "../../content/world-rules.ts";
import { emptyStock, type Stock } from "./stock.ts";

export const BASE_HOUSING = 4;
export const FAITH_BASELINE = 30;
export const MAXIMUM_FAITH = 100;

const NEVER = Number.NEGATIVE_INFINITY;
const FOUNDING_BERRIES = 10;
const FOUNDING_WOOD = 4;

export type ScarceResource = "berries" | "clay" | "fish" | "game" | "stone" | "wood";

export interface Field {
  cell: number;
  crop: CropKind;
  growth: number;
  isFenced: boolean;
  isSown: boolean;
  plantings: number;
  previousGround: number;
  tending: number;
}

export type PlotKind = "orchard" | "woodlot";

export interface PlotSpot {
  plant: number;
  plantedDay: number;
  species: number;
  x: number;
  z: number;
}

export interface Plot {
  cells: number[];
  kind: PlotKind;
  spots: PlotSpot[];
}

interface TribeBuildings {
  campfireId: number | null;
  constructionSiteId: number | null;
  shelterIds: number[];
  storehouseId: number | null;
  structureIds: number[];
  totemId: number | null;
}

interface PlanStall {
  kind: BuildingKind | null;
  since: number;
}

interface TribeTimers {
  birthDays: number;
  cropDays: number;
  dailyDays: number;
  fieldSeason: number;
  planningSeconds: number;
  plotDays: number;
}

export interface Tribe {
  armory: ToolMaterial;
  births: number;
  buildings: TribeBuildings;
  campX: number;
  campZ: number;
  claimedPlants: Set<number>;
  color: string;
  deaths: number;
  eraIndex: number;
  faith: number;
  fields: Field[];
  furColor: string;
  id: number;
  isMigrating: boolean;
  knowledge: number;
  lastScarcity: Record<ScarceResource, number>;
  memberCount: number;
  migrationStartDay: number;
  name: string;
  originId: number | null;
  plots: Plot[];
  postponed: Partial<Record<BuildingKind, number>>;
  stall: PlanStall;
  stalled: Partial<Record<BuildingKind, number>>;
  stock: Stock;
  technologies: Set<TechnologyId>;
  timers: TribeTimers;
  tools: ToolMaterial;
}

interface TribeFounding {
  campX: number;
  campZ: number;
  day: number;
  id: number;
  identity: TribeIdentity;
}

function foundingStock(): Stock {
  const stock = emptyStock();

  stock.berries = FOUNDING_BERRIES;
  stock.wood = FOUNDING_WOOD;

  return stock;
}

export function createTribe(founding: TribeFounding): Tribe {
  return {
    armory: "wood",
    births: 0,
    buildings: {
      campfireId: null,
      constructionSiteId: null,
      shelterIds: [],
      storehouseId: null,
      structureIds: [],
      totemId: null,
    },
    campX: founding.campX,
    campZ: founding.campZ,
    claimedPlants: new Set(),
    color: founding.identity.color,
    deaths: 0,
    eraIndex: 0,
    faith: FAITH_BASELINE,
    fields: [],
    furColor: founding.identity.furColor,
    id: founding.id,
    isMigrating: false,
    knowledge: 0,
    lastScarcity: { berries: NEVER, clay: NEVER, fish: NEVER, game: NEVER, stone: NEVER, wood: NEVER },
    memberCount: 0,
    migrationStartDay: founding.day,
    name: founding.identity.name,
    originId: null,
    plots: [],
    postponed: {},
    stall: { kind: null, since: founding.day },
    stalled: {},
    stock: foundingStock(),
    technologies: new Set(),
    timers: { birthDays: 0, cropDays: 0, dailyDays: 0, fieldSeason: -1, planningSeconds: 1, plotDays: 0 },
    tools: "stone",
  };
}

export function knows(tribe: Tribe, technology: TechnologyId): boolean {
  return tribe.technologies.has(technology);
}

export function upcomingTechnology(tribe: Tribe): TechnologyDefinition | undefined {
  return nextTechnology(tribe.technologies);
}

export function markScarce(tribe: Tribe, resource: ScarceResource, day: number): void {
  tribe.lastScarcity[resource] = day;
}

export function isWorthLookingFor(tribe: Tribe, resource: ScarceResource, day: number, patienceDays: number): boolean {
  return day - tribe.lastScarcity[resource] > patienceDays;
}

export function learn(tribe: Tribe, amount: number, rules: WorldRules): void {
  tribe.knowledge += amount * rules.life.learningSpeed;
}
