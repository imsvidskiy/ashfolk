import { describe, expect, it } from "vitest";
import { WorldGrid } from "../../../world/world-grid.ts";
import { firstMemberTick, MORNING, runToCompletion, SocietyHarness, settle } from "../../testing/test-society.ts";
import { depositAround } from "../../testing/test-world.ts";
import { findClay } from "./clay-job.ts";

const DIMENSIONS = { cellSize: 10, cellsPerSide: 96 };

describe("digging clay", () => {
  it("digs at the clay bank and carries the clay home", () => {
    const harness = new SocietyHarness({
      day: MORNING,
      world: { deposits: [depositAround(new WorldGrid(DIMENSIONS), "clay", 120, 40)], dimensions: DIMENSIONS },
    });

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
