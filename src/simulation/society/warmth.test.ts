import { describe, expect, it } from "vitest";
import { addShelter, firstMemberTick, SocietyHarness, settle } from "../testing/test-society.ts";
import type { PersonTick } from "./society-context.ts";
import { chillPerDay, isSheltered, isWithinReach, nearestWarmPlace, warmthOnArrival } from "./warmth.ts";

const WINTER = 3.5;
const BEYOND_THE_TENT_HEARTH = 5.9;

function wintryHarness(): SocietyHarness {
  const harness = new SocietyHarness();

  harness.context.environment = { ...harness.context.environment, airTemperatureOffset: -25, season: WINTER };

  return harness;
}

function isBesideNearestWarmPlace(tick: PersonTick): boolean {
  const place = nearestWarmPlace(tick);

  if (place === null) {
    throw new Error("Expected a warm place");
  }

  return isWithinReach(tick, place);
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

  it("warms people near the lit campfire, where the cold are sent to warm up", () => {
    const harness = wintryHarness();

    const tribe = settle(harness, 3);
    const tick = firstMemberTick(harness, tribe);

    const campfire = harness.buildings.add(
      { kind: "campfire", rotation: 0, tribeId: tribe.id, x: tribe.campX, z: tribe.campZ },
      harness.random
    );

    campfire.progress = 1;
    tribe.buildings.campfireId = campfire.id;
    tick.person.mover.x = campfire.x + 10;
    tick.person.mover.z = campfire.z;

    expect(isSheltered(tick, false)).toBe(true);
    expect(isBesideNearestWarmPlace(tick)).toBe(true);

    tick.person.mover.x = campfire.x + 20;

    expect(isSheltered(tick, false)).toBe(false);
    expect(isBesideNearestWarmPlace(tick)).toBe(false);
  });

  it("warms sleepers at home a little beyond the reach of its hearth", () => {
    const harness = wintryHarness();

    const tribe = settle(harness, 3);
    const tick = firstMemberTick(harness, tribe);

    const tent = addShelter(harness, tribe, "tent", tribe.campX + 20, tribe.campZ);

    tent.progress = 1;
    tick.person.homeId = tent.id;
    tick.person.mover.x = tent.x + BEYOND_THE_TENT_HEARTH;
    tick.person.mover.z = tent.z;

    expect(isSheltered(tick, false)).toBe(false);
    expect(isSheltered(tick, true)).toBe(true);
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
