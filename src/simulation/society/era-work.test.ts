import { describe, expect, it } from "vitest";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import {
  addStructure,
  createMiningHarness,
  firstMemberTick,
  MORNING,
  moveToSeason,
  SocietyHarness,
  settle,
  THROUGH_MINING,
  teach,
} from "../testing/test-society.ts";
import { depositAround } from "../testing/test-world.ts";
import { ERA_WORK_OPTIONS } from "./era-work.ts";
import { MineJob } from "./jobs/mine-job.ts";
import { findPlanting } from "./jobs/plant-job.ts";
import { pickUp } from "./person.ts";
import { addPlotIfNeeded } from "./plots.ts";

const DIMENSIONS = { cellSize: 10, cellsPerSide: 96 };
const NO_CONSTRUCTION = {};

function eraOption(kind: string) {
  const option = ERA_WORK_OPTIONS.find((candidate) => {
    return candidate.kind === kind;
  });

  if (option === undefined) {
    throw new Error(`Expected a ${kind} option`);
  }

  return option;
}

describe("mining work", () => {
  it("counts only miners of the same ore as ore on the way", () => {
    const grid = new WorldGrid(DIMENSIONS);
    const harness = new SocietyHarness({
      day: MORNING,
      world: {
        deposits: [depositAround(grid, "copper", 160, 40), { ...depositAround(grid, "tin", -160, 40), id: 1 }],
        dimensions: DIMENSIONS,
      },
    });

    const tribe = teach(settle(harness, 4), [...THROUGH_MINING, "copper"], 2);

    const copperMine = addStructure(harness, tribe, { depositId: 0, kind: "mine", x: 150, z: 40 });

    addStructure(harness, tribe, { depositId: 1, kind: "mine", x: -150, z: 40 });
    moveToSeason(harness, 1);

    const tick = firstMemberTick(harness, tribe);
    const option = eraOption("mine");

    expect(option.weight(tick, NO_CONSTRUCTION)).toBeCloseTo(2.4);

    for (const miner of harness.society.membersOf(tribe).slice(1, 3)) {
      miner.job = new MineJob({ ...tick, person: miner }, copperMine, "copper");
    }

    expect(option.weight(tick, NO_CONSTRUCTION)).toBeCloseTo(2.4);
    expect(option.start(tick, NO_CONSTRUCTION)).toMatchObject({ ore: "tin" });
  });

  it("counts ore carried home once, not as a miner's share", () => {
    const harness = createMiningHarness();

    const tribe = teach(settle(harness, 4), THROUGH_MINING, 2);

    addStructure(harness, tribe, { depositId: 0, kind: "mine", x: 150, z: 40 });
    moveToSeason(harness, 1);

    const [, carrier] = harness.society.membersOf(tribe);
    const tick = firstMemberTick(harness, tribe);

    pickUp(carrier, "copperOre", 7, "ore");

    expect(eraOption("mine").weight(tick, NO_CONSTRUCTION)).toBeCloseTo(1.2);
  });

  it("waits for the expedition season", () => {
    const harness = createMiningHarness();

    const tribe = teach(settle(harness, 4), THROUGH_MINING, 2);

    addStructure(harness, tribe, { depositId: 0, kind: "mine", x: 150, z: 40 });
    moveToSeason(harness, 3.5);

    const tick = firstMemberTick(harness, tribe);
    const option = eraOption("mine");

    expect(option.weight(tick, NO_CONSTRUCTION)).toBe(0);

    moveToSeason(harness, 1);

    expect(option.weight(tick, NO_CONSTRUCTION)).toBeCloseTo(2.4);
  });
});

describe("planting work", () => {
  it("is not chosen when another planter already holds the only empty spot", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 4), ["farming", "orchards"]);

    addPlotIfNeeded(tribe, harness.context);
    moveToSeason(harness, 0.3);

    const [plot] = tribe.plots;
    const spot = plot?.spots.find((candidate) => {
      return candidate.plant === NO_PLANT;
    });

    if (plot === undefined || spot === undefined) {
      throw new Error("Expected a plot with an empty spot");
    }

    tribe.plots = [{ ...plot, spots: [spot] }];

    const [, planter] = harness.society.membersOf(tribe);
    const tick = firstMemberTick(harness, tribe);
    const option = eraOption("plant");

    expect(option.weight(tick, NO_CONSTRUCTION)).toBeCloseTo(1.3);

    planter.job = findPlanting({ ...tick, person: planter });

    expect(planter.job).not.toBeNull();
    expect(option.weight(tick, NO_CONSTRUCTION)).toBe(0);
  });
});
