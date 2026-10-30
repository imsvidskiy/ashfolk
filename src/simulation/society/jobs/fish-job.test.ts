import { describe, expect, it } from "vitest";
import { MORNING, SocietyHarness, settle, tickFor } from "../../testing/test-society.ts";
import { floodStrip } from "../../testing/test-world.ts";
import { assignJob } from "../decisions.ts";
import { findFishingSpot } from "./fish-job.ts";

describe("staying dry", () => {
  it("fishes from the bank and never from the water", () => {
    const harness = new SocietyHarness({ day: MORNING });

    floodStrip(harness.world, 20, 2);
    harness.navigation.rebuild();

    const tribe = settle(harness, 4);

    const [fisher] = harness.society.membersOf(tribe);

    const tick = tickFor(harness, fisher, tribe);
    const job = Array.from({ length: 6 }, () => {
      return findFishingSpot(tick);
    }).find((found) => {
      return found !== null;
    });

    if (job === undefined || job === null) {
      throw new Error("Expected a fishing spot by the river");
    }

    assignJob(tick, job);

    let fishingSpots = 0;
    let hasEnteredWater = false;

    for (let step = 0; step < 900 && fisher.job !== null; step += 1) {
      fisher.job = fisher.job.update(tick);

      const { x, z } = fisher.mover;

      hasEnteredWater = hasEnteredWater || harness.world.isWaterAt(x, z);

      if (fisher.pose !== "fish") {
        continue;
      }

      const isOnBank = harness.world.grid.cellsInRadius(x, z, 11).some((cell) => {
        return harness.world.isWater(cell);
      });

      expect(harness.world.isWalkableAt(x, z) && isOnBank).toBe(true);
      fishingSpots += 1;
    }

    expect(fishingSpots).toBeGreaterThan(0);
    expect(hasEnteredWater).toBe(false);
  });
});
