import { describe, expect, it } from "vitest";
import { firstMemberTick, MORNING, runToCompletion, SocietyHarness, settle } from "../../testing/test-society.ts";
import { carriedFood, pickUp } from "../person.ts";
import { totalFood } from "../stock.ts";
import { campPoint } from "../tribe-places.ts";
import { EatJob, eatProvisions } from "./eat-job.ts";

describe("eating", () => {
  it("eats the food it carries before the tribe's stock", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);
    const { person } = tick;

    tribe.stock.berries = 5;
    person.hunger = 0.9;
    pickUp(person, "berries", 2, "berries");

    const stocked = totalFood(tribe.stock);

    eatProvisions(person, tribe);

    expect(carriedFood(person)).toBe(1);
    expect(totalFood(tribe.stock)).toBe(stocked);
    expect(person.hunger).toBeLessThan(0.9);
  });

  it("relieves more hunger with a meal by a lit campfire", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);
    const { person } = tick;
    const camp = campPoint(tribe);

    tribe.stock.berries = 5;
    person.hunger = 0.9;
    runToCompletion(new EatJob(tick, camp), tick, 30);

    const rawRelief = 0.9 - person.hunger;

    const campfire = harness.buildings.add(
      { kind: "campfire", rotation: 0, tribeId: tribe.id, x: tribe.campX + 6, z: tribe.campZ },
      harness.random
    );

    campfire.progress = 1;
    campfire.fuel = 1;
    tribe.buildings.campfireId = campfire.id;
    person.hunger = 0.9;
    runToCompletion(new EatJob(tick, camp), tick, 30);

    expect(rawRelief).toBeGreaterThan(0);
    expect(0.9 - person.hunger).toBeGreaterThan(rawRelief);
  });
});
