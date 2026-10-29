import { describe, expect, it } from "vitest";
import { firstMemberTick, MORNING, SocietyHarness, settle } from "../../testing/test-society.ts";
import { WarmJob } from "./warm-job.ts";

describe("warming up", () => {
  it("stops when the fire is gone", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);

    const campfire = harness.buildings.add(
      { kind: "campfire", rotation: 0, tribeId: tribe.id, x: tribe.campX + 20, z: tribe.campZ },
      harness.random
    );

    campfire.progress = 1;
    tick.person.warmth = 0.2;

    const job = new WarmJob(tick, { building: campfire, reach: 15, seat: 5 });

    harness.buildings.remove(campfire, "burnt");

    expect(job.update(tick)).toBeNull();
  });
});
