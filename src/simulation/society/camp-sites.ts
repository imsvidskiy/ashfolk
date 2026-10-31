import { Biome } from "../../content/biomes.ts";
import { isLivingTreeSpecies, plantSpeciesDefinition } from "../../content/plants.ts";
import { FULL_TURN } from "../../shared/math.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { aroundPoint, type Waypoint } from "../agents/navigation.ts";
import type { WorldState } from "../world/world-state.ts";
import type { SocietyContext } from "./society-context.ts";
import type { Tribe } from "./tribe.ts";

export const LONGEST_MIGRATION_DAYS = 1.5;

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
const MIGRANT_PACE = 2;
const MARSH_AVERSION = 6;
const ROCKY_BIOMES: ReadonlySet<number> = new Set([Biome.Alpine, Biome.Glacier]);

export interface SiteSearch {
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
  const shares = groundShares(surroundings);

  const isOpen = isOpenAround(shares);

  if (!(isOpen || search.canSettleRoughGround)) {
    return UNSUITABLE;
  }

  return (
    waterScore(world, point) +
    forageScore(surroundings) -
    marshScore(surroundings) -
    roughnessScore(shares) +
    climateScore(world, cell) +
    neighborScore(point, search, tribes) -
    world.slope(cell) * 6 -
    (isOpen ? 0 : ROUGH_GROUND_PENALTY)
  );
}

function isOpenAround(shares: GroundShares): boolean {
  return shares.meanSlope <= STEEPEST_MEAN_SLOPE && shares.openShare >= SMALLEST_OPEN_SHARE;
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

function groundShares(surroundings: Surroundings): GroundShares {
  return {
    meanSlope: surroundings.slopeSum / surroundings.nearSamples,
    openShare: surroundings.openSamples / surroundings.nearSamples,
    woodedShare: surroundings.woodedSamples / surroundings.nearSamples,
  };
}

function roughnessScore(shares: GroundShares): number {
  const { meanSlope, openShare, woodedShare } = shares;

  return meanSlope * 12 + (1 - openShare) * 4 + Math.max(0, woodedShare - CLOSED_CANOPY_SHARE) * 12;
}

function marshScore(surroundings: Surroundings): number {
  return (surroundings.marsh / surroundings.samples) * MARSH_AVERSION;
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
