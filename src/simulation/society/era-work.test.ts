import { describe, expect, it } from "vitest";
import { WorldGrid } from "../../world/world-grid.ts";
import {
  completeStructure,
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

const DIMENSIONS = { cellSize: 10, cellsPerSide: 96 };
const NO_CONSTRUCTION = {};

function mineOption() {
  const option = ERA_WORK_OPTIONS.find((candidate) => {
    return candidate.kind === "mine";
  });

  if (option === undefined) {
    throw new Error("Expected a mining option");
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

    const copperMine = completeStructure(
      tribe,
      harness.buildings.add(
        { depositId: 0, kind: "mine", rotation: 0, tribeId: tribe.id, x: 150, z: 40 },
        harness.random
      )
    );

    completeStructure(
      tribe,
      harness.buildings.add(
        { depositId: 1, kind: "mine", rotation: 0, tribeId: tribe.id, x: -150, z: 40 },
        harness.random
      )
    );

    moveToSeason(harness, 1);

    const tick = firstMemberTick(harness, tribe);
    const option = mineOption();

    expect(option.weight(tick, NO_CONSTRUCTION)).toBeCloseTo(2.4);

    for (const miner of harness.society.membersOf(tribe).slice(1, 3)) {
      miner.job = new MineJob({ ...tick, person: miner }, copperMine, "copper");
    }

    expect(option.weight(tick, NO_CONSTRUCTION)).toBeCloseTo(2.4);
    expect(option.start(tick, NO_CONSTRUCTION)).toMatchObject({ ore: "tin" });
  });
});
