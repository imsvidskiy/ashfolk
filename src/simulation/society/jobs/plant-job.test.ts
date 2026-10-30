import { describe, expect, it } from "vitest";
import { NO_PLANT, type VegetationStore } from "../../../world/vegetation-store.ts";
import { MORNING, runToCompletion, SocietyHarness, settle, teach, tickFor } from "../../testing/test-society.ts";
import { addPlotIfNeeded } from "../plots.ts";
import type { Tribe } from "../tribe.ts";
import { findPlanting } from "./plant-job.ts";

function plantedCount(tribe: Tribe, vegetation: VegetationStore): number {
  return tribe.plots.flatMap((plot) => {
    return plot.spots.filter((spot) => {
      return spot.plant !== NO_PLANT && vegetation.isAlive(spot.plant);
    });
  }).length;
}

describe("planting", () => {
  it("sends two planters to different spots and counts what each planted", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 6), ["farming", "orchards"]);

    addPlotIfNeeded(tribe, harness.context);

    const ticks = harness.society
      .membersOf(tribe)
      .slice(0, 2)
      .map((person) => {
        return tickFor(harness, person, tribe);
      });
    const jobs = ticks.map((tick) => {
      const job = findPlanting(tick);

      if (job === null) {
        throw new Error("Expected a spot to plant");
      }

      tick.person.job = job;

      return job;
    });
    const { knowledge } = tribe;
    const alreadyPlanted = plantedCount(tribe, harness.world.vegetation);

    for (const [index, job] of jobs.entries()) {
      expect(runToCompletion(job, ticks[index], 60)).toBe(true);
    }

    expect(plantedCount(tribe, harness.world.vegetation) - alreadyPlanted).toBe(2);
    expect(tribe.knowledge - knowledge).toBeCloseTo(0.8 * harness.context.rules.life.learningSpeed);
  });
});
