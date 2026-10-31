import { describe, expect, it } from "vitest";
import {
  createMiningHarness,
  firstMemberTick,
  MORNING,
  runToCompletion,
  SocietyHarness,
  settle,
} from "../../testing/test-society.ts";
import { floodCells } from "../../testing/test-world.ts";
import { findClay } from "./clay-job.ts";

const MOAT_INNER_RADIUS = 35;
const MOAT_OUTER_RADIUS = 60;
const MOAT_DEPTH = 3;

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

  it("marks clay as scarce when the clay bank lies across deep water", () => {
    const harness = createMiningHarness("clay");

    const { grid } = harness.world;
    const [deposit] = harness.world.deposits;

    const tribe = settle(harness, 1);
    const moat = grid.cellsInRadius(deposit.x, deposit.z, MOAT_OUTER_RADIUS).filter((cell) => {
      return Math.hypot(grid.cellCenterX(cell) - deposit.x, grid.cellCenterZ(cell) - deposit.z) > MOAT_INNER_RADIUS;
    });

    floodCells(harness.world, moat, MOAT_DEPTH);
    harness.navigation.rebuild();

    expect(findClay(firstMemberTick(harness, tribe))).toBeNull();
    expect(tribe.lastScarcity.clay).toBe(harness.context.environment.day);
  });
});
