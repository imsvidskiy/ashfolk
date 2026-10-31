import { lerp, wrapAngle } from "../../shared/math.ts";
import { HOP_REACH } from "../../world/brooks.ts";
import type { WorldState } from "../world/world-state.ts";
import type { Mover } from "./movement.ts";

const SAMPLE_SPACING = 0.25;
const LANDING_MARGIN = 0.4;
const SLACK = 4;
const LEAP_REACH = 1.4;
const TURN_RATE = 8;
const NOT_WET = -1;

export interface Hop {
  readonly directionX: number;
  readonly directionZ: number;
  readonly enterAt: number;
  readonly fromX: number;
  readonly fromZ: number;
  readonly leaveAt: number;
  readonly length: number;
  readonly level: number;
  readonly speed: number;
  travelled: number;
}

export interface Splash {
  readonly level: number;
  readonly x: number;
  readonly z: number;
}

interface WetStretch {
  readonly from: number;
  readonly landing: number;
  readonly level: number;
  readonly to: number;
}

export function isInOpenWater(world: WorldState, x: number, z: number): boolean {
  const cell = world.grid.cellAt(x, z);

  return cell >= 0 && world.isWater(cell) && world.crossingAt(x, z) === null;
}

export function isHopping(mover: Mover): boolean {
  return mover.hop !== null;
}

export function isLeaping(hop: Hop): boolean {
  return Math.min(Math.abs(hop.travelled - hop.enterAt), Math.abs(hop.travelled - hop.leaveAt)) < LEAP_REACH;
}

export function planHop(mover: Mover, heading: number, approach: number, speed: number, world: WorldState): Hop | null {
  if (isInOpenWater(world, mover.x, mover.z)) {
    return null;
  }

  const directionX = Math.sin(heading);
  const directionZ = Math.cos(heading);

  const stretch = wetStretchAhead(mover, directionX, directionZ, approach, world);

  if (stretch === null) {
    return null;
  }

  const landingX = mover.x + directionX * stretch.landing;
  const landingZ = mover.z + directionZ * stretch.landing;

  const isFirm =
    world.isWalkableAt(landingX, landingZ) && !world.isObstructedBetween(mover.x, mover.z, landingX, landingZ);

  if (!isFirm) {
    return null;
  }

  const shore = visibleShore(mover, directionX, directionZ, stretch, world);

  return {
    directionX,
    directionZ,
    enterAt: shore.from,
    fromX: mover.x,
    fromZ: mover.z,
    leaveAt: shore.to,
    length: stretch.landing,
    level: stretch.level,
    speed,
    travelled: 0,
  };
}

function wetStretchAhead(
  mover: Mover,
  directionX: number,
  directionZ: number,
  approach: number,
  world: WorldState
): WetStretch | null {
  let from = NOT_WET;
  let level = Number.NEGATIVE_INFINITY;

  for (let distance = SAMPLE_SPACING; distance <= approach + HOP_REACH + SLACK; distance += SAMPLE_SPACING) {
    const x = mover.x + directionX * distance;
    const z = mover.z + directionZ * distance;

    const cell = world.grid.cellAt(x, z);

    if (isInOpenWater(world, x, z)) {
      const isTooFar = from === NOT_WET ? distance > approach : distance - from > HOP_REACH + SLACK;

      if (isTooFar || !world.isBrook(cell)) {
        return null;
      }

      from = from === NOT_WET ? distance : from;
      level = Math.max(level, world.terrain.waterSurface[cell]);

      continue;
    }

    if (from === NOT_WET) {
      continue;
    }

    if (!world.isWalkable(cell)) {
      return null;
    }

    return { from, landing: distance + LANDING_MARGIN, level, to: distance };
  }

  return null;
}

function visibleShore(
  mover: Mover,
  directionX: number,
  directionZ: number,
  stretch: WetStretch,
  world: WorldState
): { from: number; to: number } {
  let from = NOT_WET;
  let to = NOT_WET;

  for (let distance = 0; distance <= stretch.landing; distance += SAMPLE_SPACING) {
    if (world.heightAt(mover.x + directionX * distance, mover.z + directionZ * distance) >= stretch.level) {
      continue;
    }

    from = from === NOT_WET ? distance : from;
    to = distance;
  }

  if (from === NOT_WET) {
    return { from: stretch.from, to: stretch.to };
  }

  return { from, to };
}

export function continueHop(mover: Mover, hop: Hop, seconds: number): void {
  const before = hop.travelled;

  hop.travelled = Math.min(hop.length, before + hop.speed * seconds);

  const amount = hop.travelled / hop.length;
  const heading = Math.atan2(hop.directionX, hop.directionZ);

  mover.x = lerp(hop.fromX, hop.fromX + hop.directionX * hop.length, amount);
  mover.z = lerp(hop.fromZ, hop.fromZ + hop.directionZ * hop.length, amount);
  mover.velocityX = hop.directionX * hop.speed;
  mover.velocityZ = hop.directionZ * hop.speed;
  mover.heading += wrapAngle(heading - mover.heading) * Math.min(1, seconds * TURN_RATE);

  for (const touch of [hop.enterAt, hop.leaveAt]) {
    if (before < touch && hop.travelled >= touch) {
      mover.splash = {
        level: hop.level,
        x: hop.fromX + hop.directionX * touch,
        z: hop.fromZ + hop.directionZ * touch,
      };
    }
  }

  if (hop.travelled >= hop.length) {
    mover.hop = null;
  }
}
