import { describe, expect, it } from "vitest";
import { firstMemberTick, MORNING, SocietyHarness, settle } from "../testing/test-society.ts";
import { updateNeeds } from "./needs.ts";
import type { PersonTick } from "./society-context.ts";

const SHORT_SPELL_DAYS = 0.01;
const FRAIL = 0.0001;

function settledTick(): PersonTick {
  const harness = new SocietyHarness({ day: MORNING });

  return firstMemberTick(harness, settle(harness, 3));
}

describe("needs", () => {
  it("hold still while time is frozen", () => {
    const tick = settledTick();

    const { person } = tick;

    tick.context.environment = { ...tick.context.environment, isTimeFrozen: true };
    person.hunger = 0.96;
    person.health = 0.5;
    updateNeeds(tick, 0);

    expect(person.hunger).toBe(0.96);
    expect(person.health).toBe(0.5);
  });

  it("heal people who are fed and warm, and only them", () => {
    const tick = settledTick();

    const { person } = tick;

    person.health = 0.5;
    person.hunger = 0.8;
    updateNeeds(tick, SHORT_SPELL_DAYS);

    expect(person.health).toBe(0.5);

    person.hunger = 0.2;
    person.warmth = 0.2;
    updateNeeds(tick, SHORT_SPELL_DAYS);

    expect(person.health).toBe(0.5);

    person.warmth = 1;
    updateNeeds(tick, SHORT_SPELL_DAYS);

    expect(person.health).toBeGreaterThan(0.5);
  });

  it("name the need that killed", () => {
    const tick = settledTick();

    const { person } = tick;
    const { fields, grid } = tick.context.world;

    person.health = FRAIL;
    person.hunger = 1;

    expect(updateNeeds(tick, SHORT_SPELL_DAYS)).toBe("hunger");

    person.health = FRAIL;
    person.hunger = 0.5;
    person.warmth = 0;

    expect(updateNeeds(tick, SHORT_SPELL_DAYS)).toBe("cold");

    person.health = FRAIL;
    person.warmth = 1;
    fields.fire[grid.cellAt(person.mover.x, person.mover.z)] = 1;

    expect(updateNeeds(tick, SHORT_SPELL_DAYS)).toBe("fire");

    fields.fire.fill(0);
    person.health = 1;
    person.age = person.lifespan + 1;

    expect(updateNeeds(tick, SHORT_SPELL_DAYS)).toBe("age");
  });
});
