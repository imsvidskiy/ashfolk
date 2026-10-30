import { describe, expect, it } from "vitest";
import { SocietyHarness, settle } from "../testing/test-society.ts";
import { assignHomes, housingCapacity } from "./housing.ts";
import type { Person } from "./person.ts";
import type { Tribe } from "./tribe.ts";

const TRIBE_SIZE = 6;

function settleWithTent(harness: SocietyHarness, people: number): Tribe {
  const tribe = settle(harness, people);

  const tent = harness.buildings.add({ kind: "tent", rotation: 0, tribeId: tribe.id, x: 30, z: 30 }, harness.random);

  tribe.buildings.shelterIds.push(tent.id);
  tent.progress = 1;
  assignHomes(tribe, harness.buildings, harness.society.membersOf(tribe));

  return tribe;
}

function housed(people: readonly Person[]): Person[] {
  return people.filter((person) => {
    return person.homeId !== null;
  });
}

describe("housing", () => {
  it("counts housing from finished shelters only", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, TRIBE_SIZE);

    const tent = harness.buildings.add({ kind: "tent", rotation: 0, tribeId: tribe.id, x: 30, z: 30 }, harness.random);

    tribe.buildings.shelterIds.push(tent.id);

    expect(housingCapacity(tribe, harness.buildings)).toBe(4);

    tent.progress = 1;

    expect(housingCapacity(tribe, harness.buildings)).toBe(7);
  });

  it("hands the bed of someone who died to someone who had none", () => {
    const harness = new SocietyHarness();

    const tribe = settleWithTent(harness, TRIBE_SIZE);

    const [sleeper] = housed(harness.society.membersOf(tribe));

    harness.society.kill(sleeper, "age");

    expect(housed(harness.society.membersOf(tribe))).toHaveLength(3);
  });
});
