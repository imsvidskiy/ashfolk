import { describe, expect, it } from "vitest";
import { wallIn } from "../../testing/test-jobs.ts";
import { firstMemberTick, isOnDryFooting, MORNING, SocietyHarness, settle } from "../../testing/test-society.ts";
import { floodCells } from "../../testing/test-world.ts";
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
