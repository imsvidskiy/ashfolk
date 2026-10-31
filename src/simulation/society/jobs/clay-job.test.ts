import { describe, expect, it } from "vitest";
import {
  createMiningHarness,
  firstMemberTick,
  MORNING,
  runToCompletion,
  SocietyHarness,
  settle,
} from "../../testing/test-society.ts";
import { findClay } from "./clay-job.ts";

describe("digging clay", () => {
  it("digs at the clay bank and carries the clay home", () => {
    const harness = createMiningHarness("clay");

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);
    const { clay } = tribe.stock;

    const job = findClay(tick);

    if (job === null) {
      throw new Error("Expected clay to dig");
    }

    expect(runToCompletion(job, tick, 300)).toBe(true);
    expect(tribe.stock.clay).toBeGreaterThan(clay);
  });

  it("marks clay as scarce when there is no clay bank", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);

    expect(findClay(firstMemberTick(harness, tribe))).toBeNull();
    expect(tribe.lastScarcity.clay).toBe(harness.context.environment.day);
  });
});
