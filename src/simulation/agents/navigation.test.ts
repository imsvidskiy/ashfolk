import { describe, expect, it } from "vitest";
import { BROOK_STRENGTH } from "../../world/brooks.ts";
import { NO_WATER } from "../../world/water.ts";
import { createTestWorld, floodCells, floodStrip, fordAcross, riverStrip } from "../testing/test-world.ts";
import { raiseTerrain } from "../world/terrain-editing.ts";
import { SPRING_GROUND, type WorldState } from "../world/world-state.ts";
import { NavigationGrid, type Waypoint } from "./navigation.ts";

const RIVER_WORLD = { dimensions: { cellSize: 10, cellsPerSide: 96 } };

function worldWithRiver(gapFromZ: number | null): WorldState {
  const world = createTestWorld(RIVER_WORLD);

  const river = world.grid.cellsInRadius(0, 0, 2000).filter((cell) => {
    const x = world.grid.cellCenterX(cell);
    const z = world.grid.cellCenterZ(cell);

    if (Math.abs(x) > 15) {
      return false;
    }

    return gapFromZ === null || z < gapFromZ;
  });

  floodCells(world, river, 3);

  return world;
}

function expectPath(path: Waypoint[] | null): Waypoint[] {
  if (path === null) {
    throw new Error("Expected a path");
  }

  return path;
}

function isWetAlong(
  from: Waypoint,
  path: readonly Waypoint[],
  samples: number,
  isWet: (x: number, z: number) => boolean
): boolean {
  let current = from;

  for (const waypoint of path) {
    for (let sample = 1; sample <= samples; sample += 1) {
      const amount = sample / samples;

      const x = current.x + (waypoint.x - current.x) * amount;
      const z = current.z + (waypoint.z - current.z) * amount;

      if (isWet(x, z)) {
        return true;
      }
    }

    current = waypoint;
  }

  return false;
}

function touchesWater(world: WorldState, from: Waypoint, path: readonly Waypoint[]): boolean {
  return isWetAlong(from, path, 20, (x, z) => {
    return world.isWaterAt(x, z);
  });
}

function wadesOutsideTheFord(world: WorldState, from: Waypoint, path: readonly Waypoint[]): boolean {
  return isWetAlong(from, path, 200, (x, z) => {
    return world.isWaterAt(x, z) && world.crossingAt(x, z) === null;
  });
}

function riverWithFord(): WorldState {
  const world = createTestWorld({ ...RIVER_WORLD, crossings: [fordAcross(-24, 24, 60)] });

  floodStrip(world, 20, 1.5);

  return world;
}

function isReachable(navigation: NavigationGrid, from: Waypoint, to: Waypoint): boolean {
  return navigation.reachableSpot(from, to) === to;
}

function crossesSpring(world: WorldState, from: Waypoint, to: Waypoint): boolean {
  return world.grid.someCellAlong(from.x, from.z, to.x, to.z, (cell) => {
    return world.occupancy[cell] === SPRING_GROUND;
  });
}

describe("navigation grid", () => {
  it("walks straight when nothing is in the way", () => {
    const navigation = new NavigationGrid(createTestWorld(RIVER_WORLD));

    expect(navigation.findPath({ x: -200, z: 0 }, { x: 200, z: 40 })).toEqual([{ x: 200, z: 40 }]);
  });

  it("goes around a river through the ford", () => {
    const world = worldWithRiver(250);
    const from = { x: -150, z: -100 };

    const navigation = new NavigationGrid(world);

    const path = expectPath(navigation.findPath(from, { x: 150, z: -100 }));

    expect(path.length).toBeGreaterThan(1);
    expect(touchesWater(world, from, path)).toBe(false);
  });

  it("gives up when the river cannot be crossed", () => {
    const navigation = new NavigationGrid(worldWithRiver(null));

    expect(navigation.findPath({ x: -150, z: -100 }, { x: 150, z: -100 })).toBeNull();
  });

  it("lands a destination in deep or shallow water on the nearest dry ground", () => {
    const world = createTestWorld(RIVER_WORLD);

    floodCells(world, world.grid.cellsInRadius(0, 0, 30), 3);
    floodCells(world, world.grid.cellsInRadius(200, 0, 20), 0.6);

    const navigation = new NavigationGrid(world);

    const deep = navigation.landingSpot({ x: 0, z: 0 });
    const shallow = navigation.landingSpot({ x: 200, z: 0 });

    expect(world.isWalkableAt(deep.x, deep.z)).toBe(true);
    expect(Math.hypot(deep.x, deep.z)).toBeLessThan(40);
    expect(world.isWalkableAt(shallow.x, shallow.z)).toBe(true);
    expect(Math.hypot(shallow.x - 200, shallow.z)).toBeLessThan(30);
    expect(navigation.landingSpot({ x: -200, z: 0 })).toEqual({ x: -200, z: 0 });
  });

  it("leads out of water one cell at a time toward the nearest bank", () => {
    const world = createTestWorld(RIVER_WORLD);

    floodCells(world, world.grid.cellsInRadius(0, 0, 45), 1.6);

    const navigation = new NavigationGrid(world);

    const steps: Waypoint[] = [];

    for (let next = navigation.stepAshore(2, 1); next !== null; next = navigation.stepAshore(next.x, next.z)) {
      steps.push(next);
    }

    expect(steps.length).toBeGreaterThan(2);
    expect(steps.length).toBeLessThan(8);
    expect(
      steps.filter((step) => {
        return world.isWalkableAt(step.x, step.z);
      })
    ).toEqual([steps.at(-1)]);
    expect(navigation.stepAshore(-300, 0)).toBeNull();
  });

  it("rebuilds only after the land or water changed", () => {
    const world = createTestWorld(RIVER_WORLD);

    const navigation = new NavigationGrid(world);

    expect(navigation.rebuildIfChanged()).toBe(false);

    world.heightVersion += 1;

    expect(navigation.rebuildIfChanged()).toBe(true);
    expect(navigation.rebuildIfChanged()).toBe(false);
  });

  it("keeps the graph when an edit leaves every cell's footing as it was", () => {
    const world = createTestWorld(RIVER_WORLD);

    const navigation = new NavigationGrid(world);

    raiseTerrain(world, { radius: 60, x: 100, z: 100 }, 0.5);

    expect(navigation.rebuildIfChanged()).toBe(false);
    expect(navigation.rebuildIfChanged()).toBe(false);
  });

  it("rebuilds when an edit makes the ground beside it too steep to walk", () => {
    const world = createTestWorld(RIVER_WORLD);

    const navigation = new NavigationGrid(world);

    const cell = world.grid.cellAt(100, 100);
    const column = world.grid.columnOf(cell);
    const row = world.grid.rowOf(cell);

    expect(world.isWalkable(cell + 1)).toBe(true);

    world.setHeight(cell, 130);
    world.finishHeightEdit({ firstColumn: column, firstRow: row, lastColumn: column, lastRow: row });

    expect(world.isWalkable(cell)).toBe(true);
    expect(world.isWalkable(cell + 1)).toBe(false);
    expect(navigation.rebuildIfChanged()).toBe(true);
  });

  it("rebuilds when an edit only changes how steep the walkable ground is", () => {
    const world = createTestWorld(RIVER_WORLD);

    const navigation = new NavigationGrid(world);

    raiseTerrain(world, { radius: 60, x: 100, z: 100 }, 30);

    expect(
      world.grid.cellsInRadius(100, 100, 80).every((cell) => {
        return world.isWalkable(cell);
      })
    ).toBe(true);
    expect(navigation.rebuildIfChanged()).toBe(true);
  });
});

describe("crossings", () => {
  it("routes between opposite banks over the ford and nowhere else", () => {
    const world = riverWithFord();
    const from = { x: -150, z: -100 };

    const path = expectPath(new NavigationGrid(world).findPath(from, { x: 150, z: -100 }));

    expect(path).toContainEqual({ x: -24, z: 60 });
    expect(path).toContainEqual({ x: 24, z: 60 });
    expect(wadesOutsideTheFord(world, from, path)).toBe(false);
  });

  it("knows which places a ford joins and which a river keeps apart", () => {
    const joined = new NavigationGrid(riverWithFord());

    const parted = createTestWorld(RIVER_WORLD);

    floodStrip(parted, 20, 1.5);

    const navigation = new NavigationGrid(parted);

    expect(isReachable(joined, { x: -150, z: -100 }, { x: 150, z: 200 })).toBe(true);
    expect(isReachable(navigation, { x: -150, z: -100 }, { x: 150, z: 200 })).toBe(false);
    expect(isReachable(navigation, { x: -150, z: -100 }, { x: -60, z: 200 })).toBe(true);
  });

  it("sends a mover to the nearest dry ground on its own bank when nothing crosses the river", () => {
    const world = createTestWorld(RIVER_WORLD);

    floodStrip(world, 20, 1.5);

    const spot = new NavigationGrid(world).reachableSpot({ x: -150, z: -100 }, { x: 60, z: 40 });

    expect(world.isWalkableAt(spot.x, spot.z)).toBe(true);
    expect(spot.x).toBeLessThan(-20);
    expect(spot.x).toBeGreaterThan(-35);
    expect(Math.abs(spot.z - 40)).toBeLessThan(10);
  });

  it("leads from the middle of a ford to whichever bank the way goes on", () => {
    const world = riverWithFord();
    const navigation = new NavigationGrid(world);

    const toEast = expectPath(navigation.findPath({ x: -2, z: 60 }, { x: 150, z: -150 }));
    const toWest = expectPath(navigation.findPath({ x: 2, z: 60 }, { x: -150, z: -150 }));

    expect(toEast[0]).toEqual({ x: 24, z: 60 });
    expect(toWest[0]).toEqual({ x: -24, z: 60 });
  });

  it("hops straight over a brook and joins its banks", () => {
    const world = createTestWorld(RIVER_WORLD);

    riverStrip(world, -20, 0, BROOK_STRENGTH);

    const navigation = new NavigationGrid(world);

    expect(navigation.findPath({ x: -150, z: -100 }, { x: 150, z: 0 })).toEqual([{ x: 150, z: 0 }]);
    expect(isReachable(navigation, { x: -150, z: -100 }, { x: 150, z: 200 })).toBe(true);
  });

  it("hops a brook back the way a hop from the far bank came", () => {
    const world = createTestWorld(RIVER_WORLD);

    riverStrip(world, -20, -10, BROOK_STRENGTH);
    riverStrip(world, -10, 0, BROOK_STRENGTH + 10);

    const gap = world.grid.cellAt(-5, -15);

    world.terrain.waterSurface[gap] = NO_WATER;
    world.terrain.riverStrength[gap] = 0;

    const navigation = new NavigationGrid(world);
    const from = { x: 150, z: 5 };

    const path = expectPath(navigation.findPath(from, { x: -150, z: 5 }));

    expect(
      path.every((waypoint, index) => {
        return navigation.isClear(index === 0 ? from : path[index - 1], waypoint);
      })
    ).toBe(true);
  });

  it("does not hop over spring ground", () => {
    const world = createTestWorld(RIVER_WORLD);

    riverStrip(world, -20, 0, BROOK_STRENGTH);

    for (const cell of world.grid.cellsInRadius(0, 0, 2000)) {
      if (world.isWater(cell) && world.grid.cellCenterZ(cell) > -100) {
        world.occupancy[cell] = SPRING_GROUND;
      }
    }

    const navigation = new NavigationGrid(world);
    const from = { x: -150, z: 100 };

    const path = expectPath(navigation.findPath(from, { x: 150, z: 100 }));

    expect(
      path.some((waypoint, index) => {
        return crossesSpring(world, index === 0 ? from : path[index - 1], waypoint);
      })
    ).toBe(false);
  });

  it("does not hop a river wider than a hop or flood water", () => {
    const wide = createTestWorld(RIVER_WORLD);
    const flooded = createTestWorld(RIVER_WORLD);

    riverStrip(wide, -20, 0, BROOK_STRENGTH + 10);
    riverStrip(flooded, -20, 0, 0);

    expect(new NavigationGrid(wide).findPath({ x: -150, z: -100 }, { x: 150, z: 40 })).toBeNull();
    expect(new NavigationGrid(flooded).findPath({ x: -150, z: -100 }, { x: 150, z: 40 })).toBeNull();
  });

  it("does not hop a brook that spreads wider than a hop", () => {
    const world = createTestWorld(RIVER_WORLD);

    riverStrip(world, -30, 10, BROOK_STRENGTH);

    expect(new NavigationGrid(world).findPath({ x: -150, z: -100 }, { x: 150, z: 40 })).toBeNull();
  });

  it("measures the walk to the ford and back rather than the straight line", () => {
    const navigation = new NavigationGrid(riverWithFord());

    const from = { x: -60, z: -300 };
    const across = { x: 60, z: -300 };
    const along = { x: -60, z: -100 };

    expect(navigation.walkLength(from, across)).toBeGreaterThan(700);
    expect(navigation.isWithinWalk(from, across)).toBe(false);
    expect(navigation.walkLength(from, along)).toBeLessThan(260);
    expect(navigation.isWithinWalk(from, along)).toBe(true);
  });
});
