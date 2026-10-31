import { describe, expect, it } from "vitest";
import { firstMemberTick, moveToSeason, SocietyHarness, settle } from "../testing/test-society.ts";
import { decideJob } from "./decisions.ts";

const TRIBE_SIZE = 6;
const WINTER = 3.5;
const LATE_SPRING = 0.9;
const FAR_FROM_CAMP = 300;

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

describe("coming home before winter", () => {
  it("sends people far from camp home once expeditions are over", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, 3);
    const tick = firstMemberTick(harness, tribe);

    moveToSeason(harness, WINTER);
    tick.person.mover.x = tribe.campX + FAR_FROM_CAMP;
    tick.person.mover.z = tribe.campZ;

    expect(decideJob(tick).kind).toBe("migrate");
  });

  it("lets them work far away in the traveling season", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, 3);
    const tick = firstMemberTick(harness, tribe);

    moveToSeason(harness, LATE_SPRING);
    tick.person.mover.x = tribe.campX + FAR_FROM_CAMP;
    tick.person.mover.z = tribe.campZ;

    expect(decideJob(tick).kind).not.toBe("migrate");
  });
});
