import { describe, expect, it } from "vitest";
import { addShelter, SocietyHarness, settle } from "../testing/test-society.ts";
import { assignHomes } from "./housing.ts";
import type { Person } from "./person.ts";
import { considerSplit } from "./settlement.ts";
import type { Tribe } from "./tribe.ts";

interface SplittingTribe {
  harness: SocietyHarness;
  members: Person[];
  tribe: Tribe;
}

function settleSplittingTribe(youngestAge: number, harness = new SocietyHarness()): SplittingTribe {
  const tribe = settle(harness, 20);
  const members = harness.society.membersOf(tribe);

  for (const person of members) {
    person.age = 40;
  }

  for (const person of members.slice(0, 4)) {
    person.age = youngestAge;
  }

  return { harness, members, tribe };
}

function nextDrawAfterSplitCheck(youngestAge: number): number {
  const { harness, members, tribe } = settleSplittingTribe(youngestAge);

  considerSplit(tribe, members, harness.context);

  return harness.random.next();
}

describe("splits", () => {
  it("search for a camp site only when young settlers can leave", () => {
    const idleDraw = settleSplittingTribe(40).harness.random.next();

    expect(nextDrawAfterSplitCheck(40)).toBe(idleDraw);
    expect(nextDrawAfterSplitCheck(20)).not.toBe(idleDraw);
  });

  it("hand the beds the settlers leave to those who stay", () => {
    const { harness, members, tribe } = settleSplittingTribe(
      20,
      new SocietyHarness({ world: { dimensions: { cellSize: 10, cellsPerSide: 192 } } })
    );

    const tent = addShelter(harness, tribe, "tent", 30, 30);

    tent.progress = 1;
    assignHomes(tribe, harness.buildings, harness.society.membersOf(tribe));
    considerSplit(tribe, members, harness.context);

    const stayers = harness.society.membersOf(tribe);

    expect(stayers.length).toBeLessThan(members.length);
    expect(
      stayers.filter((person) => {
        return person.homeId === tent.id;
      })
    ).toHaveLength(3);
  });
});
