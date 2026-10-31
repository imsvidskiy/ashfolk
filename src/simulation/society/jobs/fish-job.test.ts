import { describe, expect, it } from "vitest";
import { MORNING, SocietyHarness, settle, tickFor } from "../../testing/test-society.ts";
import { floodStrip } from "../../testing/test-world.ts";
import { assignJob } from "../decisions.ts";
import type { PersonTick } from "../society-context.ts";
import { findFishingSpot } from "./fish-job.ts";
import type { Job } from "./job.ts";

const FISHING_SPOT_ATTEMPTS = 6;

function firstFishingJob(tick: PersonTick): Job {
  for (let attempt = 0; attempt < FISHING_SPOT_ATTEMPTS; attempt += 1) {
    const job = findFishingSpot(tick);

    if (job !== null) {
      return job;
    }
  }

  throw new Error("Expected a fishing spot by the river");
}

describe("staying dry", () => {
  it("fishes from the bank and never from the water", () => {
    const harness = new SocietyHarness({ day: MORNING });

    floodStrip(harness.world, 20, 2);
    harness.navigation.rebuild();

    const tribe = settle(harness, 4);

    const [fisher] = harness.society.membersOf(tribe);

    const tick = tickFor(harness, fisher, tribe);

    assignJob(tick, firstFishingJob(tick));

    let fishingSpots = 0;
    let hasEnteredWater = false;

    for (let step = 0; step < 900 && fisher.job !== null; step += 1) {
      fisher.job = fisher.job.update(tick);

      const { heading, x, z } = fisher.mover;
      const { cellSize } = harness.world.grid;

      hasEnteredWater = hasEnteredWater || harness.world.isWaterAt(x, z);

      if (fisher.pose !== "fish") {
        continue;
      }

      const isOnBank = harness.world.grid.cellsInRadius(x, z, 11).some((cell) => {
        return harness.world.isWater(cell);
      });
      const isFacingWater = harness.world.isWaterAt(x + Math.sin(heading) * cellSize, z + Math.cos(heading) * cellSize);

      expect(harness.world.isWalkableAt(x, z) && isOnBank && isFacingWater).toBe(true);
      fishingSpots += 1;
    }

    expect(fishingSpots).toBeGreaterThan(0);
    expect(hasEnteredWater).toBe(false);
  });
});
