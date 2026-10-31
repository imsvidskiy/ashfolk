import { BUILDINGS, type BuildingKind, isEnclosure } from "../../content/buildings.ts";
import type { ResourceAmounts } from "../../content/recipes.ts";
import { FULL_TURN } from "../../shared/math.ts";
import { aroundPoint, type Waypoint } from "../agents/navigation.ts";
import { NO_BUILDING } from "../world/world-state.ts";
import { type BuildingPad, DEEPEST_LEVELING, isLeveled, levelPad, planPad } from "./building-pads.ts";
import type { Building, BuildingLoss } from "./buildings.ts";
import { type BuildingPlan, buildingPlans } from "./camp-plan.ts";
import { addFieldIfNeeded } from "./farming.ts";
import { footprintCells, isDryWay } from "./footprints.ts";
import { assignHomes } from "./housing.ts";
import { addPlotIfNeeded } from "./plots.ts";
import type { SocietyContext } from "./society-context.ts";
import { addResources, emptyStock, hasResources, spendResources } from "./stock.ts";
import { learn, type Tribe } from "./tribe.ts";

const PLACEMENT_ATTEMPTS = 36;
const BUILDING_GAP = 3;
const CAMPFIRE_GAP = 1;
const POSTPONE_DAYS = 1.5;
const LONGEST_STALL_DAYS = 2.5;
const PLANS_TO_SAVE_FOR = 3;
const CLEARING = 4;
const SLOPE_PROBE = 3;
const BUILDING_LEARNING = 2;

interface Lot {
  readonly pad: BuildingPad | null;
  readonly spot: Waypoint;
}

export function canAfford(tribe: Tribe, kind: BuildingKind): boolean {
  return hasResources(tribe.stock, BUILDINGS[kind].cost);
}

export function planConstruction(tribe: Tribe, context: SocietyContext): void {
  if (tribe.buildings.constructionSiteId !== null || tribe.isMigrating) {
    return;
  }

  addFieldIfNeeded(tribe, context);
  addPlotIfNeeded(tribe, context);

  const plans = buildingPlans(tribe, context);

  const goal = savingGoals(tribe, plans, context).at(0);
  const plan = plans.find((candidate) => {
    return canAfford(tribe, candidate.kind);
  });

  if (plan === undefined) {
    if (goal !== undefined) {
      noteStall(tribe, goal.kind, context);
    }

    return;
  }

  if (plan === goal) {
    tribe.stall.kind = null;
  }

  const site = placeBuilding(tribe, plan, context);

  if (site === null) {
    tribe.postponed[plan.kind] = context.environment.day + POSTPONE_DAYS;

    return;
  }

  assignSlot(tribe, plan, site, context);
}

function noteStall(tribe: Tribe, kind: BuildingKind, context: SocietyContext): void {
  const { day } = context.environment;

  if (tribe.stall.kind !== kind) {
    tribe.stall.kind = kind;
    tribe.stall.since = day;

    return;
  }

  if (day - tribe.stall.since < LONGEST_STALL_DAYS) {
    return;
  }

  tribe.stalled[kind] = day + POSTPONE_DAYS;
  tribe.stall.kind = null;
}

function isStalled(tribe: Tribe, kind: BuildingKind, day: number): boolean {
  const until = tribe.stalled[kind];

  return until !== undefined && until > day;
}

function savingGoals(tribe: Tribe, plans: readonly BuildingPlan[], context: SocietyContext): BuildingPlan[] {
  return plans.filter((plan) => {
    return !isStalled(tribe, plan.kind, context.environment.day);
  });
}

export function constructionNeeds(tribe: Tribe, context: SocietyContext): ResourceAmounts {
  const needs = emptyStock();

  for (const plan of savingGoals(tribe, buildingPlans(tribe, context), context).slice(0, PLANS_TO_SAVE_FOR)) {
    addResources(needs, BUILDINGS[plan.kind].cost);
  }

  return needs;
}

function placeBuilding(tribe: Tribe, plan: BuildingPlan, context: SocietyContext): Building | null {
  if (isEnclosure(plan.kind)) {
    return startBuilding(tribe, plan, { pad: null, spot: plan.origin }, context);
  }

  const { random, world } = context;

  let flattest: Lot | null = null;

  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
    const angle = random.next() * FULL_TURN;
    const distance = random.between(plan.nearest, plan.farthest);

    const spot = aroundPoint(plan.origin, distance, angle);

    if (!(isBuildable(spot, plan.kind, context) && isDryWay(world, plan.origin, spot))) {
      continue;
    }

    if (!isLeveled(plan.kind)) {
      return startBuilding(tribe, plan, { pad: null, spot }, context);
    }

    const lot: Lot = { pad: planPad(world, context.buildings.all, spot, plan.kind), spot };

    if (unevenness(lot) <= DEEPEST_LEVELING) {
      return startBuilding(tribe, plan, lot, context);
    }

    if (flattest === null || unevenness(lot) < unevenness(flattest)) {
      flattest = lot;
    }
  }

  if (flattest === null) {
    return null;
  }

  return startBuilding(tribe, plan, flattest, context);
}

function unevenness(lot: Lot): number {
  if (lot.pad === null) {
    return Number.POSITIVE_INFINITY;
  }

  return lot.pad.unevenness;
}

function isClearOfOthers(spot: Waypoint, kind: BuildingKind, context: SocietyContext): boolean {
  const { footprint } = BUILDINGS[kind];

  const gap = kind === "campfire" ? CAMPFIRE_GAP : BUILDING_GAP;

  return context.buildings.all.every((other) => {
    if (isEnclosure(other.kind)) {
      return true;
    }

    const clearance = footprint + BUILDINGS[other.kind].footprint + gap;

    return Math.hypot(other.x - spot.x, other.z - spot.z) >= clearance;
  });
}

function isBuildable(spot: Waypoint, kind: BuildingKind, context: SocietyContext): boolean {
  const { world } = context;
  const { footprint, steepestSlope } = BUILDINGS[kind];

  const cell = world.grid.cellAt(spot.x, spot.z);

  if (cell < 0 || !world.isWalkable(cell) || world.occupancy[cell] !== NO_BUILDING) {
    return false;
  }

  const covered = footprintCells(world.grid, spot.x, spot.z, footprint);

  const isFirmGround = covered.every((footprintCell) => {
    return (
      world.isWalkable(footprintCell) &&
      !world.isPool(footprintCell) &&
      world.slope(footprintCell) <= steepestSlope &&
      world.occupancy[footprintCell] === NO_BUILDING
    );
  });

  return isFirmGround && isClearOfOthers(spot, kind, context);
}

function downhillRotation(spot: Waypoint, context: SocietyContext): number {
  const { world } = context;

  const slopeX = world.heightAt(spot.x + SLOPE_PROBE, spot.z) - world.heightAt(spot.x - SLOPE_PROBE, spot.z);
  const slopeZ = world.heightAt(spot.x, spot.z + SLOPE_PROBE) - world.heightAt(spot.x, spot.z - SLOPE_PROBE);

  return Math.atan2(-slopeX, -slopeZ);
}

function gateAngle(tribe: Tribe, context: SocietyContext): number {
  const [field] = tribe.fields;

  if (field === undefined) {
    return context.random.next() * FULL_TURN;
  }

  const { grid } = context.world;

  return Math.atan2(grid.cellCenterZ(field.cell) - tribe.campZ, grid.cellCenterX(field.cell) - tribe.campX);
}

function siteRotation(tribe: Tribe, plan: BuildingPlan, spot: Waypoint, context: SocietyContext): number {
  if (isEnclosure(plan.kind)) {
    return gateAngle(tribe, context);
  }

  if (BUILDINGS[plan.kind].role === "mine") {
    return downhillRotation(spot, context);
  }

  return Math.atan2(tribe.campX - spot.x, tribe.campZ - spot.z);
}

function startBuilding(tribe: Tribe, plan: BuildingPlan, { pad, spot }: Lot, context: SocietyContext): Building {
  const site = context.buildings.add(
    {
      depositId: plan.depositId,
      extent: plan.extent,
      kind: plan.kind,
      rotation: siteRotation(tribe, plan, spot, context),
      style: tribe.eraIndex,
      tribeId: tribe.id,
      x: spot.x,
      z: spot.z,
    },
    context.random
  );

  site.replacesId = plan.replacesId;
  spendResources(tribe.stock, BUILDINGS[plan.kind].cost);
  tribe.buildings.constructionSiteId = site.id;

  for (const cell of footprintCells(context.world.grid, site.x, site.z, BUILDINGS[plan.kind].footprint + CLEARING)) {
    context.world.clearPlants(cell, false);
  }

  if (pad !== null) {
    levelPad(context.world, pad);
  }

  return site;
}

function assignSlot(tribe: Tribe, plan: BuildingPlan, site: Building, context: SocietyContext): void {
  const { buildings } = tribe;

  markForRetirement(plan.replacesId, context);

  switch (BUILDINGS[plan.kind].role) {
    case "fire":
      buildings.campfireId = site.id;
      break;
    case "dwelling":
      buildings.shelterIds.push(site.id);
      break;
    case "shrine":
      buildings.totemId = site.id;
      break;
    case "store":
      if (plan.kind === "storehouse") {
        buildings.storehouseId = site.id;
      } else {
        buildings.structureIds.push(site.id);
      }

      break;
    default:
      buildings.structureIds.push(site.id);
  }
}

function markForRetirement(buildingId: number | null, context: SocietyContext): void {
  const building = context.buildings.find(buildingId);

  if (building !== null) {
    building.isRetiring = true;
  }
}

export function completeConstruction(tribe: Tribe, site: Building, context: SocietyContext): void {
  if (tribe.buildings.constructionSiteId === site.id) {
    tribe.buildings.constructionSiteId = null;
  }

  context.chronicle.record({
    category: "building",
    text: constructionMessage(tribe, site, context),
    tribeId: tribe.id,
    x: site.x,
    z: site.z,
  });

  retireReplaced(site, context);
  assignHomes(tribe, context.buildings, context.people.membersOf(tribe));
  learn(tribe, BUILDING_LEARNING, context.rules);
}

function constructionMessage(tribe: Tribe, site: Building, context: SocietyContext): string {
  switch (site.kind) {
    case "campfire":
      return `${tribe.name} lit a campfire`;
    case "mine":
      return `${tribe.name} opened a mine at the ${depositName(site, context)}`;
    case "palisade":
      return `${tribe.name} raised a palisade around the camp`;
    case "stoneWall":
      return `${tribe.name} walled their village in stone`;
    default:
      return `${tribe.name} built a ${BUILDINGS[site.kind].name.toLowerCase()}`;
  }
}

function depositName(site: Building, context: SocietyContext): string {
  const deposit = context.world.depositById(site.depositId);

  if (deposit === null) {
    return "hills";
  }

  return `${deposit.kind} vein`;
}

function retireReplaced(site: Building, context: SocietyContext): void {
  const replaced = context.buildings.find(site.replacesId);

  site.replacesId = null;

  if (replaced !== null) {
    context.buildings.remove(replaced, "replaced");
  }
}

export function handleBuildingLoss(tribe: Tribe, loss: BuildingLoss, context: SocietyContext): void {
  const { building, reason } = loss;
  const { buildings } = tribe;

  buildings.campfireId = clearedId(buildings.campfireId, building);
  buildings.constructionSiteId = clearedId(buildings.constructionSiteId, building);
  buildings.storehouseId = clearedId(buildings.storehouseId, building);
  buildings.totemId = clearedId(buildings.totemId, building);
  buildings.shelterIds = buildings.shelterIds.filter((shelterId) => {
    return shelterId !== building.id;
  });
  buildings.structureIds = buildings.structureIds.filter((structureId) => {
    return structureId !== building.id;
  });

  const replaced = context.buildings.find(building.replacesId);

  if (replaced !== null) {
    replaced.isRetiring = false;
  }

  if (reason === "burnt" || reason === "destroyed") {
    context.chronicle.record({
      category: "warning",
      text: `${tribe.name} lost their ${BUILDINGS[building.kind].name.toLowerCase()}`,
      tribeId: tribe.id,
      x: building.x,
      z: building.z,
    });
  }

  assignHomes(tribe, context.buildings, context.people.membersOf(tribe));
}

function clearedId(id: number | null, lost: Building): number | null {
  if (id === lost.id) {
    return null;
  }

  return id;
}
