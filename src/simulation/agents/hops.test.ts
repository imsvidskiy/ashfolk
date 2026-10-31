import { describe, expect, it } from "vitest";
import { BROOK_STRENGTH } from "../../world/brooks.ts";
import { headTo } from "../society/jobs/job.ts";
import { firstMemberTick, MORNING, SocietyHarness, settle } from "../testing/test-society.ts";
import { riverStrip } from "../testing/test-world.ts";
import { continueHop, type Hop, isHopping } from "./hops.ts";
import { createMover, moveAlong } from "./movement.ts";

describe("hopping over a brook", () => {
  it("keeps going once it has leapt, whatever else comes up", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));
    const { person } = tick;

    riverStrip(harness.world, person.mover.x + 8, person.mover.x + 28, BROOK_STRENGTH);
    harness.navigation.rebuild();
    headTo(person, { x: person.mover.x + 70, z: person.mover.z }, harness.context);
    person.job = null;
    person.mover.hopSpeed = 3.75;

    for (let step = 0; step < 200 && !isHopping(person.mover); step += 1) {
      moveAlong(person.mover, 0.1, 2.5, harness.world, harness.navigation);
    }

    expect(isHopping(person.mover)).toBe(true);

    person.hunger = 0.95;

    const poses = new Set<string>();

    let lastX = person.mover.x;
    let hopTicks = 0;

    while (isHopping(person.mover) && hopTicks < 100) {
      harness.step();
      hopTicks += 1;
      poses.add(person.pose);

      expect(person.mover.x).toBeGreaterThan(lastX);
      expect(person.job).toBeNull();

      lastX = person.mover.x;
    }

    expect(isHopping(person.mover)).toBe(false);
    expect(harness.world.isWaterAt(person.mover.x, person.mover.z)).toBe(false);
    expect(
      [...poses].every((pose) => {
        return pose === "leap" || pose === "run";
      })
    ).toBe(true);
    expect(poses.has("leap")).toBe(true);
  });

  it("turns to face the way it leaps", () => {
    const mover = createMover(0, 0, 0);
    const hop: Hop = {
      directionX: 1,
      directionZ: 0,
      enterAt: 2,
      fromX: 0,
      fromZ: 0,
      leaveAt: 4,
      length: 6,
      level: 100,
      speed: 3.75,
      travelled: 0,
    };

    mover.hop = hop;

    for (let step = 0; step < 100 && isHopping(mover); step += 1) {
      continueHop(mover, hop, 0.1);
    }

    expect(isHopping(mover)).toBe(false);
    expect(mover.heading).toBeCloseTo(Math.atan2(hop.directionX, hop.directionZ));
  });
});
