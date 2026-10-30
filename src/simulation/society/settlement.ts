import { Biome } from "../../content/biomes.ts";
import { DEPOSITS } from "../../content/deposits.ts";
import { isLivingTreeSpecies, plantSpeciesDefinition } from "../../content/plants.ts";
import { FULL_TURN } from "../../shared/math.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { aroundPoint, type Waypoint } from "../agents/navigation.ts";
import type { WorldState } from "../world/world-state.ts";
import { dropJob } from "./decisions.ts";
import { abandonFields } from "./farming.ts";
import { assignHomes } from "./housing.ts";
import { isChild, isElder, type Person } from "./person.ts";
import { abandonPlots } from "./plots.ts";
import { syncEra } from "./progress.ts";
import { prospectingMove } from "./prospecting.ts";
import type { SocietyContext } from "./society-context.ts";
import { shareFood, totalFood } from "./stock.ts";
import { isWorthLookingFor, type Tribe } from "./tribe.ts";
import { campfireOf, campPoint } from "./tribe-places.ts";

const UNSUITABLE = Number.NEGATIVE_INFINITY;
const CAMP_SLOPE = 0.22;
const RIM_MARGIN = 120;
const WATER_SAMPLES = 24;
const NEAR_WATER = 300;
const TOO_CLOSE_TO_WATER = 35;
const FORAGE_REACH_CELLS = 14;
const OPEN_REACH = 80;
const GENTLE_SLOPE = 0.3;
const STEEPEST_MEAN_SLOPE = 0.24;
const SMALLEST_OPEN_SHARE = 0.5;
const CLOSED_CANOPY_SHARE = 0.25;
const ROUGH_GROUND_PENALTY = 6;
const SITE_ATTEMPTS = 90;
const ACCEPTABLE_SCORE = -5;
const DEFAULT_NEIGHBOR_DISTANCE = 500;
const SPLIT_NEIGHBOR_DISTANCE = 650;
const MOVE_SEARCH_RADIUS = 900;
const SPLIT_SEARCH_RADIUS = 1500;
const SPLIT_POPULATION = 16;
const SPLIT_ADULTS = 8;
const MAXIMUM_TRIBES = 10;
const LATEST_SPLIT_SEASON = 2.3;
const SPLIT_SHARE = 0.4;
const YOUNG_ADULT_AGE = 32;
const SETTLED_DISTANCE = 60;
const SETTLED_SHARE = 0.7;
const LONGEST_MIGRATION_DAYS = 1.5;
const MIGRANT_PACE = 2;
const BURNT_CAMP = 0.8;
const PROSPECTING_SHARE = 0.5;
const MARSH_AVERSION = 6;
const ROCKY_BIOMES: ReadonlySet<number> = new Set([Biome.Alpine, Biome.Glacier]);

interface SiteSearch {
  canSettleRoughGround: boolean;
  excluded: Tribe | null;
  isNearOrigin: boolean;
  minimumNeighborDistance: number;
  origin: Waypoint;
  radius: number;
}

interface GroundShares {
  meanSlope: number;
  openShare: number;
  woodedShare: number;
}

interface Surroundings {
  bushes: number;
  marsh: number;
  nearSamples: number;
  openSamples: number;
  samples: number;
  slopeSum: number;
  trees: number;
  woodedSamples: number;
}

export function scoreSite(
  point: Waypoint,
  search: SiteSearch,
  context: SocietyContext,
  tribes: readonly Tribe[]
): number {
  const { world } = context;

  const cell = world.grid.cellAt(point.x, point.z);
  const longestWalk = LONGEST_MIGRATION_DAYS * context.environment.daySeconds * MIGRANT_PACE;

  if (!(isCampable(world, cell, point) && context.navigation.walkLength(search.origin, point) <= longestWalk)) {
    return UNSUITABLE;
  }

  const surroundings = surveySurroundings(world, cell);

  const isOpen = isOpenAround(surroundings);

  if (!(isOpen || search.canSettleRoughGround)) {
    return UNSUITABLE;
  }

  return (
    waterScore(world, point) +
    forageScore(surroundings) -
    marshScore(surroundings) -
    roughnessScore(surroundings) +
    climateScore(world, cell) +
    neighborScore(point, search, tribes) -
    world.slope(cell) * 6 -
    (isOpen ? 0 : ROUGH_GROUND_PENALTY)
  );
}

function isOpenAround(surroundings: Surroundings): boolean {
  const shares = groundShares(surroundings);

  return shares !== null && shares.meanSlope <= STEEPEST_MEAN_SLOPE && shares.openShare >= SMALLEST_OPEN_SHARE;
}

function isCampable(world: WorldState, cell: number, point: Waypoint): boolean {
  if (!world.isWalkable(cell) || world.slope(cell) > CAMP_SLOPE || world.isBurning(cell)) {
    return false;
  }

  if (world.terrain.biome[cell] === Biome.Swamp || ROCKY_BIOMES.has(world.terrain.biome[cell])) {
    return false;
  }

  return world.grid.isInside(point.x, point.z, RIM_MARGIN) && world.terrain.coastDistance[cell] > RIM_MARGIN;
}

function waterScore(world: WorldState, point: Waypoint): number {
  let nearestWater = isBesideWater(world, point) ? 0 : Number.POSITIVE_INFINITY;

  for (let sample = 0; sample < WATER_SAMPLES; sample += 1) {
    const angle = (sample / WATER_SAMPLES) * FULL_TURN;
    const distance = 40 + (sample % 4) * 60;

    if (world.isWaterAt(point.x + Math.cos(angle) * distance, point.z + Math.sin(angle) * distance)) {
      nearestWater = Math.min(nearestWater, distance);
    }
  }

  if (nearestWater >= NEAR_WATER) {
    return -2;
  }

  const closeness = 3 - nearestWater / 120;

  if (nearestWater < TOO_CLOSE_TO_WATER) {
    return closeness - 3;
  }

  return closeness;
}

function isBesideWater(world: WorldState, point: Waypoint): boolean {
  return world.grid.cellsInRadius(point.x, point.z, TOO_CLOSE_TO_WATER).some((cell) => {
    return world.isWater(cell);
  });
}

function surveySurroundings(world: WorldState, center: number): Surroundings {
  const { grid } = world;

  const centerColumn = grid.columnOf(center);
  const centerRow = grid.rowOf(center);
  const openReachCells = OPEN_REACH / grid.cellSize;

  const surroundings: Surroundings = {
    bushes: 0,
    marsh: 0,
    nearSamples: 0,
    openSamples: 0,
    samples: 0,
    slopeSum: 0,
    trees: 0,
    woodedSamples: 0,
  };

  for (let rowOffset = -FORAGE_REACH_CELLS; rowOffset <= FORAGE_REACH_CELLS; rowOffset += 2) {
    for (let columnOffset = -FORAGE_REACH_CELLS; columnOffset <= FORAGE_REACH_CELLS; columnOffset += 2) {
      const column = centerColumn + columnOffset;
      const row = centerRow + rowOffset;

      if (!grid.contains(column, row)) {
        continue;
      }

      const isNear = Math.hypot(columnOffset, rowOffset) <= openReachCells;

      countSurroundings(world, grid.index(column, row), isNear, surroundings);
    }
  }

  return surroundings;
}

function forageScore(surroundings: Surroundings): number {
  return Math.min(4, surroundings.bushes * 0.4) + Math.min(2.5, surroundings.trees * 0.06);
}

function groundShares(surroundings: Surroundings): GroundShares | null {
  if (surroundings.nearSamples === 0) {
    return null;
  }

  return {
    meanSlope: surroundings.slopeSum / surroundings.nearSamples,
    openShare: surroundings.openSamples / surroundings.nearSamples,
    woodedShare: surroundings.woodedSamples / surroundings.nearSamples,
  };
}

function roughnessScore(surroundings: Surroundings): number {
  const shares = groundShares(surroundings);

  if (shares === null) {
    return 0;
  }

  const { meanSlope, openShare, woodedShare } = shares;

  return meanSlope * 12 + (1 - openShare) * 4 + Math.max(0, woodedShare - CLOSED_CANOPY_SHARE) * 12;
}

function marshScore(surroundings: Surroundings): number {
  return surroundings.samples === 0 ? 0 : (surroundings.marsh / surroundings.samples) * MARSH_AVERSION;
}

function countSurroundings(world: WorldState, cell: number, isNear: boolean, surroundings: Surroundings): void {
  const { terrain, vegetation } = world;

  const isMarsh = terrain.biome[cell] === Biome.Swamp;

  let trees = 0;

  for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
    if (!vegetation.isAlive(plant)) {
      continue;
    }

    const species = vegetation.species[plant];

    surroundings.bushes += plantSpeciesDefinition(species).givesBerries ? 1 : 0;
    trees += isLivingTreeSpecies(species) ? 1 : 0;
  }

  surroundings.samples += 1;
  surroundings.marsh += isMarsh ? 1 : 0;
  surroundings.trees += trees;

  if (!isNear || world.isWater(cell)) {
    return;
  }

  const slope = world.slope(cell);
  const isBuildable =
    world.isWalkable(cell) && slope <= GENTLE_SLOPE && !isMarsh && !ROCKY_BIOMES.has(terrain.biome[cell]);

  surroundings.nearSamples += 1;
  surroundings.slopeSum += slope;
  surroundings.woodedSamples += trees > 0 ? 1 : 0;
  surroundings.openSamples += isBuildable && trees === 0 ? 1 : 0;
}

function climateScore(world: WorldState, cell: number): number {
  const biome = world.terrain.biome[cell];
  const temperature = world.terrain.baseTemperature[cell];

  const hostility = biome === Biome.Desert || biome === Biome.Glacier ? 5 : 0;

  if (temperature > 6) {
    return 2 - hostility;
  }

  if (temperature > 3) {
    return -hostility;
  }

  return -4 - hostility;
}

function neighborScore(point: Waypoint, search: SiteSearch, tribes: readonly Tribe[]): number {
  let penalty = 0;

  for (const tribe of tribes) {
    const distance = Math.hypot(tribe.campX - point.x, tribe.campZ - point.z);

    if (tribe !== search.excluded && distance < search.minimumNeighborDistance) {
      penalty += 8 * (1 - distance / search.minimumNeighborDistance) + 2;
    }
  }

  return -penalty;
}

export function findCampSite(search: SiteSearch, context: SocietyContext, tribes: readonly Tribe[]): Waypoint | null {
  const { random } = context;

  const innerShare = search.isNearOrigin ? 0.15 : 0.35;
  const nearnessWeight = search.isNearOrigin ? 2 : 0;

  let best: Waypoint | null = null;
  let bestScore = ACCEPTABLE_SCORE;

  for (let attempt = 0; attempt < SITE_ATTEMPTS; attempt += 1) {
    const angle = random.next() * FULL_TURN;
    const distance = innerShare * search.radius + random.next() * search.radius * (1 - innerShare);

    const point = aroundPoint(search.origin, distance, angle);

    const score = scoreSite(point, search, context, tribes) - (distance / search.radius) * nearnessWeight;

    if (score > bestScore) {
      best = point;
      bestScore = score;
    }
  }

  return best;
}

export function siteSearchNear(origin: Waypoint, radius: number, excluded: Tribe | null): SiteSearch {
  return {
    canSettleRoughGround: false,
    excluded,
    isNearOrigin: false,
    minimumNeighborDistance: DEFAULT_NEIGHBOR_DISTANCE,
    origin,
    radius,
  };
}

export function updateMigration(tribe: Tribe, members: readonly Person[], context: SocietyContext): void {
  const arrived = members.filter((person) => {
    return Math.hypot(person.mover.x - tribe.campX, person.mover.z - tribe.campZ) < SETTLED_DISTANCE;
  });

  const isLongOverdue = context.environment.day - tribe.migrationStartDay > LONGEST_MIGRATION_DAYS;

  if (arrived.length >= members.length * SETTLED_SHARE) {
    tribe.isMigrating = false;

    return;
  }

  if (isLongOverdue) {
    tribe.isMigrating = false;
    settleWhereTheyStand(tribe, members);
  }
}

function settleWhereTheyStand(tribe: Tribe, members: readonly Person[]): void {
  const centerX =
    members.reduce((sum, person) => {
      return sum + person.mover.x;
    }, 0) / members.length;
  const centerZ =
    members.reduce((sum, person) => {
      return sum + person.mover.z;
    }, 0) / members.length;

  const [nearest] = [...members].sort((first, second) => {
    return (
      Math.hypot(first.mover.x - centerX, first.mover.z - centerZ) -
      Math.hypot(second.mover.x - centerX, second.mover.z - centerZ)
    );
  });

  if (Math.hypot(nearest.mover.x - tribe.campX, nearest.mover.z - tribe.campZ) < SETTLED_DISTANCE) {
    return;
  }

  tribe.campX = nearest.mover.x;
  tribe.campZ = nearest.mover.z;
}

function reasonToMove(tribe: Tribe, context: SocietyContext): string | null {
  const { environment, world } = context;

  const cell = world.grid.cellAt(tribe.campX, tribe.campZ);

  if (cell < 0 || world.isWater(cell)) {
    return "water flooded the camp";
  }

  if (world.fields.scorch[cell] > BURNT_CAMP && campfireOf(tribe, context.buildings) === null) {
    return "the camp burnt down";
  }

  const isStarving =
    totalFood(tribe.stock) < 1 &&
    !isWorthLookingFor(tribe, "berries", environment.day, 0.6) &&
    !isWorthLookingFor(tribe, "game", environment.day, 0.6);

  if (isStarving) {
    return "there was no food left nearby";
  }

  return null;
}

export function considerMoving(tribe: Tribe, members: readonly Person[], context: SocietyContext): void {
  const reason = reasonToMove(tribe, context);

  if (reason === null) {
    prospect(tribe, members, context);

    return;
  }

  const site = findCampSite(
    { ...siteSearchNear(campPoint(tribe), MOVE_SEARCH_RADIUS, tribe), canSettleRoughGround: true },
    context,
    context.people.tribes()
  );

  if (site !== null) {
    moveCamp(tribe, members, site, reason, context);
  }
}

function prospect(tribe: Tribe, members: readonly Person[], context: SocietyContext): void {
  const move = prospectingMove(tribe, context);

  if (move === null) {
    return;
  }

  const search: SiteSearch = {
    canSettleRoughGround: false,
    excluded: tribe,
    isNearOrigin: true,
    minimumNeighborDistance: DEFAULT_NEIGHBOR_DISTANCE,
    origin: move.origin,
    radius: DEPOSITS[move.kind].reach * PROSPECTING_SHARE,
  };

  const site = findCampSite(search, context, context.people.tribes());

  if (site === null) {
    tribe.migrationStartDay = context.environment.day;

    return;
  }

  moveCamp(tribe, members, site, move.reason, context);
}

function moveCamp(
  tribe: Tribe,
  members: readonly Person[],
  site: Waypoint,
  reason: string,
  context: SocietyContext
): void {
  context.buildings.abandonTribe(tribe.id);
  tribe.campX = site.x;
  tribe.campZ = site.z;
  tribe.isMigrating = true;
  tribe.migrationStartDay = context.environment.day;
  abandonFields(tribe, context.world);
  abandonPlots(tribe, context.world);
  tribe.claimedPlants.clear();

  for (const person of members) {
    if (person.job?.kind !== "flee") {
      dropJob(tribe, person);
    }
  }

  context.chronicle.record({
    category: "migration",
    text: `${tribe.name} set out for a new camp: ${reason}`,
    tribeId: tribe.id,
    x: site.x,
    z: site.z,
  });
}

function canSplit(tribe: Tribe, members: readonly Person[], context: SocietyContext): boolean {
  if (members.length < SPLIT_POPULATION || tribe.isMigrating || context.people.tribes().length >= MAXIMUM_TRIBES) {
    return false;
  }

  if (context.environment.season >= LATEST_SPLIT_SEASON) {
    return false;
  }

  return (
    members.filter((person) => {
      return !isChild(person);
    }).length >= SPLIT_ADULTS
  );
}

function chooseSettlers(members: readonly Person[]): Person[] {
  const youngAdults = members
    .filter((person) => {
      return !isChild(person) && person.age < YOUNG_ADULT_AGE;
    })
    .sort((first, second) => {
      return first.age - second.age;
    });

  const women = youngAdults
    .filter((person) => {
      return person.isFemale;
    })
    .slice(0, 2);
  const men = youngAdults
    .filter((person) => {
      return !person.isFemale;
    })
    .slice(0, 2);

  if (women.length === 0 || men.length === 0) {
    return [];
  }

  const settlers = [...women, ...men];
  const wanted = Math.round(members.length * SPLIT_SHARE);

  for (const person of members) {
    if (settlers.length < wanted && !settlers.includes(person) && !isElder(person)) {
      settlers.push(person);
    }
  }

  return settlers;
}

function moveToTribe(person: Person, from: Tribe, to: Tribe): void {
  dropJob(from, person);
  from.memberCount -= 1;
  to.memberCount += 1;
  person.tribeId = to.id;
  person.homeId = null;
}

export function considerSplit(tribe: Tribe, members: readonly Person[], context: SocietyContext): void {
  if (!canSplit(tribe, members, context)) {
    return;
  }

  const settlers = chooseSettlers(members);

  if (settlers.length === 0) {
    return;
  }

  const search: SiteSearch = {
    ...siteSearchNear(campPoint(tribe), SPLIT_SEARCH_RADIUS, tribe),
    minimumNeighborDistance: SPLIT_NEIGHBOR_DISTANCE,
  };

  const site = findCampSite(search, context, context.people.tribes());

  if (site === null) {
    return;
  }

  const offshoot = context.people.createTribe(site.x, site.z);

  offshoot.originId = tribe.id;
  shareWithOffshoot(tribe, offshoot, context);

  for (const person of settlers) {
    moveToTribe(person, tribe, offshoot);
  }

  assignHomes(tribe, context.buildings, context.people.membersOf(tribe));

  context.chronicle.record({
    category: "split",
    text: `${tribe.name} split up: ${offshoot.name} left to find new land`,
    tribeId: tribe.id,
    x: site.x,
    z: site.z,
  });
}

function shareWithOffshoot(tribe: Tribe, offshoot: Tribe, context: SocietyContext): void {
  const wood = Math.floor(tribe.stock.wood * 0.3);
  const spears = Math.floor(tribe.stock.spears * 0.4);

  for (const technology of tribe.technologies) {
    offshoot.technologies.add(technology);
  }

  syncEra(offshoot);
  offshoot.stock = shareFood(tribe.stock, 0.35);
  offshoot.knowledge = tribe.knowledge * 0.5;
  offshoot.tools = tribe.tools;
  offshoot.stock.wood = wood;
  offshoot.stock.spears = spears;
  offshoot.isMigrating = true;
  offshoot.migrationStartDay = context.environment.day;
  tribe.stock.wood -= wood;
  tribe.stock.spears -= spears;
}
