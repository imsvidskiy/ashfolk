import { describe, expect, it } from "vitest";
import {
  completeStructure,
  createMiningHarness,
  firstMemberTick,
  runToCompletion,
  settle,
  THROUGH_MINING,
  teach,
} from "../../testing/test-society.ts";
import { findMineWork } from "./mine-job.ts";

describe("mining", () => {
  it("sends miners to dig ore and carry it home", () => {
    const harness = createMiningHarness();

    const tribe = settle(harness, 4);

    const tick = firstMemberTick(harness, tribe);

    teach(tribe, THROUGH_MINING, 2);

    completeStructure(
      tribe,
      harness.buildings.add(
        { depositId: 0, kind: "mine", rotation: 0, tribeId: tribe.id, x: 150, z: 40 },
        harness.random
      )
    );

    const job = findMineWork(tick, "copper");

    expect(job?.kind).toBe("mine");

    if (job === null) {
      throw new Error("Expected work at the mine");
    }

    expect(runToCompletion(job, tick, 400)).toBe(true);
    expect(tribe.stock.copperOre).toBeGreaterThanOrEqual(12);
  });
});
