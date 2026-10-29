import { describe, expect, it } from "vitest";
import { firstMemberTick, MORNING, SocietyHarness, settle } from "../../testing/test-society.ts";
import { PrayJob } from "./pray-job.ts";

describe("praying", () => {
  it("stops when the totem is gone", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);

    const totem = harness.buildings.add(
      { kind: "totem", rotation: 0, tribeId: tribe.id, x: tribe.campX + 20, z: tribe.campZ },
      harness.random
    );

    totem.progress = 1;

    const job = new PrayJob(tick, totem);

    harness.buildings.remove(totem, "burnt");

    expect(job.update(tick)).toBeNull();
  });
});
