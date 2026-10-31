import { describe, expect, it } from "vitest";
import { isFruitTreeSpecies } from "../../../content/cultivated-plants.ts";
import { PlantSpecies } from "../../../content/plants.ts";
import {
  FACING_TOLERANCE,
  placementAt,
  plantNear,
  WORK_SPOT_TOLERANCE,
  workUntilPosed,
} from "../../testing/test-jobs.ts";
import { firstMemberTick, isOnDryFooting, MORNING, SocietyHarness, settle, teach } from "../../testing/test-society.ts";
import { floodCells } from "../../testing/test-world.ts";
import { carriedAmount } from "../person.ts";
import { addPlotIfNeeded, plantSpot } from "../plots.ts";
import type { PersonTick } from "../society-context.ts";
import { findBerries, findFruit } from "./gather-job.ts";
import type { Job } from "./job.ts";

function ripeBushBeside(tick: PersonTick): number {
  const { mover } = tick.person;
  const { world } = tick.context;

  for (let plant = 0; plant < world.vegetation.count; plant += 1) {
    world.vegetation.setFruit(plant, 0);
  }

  const bush = world.plant({
    bornDay: 0,
    height: 2.2,
    rotation: 0,
    seed: 0.5,
    species: PlantSpecies.Bush,
    x: mover.x + 24,
    z: mover.z,
  });

  world.vegetation.setFruit(bush, 1);

  return bush;
}

function orchardTrees(harness: SocietyHarness, tick: PersonTick): number[] {
  addPlotIfNeeded(tick.tribe, harness.context);

  const spots = tick.tribe.plots.flatMap((plot) => {
    return plot.spots.filter((spot) => {
      return isFruitTreeSpecies(spot.species);
    });
  });

  return spots.slice(0, 2).map((spot) => {
    plantSpot(tick.tribe, spot, harness.context);

    return spot.plant;
  });
}

function nextJob(job: Job, tick: PersonTick): Job | null {
  let current: Job | null = job;

  for (let elapsed = 0; elapsed < 60 && current === job; elapsed += tick.seconds) {
    current = job.update(tick);
  }

  return current;
}

describe("gathering berries", () => {
  it("gathers berries at the edge of the bush, facing it", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));

    tick.context.world.vegetation.setFruit(plantNear(tick, PlantSpecies.Bush, 2.2), 1);

    const job = findBerries(tick);

    if (job === null) {
      throw new Error("Expected a bush to gather from");
    }

    workUntilPosed(job, tick, "gather");

    const placement = placementAt(tick, job.claimedPlant, 0.35);

    expect(placement.missedBy).toBeLessThan(WORK_SPOT_TOLERANCE);
    expect(placement.turnedAwayBy).toBeLessThan(FACING_TOLERANCE);
  });
});

describe("staying dry", () => {
  it("gathers only from bushes it can stand dry beside, and never from one the water has reached", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));
    const { grid } = harness.world;

    const bush = ripeBushBeside(tick);

    expect(findBerries(tick)?.claimedPlant).toBe(bush);

    tick.tribe.claimedPlants.clear();

    const bushCell = harness.world.vegetation.cell[bush];

    floodCells(harness.world, [grid.index(grid.columnOf(bushCell) + 1, grid.rowOf(bushCell))], 0.8);
    harness.navigation.rebuild();

    expect(findBerries(tick)?.claimedPlant).not.toBe(bush);
  });

  it("gathers from a bush beside the water when it can stand on dry ground within reach", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));
    const { grid } = harness.world;

    const bush = ripeBushBeside(tick);
    const bushCell = harness.world.vegetation.cell[bush];
    const left = grid.cellCenterX(bushCell) - grid.cellSize / 2;

    harness.world.removePlant(bush);

    const edgeBush = harness.world.plant({
      bornDay: 0,
      height: 2.2,
      rotation: 0,
      seed: 0.5,
      species: PlantSpecies.Bush,
      x: left + 0.6,
      z: grid.cellCenterZ(bushCell),
    });

    harness.world.vegetation.setFruit(edgeBush, 1);
    floodCells(harness.world, [grid.index(grid.columnOf(bushCell) + 1, grid.rowOf(bushCell))], 0.8);
    harness.navigation.rebuild();

    const job = findBerries(tick);

    expect(harness.world.touchesWater(harness.world.vegetation.cell[edgeBush])).toBe(true);
    expect(job?.claimedPlant).toBe(edgeBush);
    expect(isOnDryFooting(harness, tick.person.mover.goalX, tick.person.mover.goalZ)).toBe(true);
  });
});

describe("picking fruit", () => {
  it("picks the ripest orchard tree and then moves on to the next ripest", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, teach(settle(harness, 6), ["farming", "orchards"]));
    const { vegetation } = harness.world;

    const [first, second] = orchardTrees(harness, tick);

    if (first === undefined || second === undefined) {
      throw new Error("Expected two fruit trees in the orchard");
    }

    vegetation.setFruit(first, 1);
    vegetation.setFruit(second, 0.6);

    const job = findFruit(tick);

    if (job === null) {
      throw new Error("Expected a fruit tree to pick");
    }

    expect(job.claimedPlant).toBe(first);

    const next = nextJob(job, tick);

    expect(next?.kind).toBe("pick");
    expect(next?.claimedPlant).toBe(second);
    expect(tick.tribe.claimedPlants.has(second)).toBe(true);
    expect(vegetation.fruit[first]).toBeLessThan(1);
    expect(carriedAmount(tick.person, "fruit")).toBeGreaterThan(0);
  });
});
