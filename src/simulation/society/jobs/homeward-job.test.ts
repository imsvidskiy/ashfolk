import { describe, expect, it } from "vitest";
import { placeMover } from "../../agents/movement.ts";
import { wallIn } from "../../testing/test-jobs.ts";
import { firstMemberTick, MORNING, runToCompletion, SocietyHarness, settle } from "../../testing/test-society.ts";
import { HomewardJob } from "./homeward-job.ts";

describe("heading home", () => {
  it("marks a walker who cannot get back to camp as stranded", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);

    placeMover(tick.person.mover, tribe.campX + 200, tribe.campZ);

    const job = new HomewardJob(tick);

    wallIn(harness, tick.person);

    expect(runToCompletion(job, tick, 60)).toBe(true);
    expect(tick.person.strandedDay).toBe(harness.context.environment.day);
  });

  it("leaves a walker who made it back to camp free to set out again", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);

    placeMover(tick.person.mover, tribe.campX + 80, tribe.campZ);

    expect(runToCompletion(new HomewardJob(tick), tick, 120)).toBe(true);
    expect(tick.person.strandedDay).toBe(Number.NEGATIVE_INFINITY);
  });
});
