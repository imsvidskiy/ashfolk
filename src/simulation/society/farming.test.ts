import { describe, expect, it } from "vitest";
import { cropOfCode, isFencedCode } from "../../content/crops.ts";
import { Ground } from "../../content/grounds.ts";
import {
  firstMemberTick,
  MORNING,
  moveToSeason,
  runToCompletion,
  SocietyHarness,
  settle,
  teach,
} from "../testing/test-society.ts";
import { NO_BUILDING, PLOT_GROUND } from "../world/world-state.ts";
import { addFieldIfNeeded, fieldTask, sowField, updateFields } from "./farming.ts";
import { FarmJob } from "./jobs/farm-job.ts";
import type { Field } from "./tribe.ts";

function sownField(cell: number): Field {
  return {
    cell,
    crop: "wheat",
    growth: 0.8,
    isFenced: false,
    isSown: true,
    plantings: 1,
    previousGround: Ground.Meadow,
    tending: 0,
  };
}

describe("fields", () => {
  it("are given back to the land when their tribe dies out", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 6), ["farming"]);

    addFieldIfNeeded(tribe, harness.context);

    const [field] = tribe.fields;

    if (field === undefined) {
      throw new Error("Expected a field");
    }

    harness.society.damageArea(tribe.campX, tribe.campZ, 200, 5, "blast");

    expect(harness.society.findTribe(tribe.id)).toBeNull();
    expect(harness.world.terrain.ground[field.cell]).toBe(field.previousGround);
    expect(harness.world.occupancy[field.cell]).toBe(NO_BUILDING);
  });

  it("keep the lava that covered them when their tribe dies out", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 6), ["farming"]);

    addFieldIfNeeded(tribe, harness.context);

    const [field] = tribe.fields;

    if (field === undefined) {
      throw new Error("Expected a field");
    }

    harness.world.setGround(field.cell, Ground.Basalt);
    harness.society.damageArea(tribe.campX, tribe.campZ, 200, 5, "blast");

    expect(harness.society.findTribe(tribe.id)).toBeNull();
    expect(harness.world.terrain.ground[field.cell]).toBe(Ground.Basalt);
  });

  it("are opened on fertile ground and sown with grain in spring", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 6), ["farming"]);

    addFieldIfNeeded(tribe, harness.context);

    const [field] = tribe.fields;

    if (field === undefined) {
      throw new Error("Expected a field");
    }

    expect(harness.world.terrain.ground[field.cell]).toBe(Ground.Farm);
    expect(harness.world.occupancy[field.cell]).toBe(PLOT_GROUND);

    moveToSeason(harness, 0.3);

    expect(fieldTask(tribe, field, 0.3)).toBe("sow");

    sowField(tribe, field, 0.3);

    expect(["wheat", "barley"]).toContain(field.crop);
    expect(field.isSown).toBe(true);
  });

  it("grow through the seasons, are fenced after ploughing and yield grain at harvest", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = teach(settle(harness, 6), ["farming", "ploughing"]);

    const tick = firstMemberTick(harness, tribe);

    addFieldIfNeeded(tribe, harness.context);

    const [field] = tribe.fields;

    if (field === undefined) {
      throw new Error("Expected a field");
    }

    moveToSeason(harness, 0.2);
    sowField(tribe, field, 0.2);
    updateFields(tribe, harness.context, 0.1);

    for (const season of [0.6, 1, 1.4, 1.8]) {
      moveToSeason(harness, season);
      updateFields(tribe, harness.context, 0.1);
    }

    const code = harness.world.cropCodes[field.cell];

    expect(field.growth).toBe(1);
    expect(isFencedCode(code)).toBe(true);
    expect(cropOfCode(code)).toBe(field.crop);
    expect(fieldTask(tribe, field, 1.8)).toBe("harvest");
    expect(runToCompletion(new FarmJob(tick, field), tick, 300)).toBe(true);
    expect(tribe.stock.grain + tribe.stock.vegetables).toBeGreaterThan(20);
    expect(field.isSown).toBe(false);
  });
});

describe("staying dry", () => {
  it("gives up fields that the water has taken", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 4);

    const drowned = harness.world.grid.cellAt(tribe.campX + 40, tribe.campZ);
    const dry = harness.world.grid.cellAt(tribe.campX - 40, tribe.campZ);

    tribe.fields.push(sownField(drowned), sownField(dry));
    harness.world.terrain.waterSurface[drowned] = harness.world.terrain.height[drowned] + 2;
    harness.step();

    expect(
      tribe.fields.map((field) => {
        return field.cell;
      })
    ).toEqual([dry]);
  });
});
