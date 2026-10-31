import { describe, expect, it } from "vitest";
import { addShelter, firstMemberTick, SocietyHarness, settle } from "../testing/test-society.ts";
import { chillPerDay, isSheltered, nearestWarmPlace, warmthOnArrival } from "./warmth.ts";

const WINTER = 3.5;

function wintryHarness(): SocietyHarness {
  const harness = new SocietyHarness();

  harness.context.environment = { ...harness.context.environment, airTemperatureOffset: -25, season: WINTER };

  return harness;
}

describe("staying warm", () => {
  it("chills people less once the tribe weaves clothes", () => {
    const harness = wintryHarness();

    const tribe = settle(harness, 3);
    const tick = firstMemberTick(harness, tribe);

    const inHides = chillPerDay(tick);

    tribe.technologies.add("weaving");

    expect(inHides).toBeGreaterThan(0);
    expect(chillPerDay(tick)).toBeLessThan(inHides);
  });

  it("warms people beside a finished house even when the fire is out", () => {
    const harness = wintryHarness();

    const tribe = settle(harness, 3);
    const tick = firstMemberTick(harness, tribe);

    const house = addShelter(harness, tribe, "longhouse", tribe.campX + 20, tribe.campZ);

    tick.person.mover.x = house.x + 3;
    tick.person.mover.z = house.z;

    expect(isSheltered(tick, false)).toBe(false);

    house.progress = 1;

    expect(isSheltered(tick, false)).toBe(true);
  });

  it("expects to arrive colder from farther away", () => {
    const harness = wintryHarness();

    const tribe = settle(harness, 3);
    const tick = firstMemberTick(harness, tribe);

    const house = addShelter(harness, tribe, "longhouse", tribe.campX, tribe.campZ);

    house.progress = 1;

    const place = nearestWarmPlace(tick);

    if (place === null) {
      throw new Error("Expected a warm place");
    }

    tick.person.mover.x = house.x + 40;

    const near = warmthOnArrival(tick, place);

    tick.person.mover.x = house.x + 200;

    expect(warmthOnArrival(tick, place)).toBeLessThan(near);
  });
});
