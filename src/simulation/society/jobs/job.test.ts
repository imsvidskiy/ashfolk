import { describe, expect, it } from "vitest";
import { placeMover } from "../../agents/movement.ts";
import { wallIn } from "../../testing/test-jobs.ts";
import {
  firstMemberTick,
  isOnDryFooting,
  MORNING,
  runToCompletion,
  SocietyHarness,
  settle,
} from "../../testing/test-society.ts";
import { floodCells } from "../../testing/test-world.ts";
import { MournJob } from "../rivalry/defense-jobs.ts";
import { BuildJob } from "./build-job.ts";
import { Errand, headTo, headToWork } from "./job.ts";

describe("errands", () => {
  it("give up rather than work wherever the walker got stuck on the way", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));
    const { mover } = tick.person;

    const errand = new Errand(5, "chop");

    headTo(tick.person, { x: mover.x + 200, z: mover.z }, harness.context);

    wallIn(harness, tick.person);

    const progress = new Set<string>();

    for (let elapsed = 0; elapsed < 60; elapsed += tick.seconds) {
      progress.add(errand.update(tick));
    }

    expect(progress.has("abandoned")).toBe(true);
    expect(progress.has("working")).toBe(false);
    expect(tick.person.pose).not.toBe("chop");
  });

  it("let a builder give up rather than build from wherever they got stuck", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);
    const site = harness.buildings.add(
      { kind: "hut", rotation: 0, tribeId: tribe.id, x: tribe.campX + 200, z: tribe.campZ },
      harness.random
    );

    const job = new BuildJob(tick, site);

    wallIn(harness, tick.person);

    expect(runToCompletion(job, tick, 60)).toBe(true);
    expect(site.progress).toBe(0);
  });

  it("let a mourner give up when the way to camp is blocked", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);

    placeMover(tick.person.mover, tribe.campX + 200, tribe.campZ);

    const job = new MournJob(tick);

    wallIn(harness, tick.person);

    expect(runToCompletion(job, tick, 60)).toBe(true);
  });
});

describe("staying dry", () => {
  it("works and walks to places on dry ground clear of the water's edge", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));
    const { mover } = tick.person;

    floodCells(harness.world, harness.world.grid.cellsInRadius(mover.x + 60, mover.z, 12), 1.2);
    harness.navigation.rebuild();

    const edge = { x: mover.x + 46, z: mover.z };

    headToWork(tick.person, { radius: 0.5, reach: 0.35, ...edge }, harness.context);

    expect(isOnDryFooting(harness, mover.goalX, mover.goalZ)).toBe(true);
    expect(Math.hypot(mover.goalX - edge.x, mover.goalZ - edge.z)).toBeLessThan(15);

    headTo(tick.person, edge, harness.context);

    expect(isOnDryFooting(harness, mover.goalX, mover.goalZ)).toBe(true);
  });
});
