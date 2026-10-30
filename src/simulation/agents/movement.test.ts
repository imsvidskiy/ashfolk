import { describe, expect, it } from "vitest";
import { Ground } from "../../content/grounds.ts";
import { PlantSpecies, type PlantSpeciesIndex, plantSpeciesDefinition } from "../../content/plants.ts";
import { BROOK_STRENGTH } from "../../world/brooks.ts";
import type { Crossing, LogBridge } from "../../world/crossings.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import {
  createTestWorld,
  floodCells,
  floodStrip,
  fordAcross,
  monumentAround,
  riverStrip,
} from "../testing/test-world.ts";
import type { WorldState } from "../world/world-state.ts";
import { isHopping } from "./hops.ts";
import { createMover, hasArrived, isStranded, type Mover, moveAlong, setDestination } from "./movement.ts";
import { NavigationGrid } from "./navigation.ts";

const STEP_SECONDS = 0.1;
const GORGE_DIMENSIONS = { cellSize: 10, cellsPerSide: 64 };
const GORGE_HALF_WIDTH = 10;
const GORGE_WATER_LEVEL = 102;
const LOG: LogBridge = {
  endDeck: 101,
  endX: 0,
  endZ: -1,
  id: 1,
  kind: "log",
  seed: 0.4,
  startDeck: 101,
  startX: 0,
  startZ: 1,
};

interface Crossed {
  readonly deckSeconds: number;
  readonly hasArrived: boolean;
  readonly wasInWater: boolean;
}

function walk(mover: Mover, world: WorldState, seconds: number, speed = 3): boolean {
  const navigation = new NavigationGrid(world);

  for (let elapsed = 0; elapsed < seconds; elapsed += STEP_SECONDS) {
    if (moveAlong(mover, STEP_SECONDS, speed, world, navigation)) {
      return true;
    }
  }

  return false;
}

function createBowlLake(): WorldState {
  const world = createTestWorld({
    heightAt: (x, z) => {
      return 98 + Math.hypot(x, z) * 0.05;
    },
  });

  for (const cell of world.grid.cellsInRadius(0, 0, 70)) {
    world.terrain.waterSurface[cell] = 101;
  }

  return world;
}

function depthAt(world: WorldState, mover: Mover): number {
  const cell = world.grid.cellAt(mover.x, mover.z);

  if (!world.isWater(cell)) {
    return 0;
  }

  return world.waterDepth(cell);
}

function createGorge(): WorldState {
  const world = createTestWorld({
    dimensions: GORGE_DIMENSIONS,
    heightAt: (x, z) => {
      const sideways = Math.max(0, Math.abs(x) - GORGE_HALF_WIDTH);

      return 100 + sideways * (z > 0 ? 0.2 : 5);
    },
  });

  for (const cell of world.grid.cellsInRadius(0, 0, world.grid.worldSize)) {
    if (Math.abs(world.grid.cellCenterX(cell)) < GORGE_HALF_WIDTH) {
      world.terrain.waterSurface[cell] = GORGE_WATER_LEVEL;
    }
  }

  return world;
}

function secondsToLand(mover: Mover, world: WorldState, limit: number): number {
  const navigation = new NavigationGrid(world);

  let elapsed = 0;

  while (elapsed < limit && depthAt(world, mover) > 0) {
    moveAlong(mover, STEP_SECONDS, 3, world, navigation);
    elapsed += STEP_SECONDS;
  }

  return elapsed;
}

function createLake(depth: number): WorldState {
  const world = createTestWorld({ dimensions: { cellSize: 10, cellsPerSide: 96 } });

  floodCells(world, world.grid.cellsInRadius(0, 0, 60), depth);

  return world;
}

function crossRiver(crossing: Crossing, start: { x: number; z: number }, goal: { x: number; z: number }): Crossed {
  const world = createTestWorld({ crossings: [crossing] });

  floodStrip(world, 20, 1.5);

  const navigation = new NavigationGrid(world);
  const mover = createMover(start.x, start.z, 0);

  let deckSeconds = 0;
  let wasInWater = false;

  setDestination(mover, goal, navigation);

  for (let elapsed = 0; elapsed < 200 && !hasArrived(mover); elapsed += STEP_SECONDS) {
    moveAlong(mover, STEP_SECONDS, 3, world, navigation);
    wasInWater = wasInWater || isStranded(mover, world);
    deckSeconds += world.isWaterAt(mover.x, mover.z) ? STEP_SECONDS : 0;
  }

  return { deckSeconds, hasArrived: hasArrived(mover), wasInWater };
}

function plantAt(world: WorldState, species: PlantSpeciesIndex, height: number): number {
  return world.plant({ bornDay: 0, height, rotation: 0, seed: 0.5, species, x: 0, z: 0 });
}

function radiusOf(world: WorldState, plant: number): number {
  return plantSpeciesDefinition(world.vegetation.species[plant]).radiusPerMeter * world.vegetation.height[plant];
}

describe("movement", () => {
  it("walks to the destination at its speed", () => {
    const world = createTestWorld();

    const mover = createMover(-100, 0, 0);

    setDestination(mover, { x: -40, z: 0 }, new NavigationGrid(world));

    expect(walk(mover, world, 10)).toBe(false);
    expect(mover.x).toBeGreaterThan(-75);
    expect(walk(mover, world, 15)).toBe(true);
    expect(hasArrived(mover)).toBe(true);
    expect(Math.hypot(mover.x + 40, mover.z)).toBeLessThan(2);
  });

  it("turns to face where it walks", () => {
    const world = createTestWorld();

    const mover = createMover(0, 0, 0);

    setDestination(mover, { x: 50, z: 0 }, new NavigationGrid(world));
    walk(mover, world, 3);

    expect(mover.heading).toBeCloseTo(Math.PI / 2, 1);
    expect(mover.velocityX).toBeGreaterThan(2);
  });

  it("walks slower through swamp", () => {
    const meadow = createTestWorld();
    const swamp = createTestWorld({ ground: Ground.Swamp });

    const onMeadow = createMover(-100, 0, 0);
    const inSwamp = createMover(-100, 0, 0);

    setDestination(onMeadow, { x: 100, z: 0 }, new NavigationGrid(meadow));
    setDestination(inSwamp, { x: 100, z: 0 }, new NavigationGrid(swamp));
    walk(onMeadow, meadow, 10);
    walk(inSwamp, swamp, 10);

    expect(inSwamp.x).toBeLessThan(onMeadow.x);
  });

  it("keeps to a waypoint until the next one is in sight", () => {
    const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });
    const world = createTestWorld({ monuments: [monumentAround(grid, 15, 15, 4)] });
    const navigation = new NavigationGrid(world);

    const mover = createMover(-40, 25, 0);

    let longestStuck = 0;

    setDestination(mover, { x: 25, z: -30 }, navigation, { canPlanRoute: false });
    mover.path = [
      { x: 25, z: 25 },
      { x: 25, z: -30 },
    ];

    for (let elapsed = 0; elapsed < 60 && !hasArrived(mover); elapsed += STEP_SECONDS) {
      moveAlong(mover, STEP_SECONDS, 3, world, navigation);
      longestStuck = Math.max(longestStuck, mover.stuckSeconds);
    }

    expect(hasArrived(mover)).toBe(true);
    expect(longestStuck).toBe(0);
  });

  it("walks around monument ground instead of through it", () => {
    const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });
    const world = createTestWorld({ monuments: [monumentAround(grid, 0, 0, 22)] });
    const navigation = new NavigationGrid(world);

    const mover = createMover(-80, 3, 0);

    let enteredRuin = false;

    setDestination(mover, { x: 80, z: 3 }, navigation, { canPlanRoute: false });

    for (let elapsed = 0; elapsed < 90 && !hasArrived(mover); elapsed += STEP_SECONDS) {
      moveAlong(mover, STEP_SECONDS, 3, world, navigation);

      if (world.isObstructed(world.grid.cellAt(mover.x, mover.z))) {
        enteredRuin = true;
      }
    }

    expect(enteredRuin).toBe(false);
    expect(Math.hypot(mover.x - 80, mover.z - 3)).toBeLessThan(3);
  });

  it("does not step into deep water", () => {
    const world = createTestWorld();

    const lake = world.grid.cellsInRadius(0, 0, 40);

    floodCells(world, lake, 3);

    const mover = createMover(-120, 0, 0);

    setDestination(mover, { x: 0, z: 0 }, new NavigationGrid(world), { canPlanRoute: false });
    walk(mover, world, 30);

    expect(world.isWaterAt(mover.x, mover.z)).toBe(false);
  });

  it("keeps out of shallow water too", () => {
    const world = createTestWorld();

    floodCells(world, world.grid.cellsInRadius(0, 0, 40), 0.6);

    const mover = createMover(-120, 0, 0);
    const navigation = new NavigationGrid(world);

    let wasInWater = false;

    setDestination(mover, { x: 0, z: 0 }, navigation, { canPlanRoute: false });

    for (let elapsed = 0; elapsed < 80; elapsed += STEP_SECONDS) {
      moveAlong(mover, STEP_SECONDS, 3, world, navigation);
      wasInWater = wasInWater || world.isWaterAt(mover.x, mover.z);
    }

    expect(wasInWater).toBe(false);
    expect(Math.hypot(mover.x, mover.z)).toBeLessThan(60);
  });

  it("walks around pools that touch at a corner instead of through the gap", () => {
    const world = createTestWorld();
    const navigation = new NavigationGrid(world);

    floodCells(world, [world.grid.cellAt(5, 5), world.grid.cellAt(-5, -5)], 1.2);
    navigation.rebuild();

    const mover = createMover(1.4, -0.1, 0);

    let wasInWater = false;

    setDestination(mover, { x: -9, z: 30 }, navigation);

    for (let elapsed = 0; elapsed < 30 && !hasArrived(mover); elapsed += STEP_SECONDS) {
      moveAlong(mover, STEP_SECONDS, 3, world, navigation);
      wasInWater = wasInWater || world.isWaterAt(mover.x, mover.z);
    }

    expect(hasArrived(mover)).toBe(true);
    expect(wasInWater).toBe(false);
  });
});

describe("unreachable destinations", () => {
  it("gives up on a goal in deep water instead of trying forever", () => {
    const world = createTestWorld();

    floodCells(world, world.grid.cellsInRadius(0, 0, 12), 3);

    const mover = createMover(-60, 0, 0);

    setDestination(mover, { x: 0, z: 0 }, new NavigationGrid(world), { canPlanRoute: false });

    expect(walk(mover, world, 60, 5)).toBe(true);
    expect(world.isWaterAt(mover.x, mover.z)).toBe(false);
  });
});

describe("leaving water", () => {
  it("never wades deeper than where it stands", () => {
    const world = createBowlLake();

    const mover = createMover(-50, 0, 0);
    const navigation = new NavigationGrid(world);

    const startingDepth = depthAt(world, mover);

    setDestination(mover, { x: 0, z: 0 }, navigation, { canPlanRoute: false });

    let deepest = startingDepth;

    for (let elapsed = 0; elapsed < 30; elapsed += STEP_SECONDS) {
      moveAlong(mover, STEP_SECONDS, 3, world, navigation);
      deepest = Math.max(deepest, depthAt(world, mover));
    }

    expect(startingDepth).toBeGreaterThan(0.5);
    expect(deepest).toBe(startingDepth);
  });

  it("walks out of the water to dry land", () => {
    const world = createBowlLake();

    const mover = createMover(-50, 0, 0);

    setDestination(mover, { x: -150, z: 0 }, new NavigationGrid(world), { canPlanRoute: false });

    expect(walk(mover, world, 60)).toBe(true);
    expect(depthAt(world, mover)).toBe(0);
  });

  it("climbs out of a river between banks too steep to climb at the nearest gentle bank", () => {
    const world = createGorge();

    const mover = createMover(-5, -45, 0);

    setDestination(mover, { x: 60, z: -45 }, new NavigationGrid(world), { canPlanRoute: false });

    expect(world.slope(world.grid.cellAt(mover.x, mover.z))).toBeGreaterThan(1.2);
    expect(secondsToLand(mover, world, 90)).toBeLessThan(60);
    expect(mover.z).toBeGreaterThan(0);
  });

  it("swims out of a flat-bottomed pond that rose around it after it stopped", () => {
    const world = createTestWorld();

    const mover = createMover(3, -2, 0);

    setDestination(mover, { x: 3, z: -2 }, new NavigationGrid(world));
    floodCells(world, world.grid.cellsInRadius(0, 0, 45), 1.6);

    expect(hasArrived(mover)).toBe(false);
    expect(walk(mover, world, 1)).toBe(false);
    expect(secondsToLand(mover, world, 90)).toBeLessThan(60);
  });
});

describe("routes", () => {
  it("never end in water the mover cannot stand in", () => {
    const world = createLake(3);
    const navigation = new NavigationGrid(world);

    for (const destination of [
      { x: 0, z: 0 },
      { x: 45, z: -20 },
      { x: -30, z: 30 },
    ]) {
      const mover = createMover(-300, 10, 0);

      setDestination(mover, destination, navigation);

      expect(
        mover.path.every((waypoint) => {
          return world.isWalkableAt(waypoint.x, waypoint.z);
        })
      ).toBe(true);
      expect(world.isWalkableAt(mover.goalX, mover.goalZ)).toBe(true);
    }
  });

  it("end on dry ground beside shallows as well", () => {
    const world = createLake(0.6);

    const mover = createMover(-120, 0, 0);

    setDestination(mover, { x: 10, z: 5 }, new NavigationGrid(world));

    expect(world.isWalkableAt(mover.goalX, mover.goalZ)).toBe(true);
    expect(
      mover.path.every((waypoint) => {
        return world.isWalkableAt(waypoint.x, waypoint.z);
      })
    ).toBe(true);
  });
});

describe("crossings", () => {
  it("walks over a ford at walking speed and never into the water beside it", () => {
    const crossed = crossRiver(fordAcross(-24, 24, -40), { x: -90, z: 60 }, { x: 90, z: 60 });

    expect(crossed.hasArrived).toBe(true);
    expect(crossed.wasInWater).toBe(false);
    expect(crossed.deckSeconds).toBeGreaterThan(0);
    expect(crossed.deckSeconds).toBeLessThan((40 / 3) * 1.3);
  });

  it("walks along a fallen log from one bank to the other", () => {
    const log: LogBridge = { ...LOG, endX: 25, endZ: 30, startX: -25, startZ: 30 };

    const crossed = crossRiver(log, { x: -60, z: -80 }, { x: 70, z: -60 });

    expect(crossed.hasArrived).toBe(true);
    expect(crossed.wasInWater).toBe(false);
    expect(crossed.deckSeconds).toBeLessThan((40 / 3) * 1.3);
  });

  it.each([
    [0.13, 33],
    [0.37, -38],
    [0.71, 12],
  ])("stays on a slanted log to its end before turning off it toward %f, %f", (slant, goalZ) => {
    const world = createTestWorld();

    floodStrip(world, 20, 1.5);

    const log: LogBridge = { ...LOG, endX: 25, endZ: 30 + 50 * slant, startX: -25, startZ: 30 };
    const navigation = new NavigationGrid(world);

    world.replaceWater(world.water, [log]);
    navigation.rebuild();

    const mover = createMover(4, 30 + 29 * slant, 0);

    let wasInWater = false;

    setDestination(mover, { x: 60, z: goalZ }, navigation);

    for (let elapsed = 0; elapsed < 60 && !hasArrived(mover); elapsed += STEP_SECONDS) {
      moveAlong(mover, STEP_SECONDS, 3, world, navigation);
      wasInWater = wasInWater || isStranded(mover, world);
    }

    expect(hasArrived(mover)).toBe(true);
    expect(wasInWater).toBe(false);
  });

  it("hops over a brook at its hop speed without stopping or standing in the water", () => {
    const world = createTestWorld();

    riverStrip(world, -20, 0, BROOK_STRENGTH);

    const navigation = new NavigationGrid(world);
    const mover = createMover(-80, 30, 0);
    const hopSpeed = 3.75;
    const along: number[] = [];

    let wetTicks = 0;
    let crossingTicks = 0;
    let hops = 0;

    mover.hopSpeed = hopSpeed;
    setDestination(mover, { x: 70, z: -20 }, navigation);

    for (let elapsed = 0; elapsed < 120 && !hasArrived(mover); elapsed += STEP_SECONDS) {
      const wasHopping = isHopping(mover);

      moveAlong(mover, STEP_SECONDS, 2.5, world, navigation);
      wetTicks += isStranded(mover, world) ? 1 : 0;
      hops += !wasHopping && isHopping(mover) ? 1 : 0;

      if (isHopping(mover) || wasHopping) {
        crossingTicks += 1;
        along.push(mover.x);
      }
    }

    const hopLength = Math.max(...along) - Math.min(...along);

    expect(hasArrived(mover)).toBe(true);
    expect(hops).toBe(1);
    expect(wetTicks).toBe(0);
    expect(hopLength).toBeGreaterThan(20);
    expect(
      along.every((x, index) => {
        return index === 0 || x > along[index - 1];
      })
    ).toBe(true);
    expect(
      Math.abs(crossingTicks - hopLength / (hopSpeed * STEP_SECONDS * Math.cos(Math.atan2(50, 150))))
    ).toBeLessThan(3);
  });
});

describe("obstacles", () => {
  it.each([
    ["a tree trunk", PlantSpecies.Oak, 20],
    ["a boulder", PlantSpecies.Boulder, 3],
  ])("walks around %s in the way instead of through it", (_name, species, height) => {
    const world = createTestWorld();
    const navigation = new NavigationGrid(world);

    const radius = radiusOf(world, plantAt(world, species, height));
    const mover = createMover(-30, 0.1, 0);

    let closest = Number.POSITIVE_INFINITY;

    setDestination(mover, { x: 30, z: 0.1 }, navigation, { canPlanRoute: false });

    for (let elapsed = 0; elapsed < 40 && !hasArrived(mover); elapsed += STEP_SECONDS) {
      moveAlong(mover, STEP_SECONDS, 3, world, navigation);
      closest = Math.min(closest, Math.hypot(mover.x, mover.z));
    }

    expect(closest).toBeGreaterThan(radius);
    expect(Math.hypot(mover.x - 30, mover.z - 0.1)).toBeLessThan(2);
  });

  it("walks up to the tree it is heading for", () => {
    const world = createTestWorld();

    const radius = radiusOf(world, plantAt(world, PlantSpecies.Oak, 20));
    const mover = createMover(-30, 0, 0);

    setDestination(mover, { x: 0, z: 0 }, new NavigationGrid(world), { arrivalDistance: radius + 1 });

    expect(walk(mover, world, 20)).toBe(true);
    expect(Math.hypot(mover.x, mover.z)).toBeLessThan(radius + 1.5);
  });

  it("steps out of a trunk it stands in", () => {
    const world = createTestWorld();

    plantAt(world, PlantSpecies.Oak, 20);

    const mover = createMover(0.2, 0, 0);

    setDestination(mover, { x: 30, z: 0 }, new NavigationGrid(world));

    expect(walk(mover, world, 20)).toBe(true);
  });

  it("walks around a building but into its own", () => {
    const world = createTestWorld();
    const navigation = new NavigationGrid(world);

    world.obstacles.placeBuilding(1, { radius: 4, x: 0, z: 0 });

    const passer = createMover(-30, 0, 0);
    const owner = createMover(-30, 0, 0);

    let closest = Number.POSITIVE_INFINITY;

    setDestination(passer, { x: 30, z: 0 }, navigation, { canPlanRoute: false });
    setDestination(owner, { x: 0, z: 0 }, navigation);

    for (let elapsed = 0; elapsed < 40 && !hasArrived(passer); elapsed += STEP_SECONDS) {
      moveAlong(passer, STEP_SECONDS, 3, world, navigation);
      closest = Math.min(closest, Math.hypot(passer.x, passer.z));
    }

    expect(closest).toBeGreaterThan(4);
    expect(walk(owner, world, 20)).toBe(true);
    expect(Math.hypot(owner.x, owner.z)).toBeLessThan(2);
  });
});
