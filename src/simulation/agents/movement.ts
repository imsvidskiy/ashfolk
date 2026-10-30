import { groundDefinition } from "../../content/grounds.ts";
import { distanceToSegment, wrapAngle } from "../../shared/math.ts";
import type { Obstacle } from "../world/obstacles.ts";
import type { WorldState } from "../world/world-state.ts";
import { continueHop, type Hop, isInOpenWater, planHop, type Splash } from "./hops.ts";
import type { NavigationGrid, Waypoint } from "./navigation.ts";

const FINAL_ARRIVAL_DISTANCE = 1.2;
const WAYPOINT_ARRIVAL_DISTANCE = 6;
const CLOSE_ARRIVAL_DISTANCE = 0.4;
const SWIMMING_SPEED = 0.45;
const DEFLECTIONS: readonly number[] = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9];
const PROBE_DISTANCE = 2.5;
const WATER_SAMPLE_SPACING = 0.25;
const BOUNDARY_MARGIN = 0.001;
const CLIMBABLE_SLOPE = 1.2;
const GIVE_UP_SECONDS = 2.5;
const TURN_RATE = 8;
const UPHILL_DRAG = 1.6;
const DEFLECTION_FRUSTRATION = 0.3;
const REPLAN_PROGRESS = 2;
const MAXIMUM_FUTILE_REPLANS = 3;
const HOP_DEFLECTION = 0.7;
const PERSON_RADIUS = 0.3;
const OBSTACLE_LOOKAHEAD = 1;
const OBSTACLE_SCAN = 4;

export interface Mover {
  arrivalDistance: number;
  closestReplanDistance: number;
  futileReplans: number;
  goalX: number;
  goalZ: number;
  heading: number;
  hop: Hop | null;
  hopSpeed: number;
  nearbyObstacles: readonly Obstacle[];
  path: Waypoint[];
  pathIndex: number;
  radius: number;
  scannedX: number;
  scannedZ: number;
  splash: Splash | null;
  stuckSeconds: number;
  velocityX: number;
  velocityZ: number;
  x: number;
  z: number;
}

interface RouteOptions {
  readonly arrivalDistance?: number;
  readonly canPlanRoute?: boolean;
}

interface StepAttempt {
  isEscapingWater: boolean;
  isLeavingWater: boolean;
  obstacles: readonly Obstacle[];
  seconds: number;
  speed: number;
  step: number;
}

export function createMover(x: number, z: number, heading: number, radius = PERSON_RADIUS): Mover {
  return {
    arrivalDistance: FINAL_ARRIVAL_DISTANCE,
    closestReplanDistance: Number.POSITIVE_INFINITY,
    futileReplans: 0,
    goalX: x,
    goalZ: z,
    heading,
    hop: null,
    hopSpeed: 0,
    nearbyObstacles: [],
    path: [],
    pathIndex: 0,
    radius,
    scannedX: Number.POSITIVE_INFINITY,
    scannedZ: Number.POSITIVE_INFINITY,
    splash: null,
    stuckSeconds: 0,
    velocityX: 0,
    velocityZ: 0,
    x,
    z,
  };
}

export function savedMover(mover: Mover, shouldKeepRoute: boolean): Mover {
  const saved: Mover = structuredClone({ ...mover, nearbyObstacles: [] });

  forgetObstacles(saved);

  if (shouldKeepRoute) {
    return saved;
  }

  saved.arrivalDistance = FINAL_ARRIVAL_DISTANCE;
  saved.goalX = saved.x;
  saved.goalZ = saved.z;
  saved.path = [];
  saved.pathIndex = 0;
  saved.stuckSeconds = 0;
  saved.velocityX = 0;
  saved.velocityZ = 0;
  forgetReplans(saved);

  return saved;
}

export function setDestination(
  mover: Mover,
  destination: Waypoint,
  navigation: NavigationGrid,
  options: RouteOptions = {}
): void {
  const { arrivalDistance = FINAL_ARRIVAL_DISTANCE, canPlanRoute = true } = options;

  const landing = navigation.reachableSpot(mover, navigation.landingSpot(destination));

  mover.arrivalDistance = arrivalDistance;
  mover.goalX = landing.x;
  mover.goalZ = landing.z;
  mover.path = planRoute(mover, landing, navigation, canPlanRoute);
  mover.pathIndex = 0;
  forgetReplans(mover);
  forgetObstacles(mover);
  mover.stuckSeconds = 0;
}

function planRoute(mover: Mover, destination: Waypoint, navigation: NavigationGrid, canPlanRoute: boolean): Waypoint[] {
  const route = canPlanRoute ? navigation.findPath(mover, destination) : null;

  if (route === null) {
    return [{ x: destination.x, z: destination.z }];
  }

  return route;
}

export function hasArrived(mover: Mover): boolean {
  return mover.pathIndex >= mover.path.length;
}

export function stopMoving(mover: Mover): void {
  mover.velocityX = 0;
  mover.velocityZ = 0;
}

export function placeMover(mover: Mover, x: number, z: number): void {
  mover.x = x;
  mover.z = z;
  mover.goalX = x;
  mover.goalZ = z;
  mover.hop = null;
  mover.path = [];
  mover.pathIndex = 0;
  mover.stuckSeconds = 0;
  stopMoving(mover);
  forgetReplans(mover);
  forgetObstacles(mover);
}

export function faceTowards(mover: Mover, x: number, z: number): void {
  mover.heading = Math.atan2(x - mover.x, z - mover.z);
}

export function isStranded(mover: Mover, world: WorldState): boolean {
  return mover.hop === null && isInOpenWater(world, mover.x, mover.z);
}

export function moveAlong(
  mover: Mover,
  seconds: number,
  speed: number,
  world: WorldState,
  navigation: NavigationGrid
): boolean {
  if (mover.hop !== null) {
    continueHop(mover, mover.hop, seconds);

    return false;
  }

  if (isStranded(mover, world)) {
    wadeAshore(
      mover,
      {
        isEscapingWater: true,
        isLeavingWater: true,
        obstacles: [],
        seconds,
        speed,
        step: speed * SWIMMING_SPEED * seconds,
      },
      world,
      navigation
    );

    return false;
  }

  if (hasArrived(mover)) {
    stopMoving(mover);

    return true;
  }

  const waypoint = mover.path[mover.pathIndex];

  const distanceLeft = Math.hypot(waypoint.x - mover.x, waypoint.z - mover.z);
  const step = Math.min(distanceLeft, speed * terrainSpeedFactor(mover, world) * seconds);
  const obstacles = obstaclesOnTheWay(mover, step, world);

  if (
    distanceLeft < arrivalDistanceAt(mover, distanceLeft, world, navigation) ||
    isBehindObstacle(mover, waypoint, distanceLeft, obstacles)
  ) {
    mover.pathIndex += 1;
    stopMoving(mover);

    return hasArrived(mover);
  }

  const desiredHeading = Math.atan2(waypoint.x - mover.x, waypoint.z - mover.z);

  if (
    !tryStep(
      mover,
      desiredHeading,
      { isEscapingWater: false, isLeavingWater: false, obstacles, seconds, speed, step },
      world,
      navigation
    )
  ) {
    stopMoving(mover);
    mover.stuckSeconds += seconds;
  }

  if (mover.stuckSeconds <= GIVE_UP_SECONDS) {
    return false;
  }

  return replan(mover, navigation);
}

function arrivalDistanceAt(mover: Mover, distanceLeft: number, world: WorldState, navigation: NavigationGrid): number {
  const waypoint = mover.path[mover.pathIndex];
  const next = mover.path[mover.pathIndex + 1];

  if (next === undefined) {
    return mover.arrivalDistance;
  }

  if (world.crossingAt(waypoint.x, waypoint.z) !== null || world.crossingAt(mover.x, mover.z) !== null) {
    return CLOSE_ARRIVAL_DISTANCE;
  }

  if (distanceLeft >= WAYPOINT_ARRIVAL_DISTANCE || navigation.isClear(mover, next)) {
    return WAYPOINT_ARRIVAL_DISTANCE;
  }

  return CLOSE_ARRIVAL_DISTANCE;
}

function terrainSpeedFactor(mover: Mover, world: WorldState): number {
  const cell = world.grid.cellAt(mover.x, mover.z);

  if (cell < 0 || world.crossingAt(mover.x, mover.z) !== null) {
    return 1;
  }

  if (world.isWater(cell)) {
    return SWIMMING_SPEED;
  }

  return groundDefinition(world.terrain.ground[cell]).walkSpeed;
}

function tryStep(
  mover: Mover,
  desiredHeading: number,
  attempt: StepAttempt,
  world: WorldState,
  navigation: NavigationGrid
): boolean {
  if (stepTowards(mover, desiredHeading, attempt, world)) {
    return true;
  }

  const shore = navigation.stepAshore(mover.x, mover.z);

  if (shore === null) {
    return false;
  }

  const shoreHeading = Math.atan2(shore.x - mover.x, shore.z - mover.z);

  return stepTowards(mover, shoreHeading, { ...attempt, isEscapingWater: true, obstacles: [] }, world);
}

function wadeAshore(mover: Mover, attempt: StepAttempt, world: WorldState, navigation: NavigationGrid): void {
  if (stepTowardsWaypoint(mover, attempt, world)) {
    return;
  }

  const shore = navigation.stepAshore(mover.x, mover.z);

  if (shore === null) {
    stopMoving(mover);

    return;
  }

  const distance = Math.min(attempt.step, Math.hypot(shore.x - mover.x, shore.z - mover.z));

  advance(mover, Math.atan2(shore.x - mover.x, shore.z - mover.z), distance, attempt.seconds);
}

function stepTowardsWaypoint(mover: Mover, attempt: StepAttempt, world: WorldState): boolean {
  if (hasArrived(mover)) {
    return false;
  }

  const waypoint = mover.path[mover.pathIndex];

  return stepTowards(mover, Math.atan2(waypoint.x - mover.x, waypoint.z - mover.z), attempt, world);
}

function advance(mover: Mover, heading: number, distance: number, seconds: number): void {
  const directionX = Math.sin(heading);
  const directionZ = Math.cos(heading);

  mover.velocityX = (directionX * distance) / seconds;
  mover.velocityZ = (directionZ * distance) / seconds;
  mover.x += directionX * distance;
  mover.z += directionZ * distance;
  mover.heading += wrapAngle(heading - mover.heading) * Math.min(1, seconds * TURN_RATE);
}

function stepTowards(mover: Mover, desiredHeading: number, attempt: StepAttempt, world: WorldState): boolean {
  const { seconds, step } = attempt;

  const probe = Math.max(step, PROBE_DISTANCE);

  for (const deflection of DEFLECTIONS) {
    const heading = desiredHeading + deflection;

    const directionX = Math.sin(heading);
    const directionZ = Math.cos(heading);

    const probeX = mover.x + directionX * probe;
    const probeZ = mover.z + directionZ * probe;

    const isClearOfObstacles = !isBlocked(mover, heading, Math.max(step, OBSTACLE_LOOKAHEAD), attempt.obstacles);

    if (!(isClearOfObstacles && mayStepTo(mover, probeX, probeZ, attempt, world))) {
      if (
        isClearOfObstacles &&
        Math.abs(deflection) <= HOP_DEFLECTION &&
        !attempt.isEscapingWater &&
        startHop(mover, heading, attempt, world)
      ) {
        return true;
      }

      continue;
    }

    const rise = world.heightAt(probeX, probeZ) - world.heightAt(mover.x, mover.z);

    advance(mover, heading, step * uphillSlowdown(rise, probe), seconds);

    if (deflection !== 0) {
      mover.stuckSeconds += seconds * DEFLECTION_FRUSTRATION;
    }

    return true;
  }

  return false;
}

function startHop(mover: Mover, heading: number, attempt: StepAttempt, world: WorldState): boolean {
  const hop = planHop(mover, heading, PROBE_DISTANCE, Math.max(attempt.speed, mover.hopSpeed), world);

  if (hop === null) {
    return false;
  }

  mover.hop = hop;
  continueHop(mover, hop, attempt.seconds);

  return true;
}

function obstaclesOnTheWay(mover: Mover, step: number, world: WorldState): readonly Obstacle[] {
  const reach = Math.max(step, OBSTACLE_LOOKAHEAD) + mover.radius;
  const moved = Math.hypot(mover.x - mover.scannedX, mover.z - mover.scannedZ);

  if (moved + reach <= OBSTACLE_SCAN) {
    return mover.nearbyObstacles;
  }

  const obstacles = world.obstacles.near(mover.x, mover.z, Math.max(OBSTACLE_SCAN, reach));

  mover.nearbyObstacles = obstacles.filter((obstacle) => {
    return !isAround(obstacle, mover);
  });
  mover.scannedX = mover.x;
  mover.scannedZ = mover.z;

  return mover.nearbyObstacles;
}

function forgetObstacles(mover: Mover): void {
  mover.scannedX = Number.POSITIVE_INFINITY;
  mover.scannedZ = Number.POSITIVE_INFINITY;
}

function isAround(obstacle: Obstacle, mover: Mover): boolean {
  const distance = Math.hypot(mover.goalX - obstacle.x, mover.goalZ - obstacle.z);

  return distance < obstacle.radius + mover.radius + mover.arrivalDistance;
}

function isBehindObstacle(
  mover: Mover,
  waypoint: Waypoint,
  distanceLeft: number,
  obstacles: readonly Obstacle[]
): boolean {
  return obstacles.some((obstacle) => {
    const clearance = obstacle.radius + mover.radius;

    return Math.hypot(waypoint.x - obstacle.x, waypoint.z - obstacle.z) < clearance && distanceLeft < clearance * 2;
  });
}

function isBlocked(mover: Mover, heading: number, distance: number, obstacles: readonly Obstacle[]): boolean {
  const end: [number, number] = [mover.x + Math.sin(heading) * distance, mover.z + Math.cos(heading) * distance];

  return obstacles.some((obstacle) => {
    const clearance = obstacle.radius + mover.radius;
    const fromCenter = Math.hypot(mover.x - obstacle.x, mover.z - obstacle.z);

    if (fromCenter < clearance) {
      return Math.hypot(end[0] - obstacle.x, end[1] - obstacle.z) < fromCenter;
    }

    return distanceToSegment(obstacle.x, obstacle.z, [mover.x, mover.z], end) < clearance;
  });
}

function uphillSlowdown(rise: number, run: number): number {
  if (rise <= 0) {
    return 1;
  }

  return 1 / (1 + (rise / run) * UPHILL_DRAG);
}

function mayStepTo(mover: Mover, x: number, z: number, attempt: StepAttempt, world: WorldState): boolean {
  if (!attempt.isLeavingWater) {
    return canEnter(mover, x, z, attempt.isEscapingWater, world);
  }

  const target = world.grid.cellAt(x, z);

  return world.isOnIsland(target) && world.slope(target) <= CLIMBABLE_SLOPE && !isInOpenWater(world, x, z);
}

function canEnter(mover: Mover, x: number, z: number, isEscapingWater: boolean, world: WorldState): boolean {
  const target = world.grid.cellAt(x, z);

  if (!world.isOnIsland(target) || world.slope(target) > CLIMBABLE_SLOPE) {
    return false;
  }

  if (world.isObstructedBetween(mover.x, mover.z, x, z) || wouldWadeOnTheWay(mover, x, z, world)) {
    return false;
  }

  if (!world.isWater(target) || world.crossingAt(x, z) !== null) {
    return true;
  }

  const here = world.grid.cellAt(mover.x, mover.z);

  if (here === target) {
    return isEscapingWater;
  }

  return world.waterDepth(target) < waterDepthUnder(mover, world);
}

function wouldWadeOnTheWay(mover: Mover, x: number, z: number, world: WorldState): boolean {
  if (!hasWaterAround(mover.x, mover.z, x, z, world) || isInOpenWater(world, mover.x, mover.z)) {
    return false;
  }

  const samples = Math.ceil(Math.hypot(x - mover.x, z - mover.z) / WATER_SAMPLE_SPACING);

  for (let sample = 1; sample < samples; sample += 1) {
    const sampleX = mover.x + ((x - mover.x) * sample) / samples;
    const sampleZ = mover.z + ((z - mover.z) * sample) / samples;

    if (isInOpenWater(world, sampleX, sampleZ)) {
      return true;
    }
  }

  return false;
}

function hasWaterAround(fromX: number, fromZ: number, toX: number, toZ: number, world: WorldState): boolean {
  const { grid } = world;

  const last = grid.cellsPerSide - 1;
  const firstColumn = Math.max(0, grid.columnAt(Math.min(fromX, toX) - BOUNDARY_MARGIN));
  const lastColumn = Math.min(last, grid.columnAt(Math.max(fromX, toX) + BOUNDARY_MARGIN));
  const firstRow = Math.max(0, grid.rowAt(Math.min(fromZ, toZ) - BOUNDARY_MARGIN));
  const lastRow = Math.min(last, grid.rowAt(Math.max(fromZ, toZ) + BOUNDARY_MARGIN));

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (world.isWater(grid.index(column, row))) {
        return true;
      }
    }
  }

  return false;
}

function waterDepthUnder(mover: Mover, world: WorldState): number {
  if (!isInOpenWater(world, mover.x, mover.z)) {
    return 0;
  }

  return world.waterDepth(world.grid.cellAt(mover.x, mover.z));
}

function forgetReplans(mover: Mover): void {
  mover.closestReplanDistance = Number.POSITIVE_INFINITY;
  mover.futileReplans = 0;
}

function replan(mover: Mover, navigation: NavigationGrid): boolean {
  mover.stuckSeconds = 0;

  const distanceToGoal = Math.hypot(mover.goalX - mover.x, mover.goalZ - mover.z);

  if (distanceToGoal < mover.closestReplanDistance - REPLAN_PROGRESS) {
    mover.closestReplanDistance = distanceToGoal;
    mover.futileReplans = 0;
  } else {
    mover.futileReplans += 1;
  }

  if (mover.futileReplans >= MAXIMUM_FUTILE_REPLANS) {
    return giveUp(mover);
  }

  const route = navigation.findPath(mover, { x: mover.goalX, z: mover.goalZ });

  if (route === null) {
    return giveUp(mover);
  }

  mover.path = route;
  mover.pathIndex = 0;

  return false;
}

function giveUp(mover: Mover): boolean {
  mover.pathIndex = mover.path.length;
  stopMoving(mover);

  return true;
}
