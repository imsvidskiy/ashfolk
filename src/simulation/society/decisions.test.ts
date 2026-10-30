import { describe, expect, it } from "vitest";
import { firstMemberTick, SocietyHarness, settle } from "../testing/test-society.ts";
import { decideJob } from "./decisions.ts";

const TRIBE_SIZE = 6;

describe("deciding what to do", () => {
  it("sends people to sleep at night", () => {
    const harness = new SocietyHarness({ day: 0.95 });

    const tribe = settle(harness, TRIBE_SIZE);

    expect(decideJob(firstMemberTick(harness, tribe)).kind).toBe("sleep");
  });

  it("feeds a starving person before sending them to sleep", () => {
    const harness = new SocietyHarness({ day: 0.95 });

    const tribe = settle(harness, TRIBE_SIZE);

    const tick = firstMemberTick(harness, tribe);

    tick.person.hunger = 0.9;
    tribe.stock.berries = 5;

    expect(decideJob(tick).kind).toBe("eat");
  });

  it("lets people woken by hunger at night eat and go back to sleep", () => {
    const harness = new SocietyHarness({ day: 0.92 });

    const tribe = settle(harness, TRIBE_SIZE);

    const [person] = harness.society.membersOf(tribe);

    tribe.stock.berries = 20;
    harness.run(20);
    person.hunger = 0.9;
    harness.run(30);

    expect(harness.context.environment.isNight).toBe(true);
    expect(person.hunger).toBeLessThan(0.5);
    expect(person.job?.kind).toBe("sleep");
  });

  it("sends hungry people to eat when there is food", () => {
    const harness = new SocietyHarness({ day: 0.4 });

    const tribe = settle(harness, TRIBE_SIZE);

    const tick = firstMemberTick(harness, tribe);

    tick.person.hunger = 0.6;
    tribe.stock.berries = 5;

    expect(decideJob(tick).kind).toBe("eat");
  });
});
