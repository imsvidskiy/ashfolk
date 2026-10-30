import { describe, expect, it } from "vitest";
import { createStripHarness, STRIP_HALF_WIDTH, settle, tickFor } from "../../testing/test-society.ts";
import { assignJob } from "../decisions.ts";
import { FleeJob } from "./flee-job.ts";

describe("staying dry", () => {
  it("runs from danger along the shore rather than into the water", () => {
    const harness = createStripHarness();

    const tribe = settle(harness, 4);

    const [person] = harness.society.membersOf(tribe);

    const tick = tickFor(harness, person, tribe);

    person.mover.x = STRIP_HALF_WIDTH - 2;
    assignJob(tick, new FleeJob(tick, { x: person.mover.x - 30, z: person.mover.z }));

    let hasEnteredWater = false;

    for (let step = 0; step < 200 && person.job !== null; step += 1) {
      person.job = person.job.update(tick);
      hasEnteredWater = hasEnteredWater || harness.world.isWaterAt(person.mover.x, person.mover.z);
    }

    expect(hasEnteredWater).toBe(false);
  });
});
