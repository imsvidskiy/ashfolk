import { describe, expect, it } from "vitest";
import { addShelter, MORNING, SocietyHarness, settle } from "../testing/test-society.ts";
import { floodCells } from "../testing/test-world.ts";
import { assignHomes } from "./housing.ts";
import type { Person } from "./person.ts";
import { considerMoving, considerSplit, updateMigration } from "./settlement.ts";
import type { Tribe } from "./tribe.ts";

const TRIBE_SIZE = 6;
const STRAY_DISTANCE = 150;

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

describe("migrations", () => {
  it("set out for a new camp when water floods the old one", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, TRIBE_SIZE);
    const members = harness.society.membersOf(tribe);
    const camp = { x: tribe.campX, z: tribe.campZ };

    floodCells(harness.world, [harness.world.grid.cellAt(camp.x, camp.z)], 1.5);
    considerMoving(tribe, members, harness.context);

    expect(tribe.isMigrating).toBe(true);
    expect(Math.hypot(tribe.campX - camp.x, tribe.campZ - camp.z)).toBeGreaterThan(0);
    expect(harness.chronicle.takeEntries().at(-1)?.text).toContain("water flooded the camp");
  });

  it("end once most of the tribe has reached the camp", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, TRIBE_SIZE);
    const members = harness.society.membersOf(tribe);

    tribe.isMigrating = true;
    tribe.migrationStartDay = harness.context.environment.day;
    members[0].mover.x += STRAY_DISTANCE;
    updateMigration(tribe, members, harness.context);

    expect(tribe.isMigrating).toBe(false);
  });

  it("settle the tribe where it stands when the journey runs too long", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, TRIBE_SIZE);
    const members = harness.society.membersOf(tribe);
    const camp = { x: tribe.campX, z: tribe.campZ };

    tribe.isMigrating = true;
    tribe.migrationStartDay = harness.context.environment.day;

    for (const person of members) {
      person.mover.x += STRAY_DISTANCE;
    }

    updateMigration(tribe, members, harness.context);

    expect(tribe.isMigrating).toBe(true);

    tribe.migrationStartDay -= 2;
    updateMigration(tribe, members, harness.context);

    expect(tribe.isMigrating).toBe(false);
    expect(tribe.campX).toBeGreaterThan(camp.x + STRAY_DISTANCE / 2);
  });
});
