import { BUILDINGS, type BuildingKind, isEnclosure } from "../../content/buildings.ts";
import { DEPOSITS, type DepositKind, MINED_DEPOSIT_KINDS } from "../../content/deposits.ts";
import type { Deposit } from "../../world/deposits.ts";
import type { Waypoint } from "../agents/navigation.ts";
import type { WorldState } from "../world/world-state.ts";
import { type Building, isComplete, NO_DEPOSIT } from "./buildings.ts";
import { completedShelters, housingCapacity } from "./housing.ts";
import type { SocietyContext } from "./society-context.ts";
import { knows, type Tribe } from "./tribe.ts";
import { campPoint, tribeBuildings } from "./tribe-places.ts";

const DWELLING_LADDER: readonly BuildingKind[] = ["tent", "hut", "longhouse", "stoneHouse"];
const MAXIMUM_SHELTERS = 12;
const SPARE_BEDS = 2;
const MINE_SPREAD = 0.7;
const ENCLOSURE_MARGIN = 8;
const SMALLEST_ENCLOSURE = 42;
const SMALLEST_WALLED_CAMP = 5;
const NEAREST_DWELLING = 14;
const FARTHEST_DWELLING = 28;
const DWELLING_SPREAD = 2.4;
const FIELDS_FOR_GRANARY = 2;

export interface BuildingPlan {
  depositId: number;
  extent: number;
  farthest: number;
  kind: BuildingKind;
  nearest: number;
  origin: Waypoint;
  replacesId: number | null;
}

type Planner = (tribe: Tribe, context: SocietyContext, owned: readonly Building[]) => BuildingPlan | null;

const PLANNERS: readonly Planner[] = [
  singleBuilding("campfire", 0, 4),
  shelterPlan,
  singleBuilding("storehouse", 9, 18),
  singleBuilding("kiln", 18, 34),
  singleBuilding("granary", 10, 22, hasFields),
  minePlan,
  singleBuilding("smelter", 20, 36),
  singleBuilding("totem", 6, 12),
  upgradePlan,
  singleBuilding("workshop", 16, 32),
  singleBuilding("forge", 20, 36),
  enclosurePlan,
];

function campPlan(tribe: Tribe, kind: BuildingKind, nearest: number, farthest: number): BuildingPlan {
  return {
    depositId: NO_DEPOSIT,
    extent: 0,
    farthest,
    kind,
    nearest,
    origin: campPoint(tribe),
    replacesId: null,
  };
}

function isPostponed(tribe: Tribe, kind: BuildingKind, day: number): boolean {
  const until = tribe.postponed[kind];

  return until !== undefined && until > day;
}

function isUnlocked(tribe: Tribe, kind: BuildingKind, context: SocietyContext): boolean {
  return knows(tribe, BUILDINGS[kind].technology) && !isPostponed(tribe, kind, context.environment.day);
}

function bestDwelling(tribe: Tribe): BuildingKind | null {
  let best: BuildingKind | null = null;

  for (const kind of DWELLING_LADDER) {
    if (knows(tribe, BUILDINGS[kind].technology)) {
      best = kind;
    }
  }

  return best;
}

function dwellingReach(tribe: Tribe): number {
  return FARTHEST_DWELLING + tribe.buildings.shelterIds.length * DWELLING_SPREAD;
}

function shelterPlan(tribe: Tribe, context: SocietyContext): BuildingPlan | null {
  const kind = bestDwelling(tribe);

  if (kind === null || isPostponed(tribe, kind, context.environment.day)) {
    return null;
  }

  if (tribe.buildings.shelterIds.length >= MAXIMUM_SHELTERS) {
    return null;
  }

  if (housingCapacity(tribe, context.buildings) >= tribe.memberCount + SPARE_BEDS) {
    return null;
  }

  return campPlan(tribe, kind, NEAREST_DWELLING, dwellingReach(tribe));
}

function singleBuilding(
  kind: BuildingKind,
  nearest: number,
  farthest: number,
  isWanted: (tribe: Tribe) => boolean = () => {
    return true;
  }
): Planner {
  return (tribe, context, owned) => {
    const isBuilt = owned.some((building) => {
      return building.kind === kind;
    });

    if (!isUnlocked(tribe, kind, context) || isBuilt || !isWanted(tribe)) {
      return null;
    }

    return campPlan(tribe, kind, nearest, farthest);
  };
}

export function nearestDeposit(world: WorldState, kind: DepositKind, origin: Waypoint, reach: number): Deposit | null {
  let nearest: Deposit | null = null;
  let nearestDistance = reach;

  for (const deposit of world.deposits) {
    const distance = Math.hypot(deposit.x - origin.x, deposit.z - origin.z);

    if (deposit.kind === kind && distance < nearestDistance) {
      nearest = deposit;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function mineFor(tribe: Tribe, context: SocietyContext, kind: DepositKind): Building | null {
  return mineAmong(tribeBuildings(tribe, context.buildings), context.world, kind);
}

function mineAmong(owned: readonly Building[], world: WorldState, kind: DepositKind): Building | null {
  const mine = owned.find((building) => {
    if (building.kind !== "mine") {
      return false;
    }

    const deposit = world.depositById(building.depositId);

    return deposit !== null && deposit.kind === kind;
  });

  if (mine === undefined) {
    return null;
  }

  return mine;
}

function minePlan(tribe: Tribe, context: SocietyContext, owned: readonly Building[]): BuildingPlan | null {
  if (isPostponed(tribe, "mine", context.environment.day)) {
    return null;
  }

  for (const kind of MINED_DEPOSIT_KINDS) {
    if (!knows(tribe, DEPOSITS[kind].technology) || mineAmong(owned, context.world, kind) !== null) {
      continue;
    }

    const deposit = nearestDeposit(context.world, kind, campPoint(tribe), DEPOSITS[kind].reach);

    if (deposit === null) {
      continue;
    }

    return {
      ...campPlan(tribe, "mine", 0, DEPOSITS[kind].radius * MINE_SPREAD),
      depositId: deposit.id,
      origin: { x: deposit.x, z: deposit.z },
    };
  }

  return null;
}

function upgradePlan(tribe: Tribe, context: SocietyContext): BuildingPlan | null {
  const best = bestDwelling(tribe);

  if (best === null || isPostponed(tribe, best, context.environment.day)) {
    return null;
  }

  const rank = DWELLING_LADDER.indexOf(best);

  const outdated = completedShelters(tribe, context.buildings).find((shelter) => {
    return DWELLING_LADDER.indexOf(shelter.kind) < rank && !shelter.isRetiring;
  });

  if (outdated === undefined) {
    return null;
  }

  return { ...campPlan(tribe, best, NEAREST_DWELLING, dwellingReach(tribe)), replacesId: outdated.id };
}

function bestEnclosure(tribe: Tribe): BuildingKind | null {
  if (knows(tribe, "masonry")) {
    return "stoneWall";
  }

  if (knows(tribe, "bronze")) {
    return "palisade";
  }

  return null;
}

function enclosureAmong(owned: readonly Building[]): Building | null {
  const enclosure = owned.find((building) => {
    return isEnclosure(building.kind);
  });

  if (enclosure === undefined) {
    return null;
  }

  return enclosure;
}

function campReach(tribe: Tribe, owned: readonly Building[]): number {
  let reach = 0;

  for (const building of owned) {
    if (building.kind === "mine" || isEnclosure(building.kind)) {
      continue;
    }

    const distance = Math.hypot(building.x - tribe.campX, building.z - tribe.campZ);

    reach = Math.max(reach, distance + BUILDINGS[building.kind].footprint);
  }

  return reach;
}

function enclosurePlan(tribe: Tribe, context: SocietyContext, owned: readonly Building[]): BuildingPlan | null {
  const best = bestEnclosure(tribe);

  if (best === null || isPostponed(tribe, best, context.environment.day)) {
    return null;
  }

  const existing = enclosureAmong(owned);

  if (existing !== null && (existing.kind === best || !isComplete(existing))) {
    return null;
  }

  const campBuildings = owned.filter((building) => {
    return building.kind !== "mine" && isComplete(building);
  });

  if (campBuildings.length < SMALLEST_WALLED_CAMP) {
    return null;
  }

  const extent = Math.max(SMALLEST_ENCLOSURE, campReach(tribe, owned) + ENCLOSURE_MARGIN);

  return {
    ...campPlan(tribe, best, 0, 0),
    extent,
    replacesId: existing === null ? null : existing.id,
  };
}

function hasFields(tribe: Tribe): boolean {
  return tribe.fields.length >= FIELDS_FOR_GRANARY;
}

function keptInside(plan: BuildingPlan, enclosure: Building | null): BuildingPlan {
  if (enclosure === null || plan.kind === "mine" || isEnclosure(plan.kind)) {
    return plan;
  }

  const inside = enclosure.extent - BUILDINGS[plan.kind].footprint - ENCLOSURE_MARGIN / 2;

  return { ...plan, farthest: Math.min(plan.farthest, inside), nearest: Math.min(plan.nearest, inside) };
}

export function buildingPlans(tribe: Tribe, context: SocietyContext): BuildingPlan[] {
  const owned = tribeBuildings(tribe, context.buildings);
  const enclosure = enclosureAmong(owned);

  const plans: BuildingPlan[] = [];

  for (const planner of PLANNERS) {
    const plan = planner(tribe, context, owned);

    if (plan !== null) {
      plans.push(keptInside(plan, enclosure));
    }
  }

  return plans;
}
