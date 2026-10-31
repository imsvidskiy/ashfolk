import { describe, expect, it } from "vitest";
import { wrapAngle } from "../../../shared/math.ts";
import { FACING_TOLERANCE, workUntilPosed } from "../../testing/test-jobs.ts";
import { firstMemberTick, MORNING, runToCompletion, SocietyHarness, settle } from "../../testing/test-society.ts";
import { BuildJob } from "./build-job.ts";

describe("building", () => {
  it("raises the site facing it and records the finished building", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);
    const site = harness.buildings.add(
      { kind: "hut", rotation: 0, tribeId: tribe.id, x: tribe.campX + 20, z: tribe.campZ },
      harness.random
    );
    const { mover } = tick.person;

    const job = new BuildJob(tick, site);

    harness.chronicle.takeEntries();
    workUntilPosed(job, tick, "build");

    expect(Math.abs(wrapAngle(Math.atan2(site.x - mover.x, site.z - mover.z) - mover.heading))).toBeLessThan(
      FACING_TOLERANCE
    );
    expect(runToCompletion(job, tick, 120)).toBe(true);
    expect(site.progress).toBe(1);
    expect(harness.chronicle.takeEntries()).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("built a hut") })
    );
  });
});
