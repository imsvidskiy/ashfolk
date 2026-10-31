import { clamp } from "../../../shared/math.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import type { Building } from "../buildings.ts";
import type { Tribe } from "../tribe.ts";

const CLAIM_BASE = 170;
const CLAIM_PER_PERSON = 13;
const CLAIM_PER_BUILDING = 16;
const LARGEST_CLAIM = 520;
const RANGE_SCALE = 2;
const OUTPOST_REACH = 40;

export interface Claim {
  readonly radius: number;
  readonly range: number;
  readonly tribeId: number;
  readonly x: number;
  readonly z: number;
}

export function claimRadius(population: number, buildingCount: number): number {
  return clamp(
    CLAIM_BASE + CLAIM_PER_PERSON * population + CLAIM_PER_BUILDING * buildingCount,
    CLAIM_BASE,
    LARGEST_CLAIM
  );
}

function farthestBuilding(tribe: Tribe, buildings: readonly Building[]): number {
  let farthest = 0;

  for (const building of buildings) {
    farthest = Math.max(farthest, Math.hypot(building.x - tribe.campX, building.z - tribe.campZ));
  }

  return farthest;
}

export function claimOf(tribe: Tribe, buildings: readonly Building[]): Claim {
  const radius = Math.max(
    claimRadius(tribe.memberCount, buildings.length),
    farthestBuilding(tribe, buildings) + OUTPOST_REACH
  );

  return { radius, range: radius * RANGE_SCALE, tribeId: tribe.id, x: tribe.campX, z: tribe.campZ };
}

function distanceBetween(first: Claim, second: Claim): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

export function claimOverlap(first: Claim, second: Claim): number {
  const overlap = first.radius + second.radius - distanceBetween(first, second);

  return clamp(overlap / Math.min(first.radius, second.radius), 0, 1);
}

export function rangeOverlap(first: Claim, second: Claim): number {
  const overlap = first.range + second.range - distanceBetween(first, second);

  return clamp(overlap / Math.min(first.range, second.range), 0, 1);
}

export function isInsideClaim(claim: Claim, point: Waypoint): boolean {
  return Math.hypot(point.x - claim.x, point.z - claim.z) < claim.radius;
}
