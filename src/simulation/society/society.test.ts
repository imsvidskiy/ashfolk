import { describe, expect, it } from "vitest";
import { worldRulesSchema } from "../../content/world-rules.ts";
import {
  createStripHarness,
  firstMemberTick,
  isOnDryLand,
  MORNING,
  SocietyHarness,
  settle,
} from "../testing/test-society.ts";
import { floodCells } from "../testing/test-world.ts";
import { assignJob } from "./decisions.ts";
import { findBerries } from "./jobs/gather-job.ts";
import type { Person } from "./person.ts";
import { totalFood } from "./stock.ts";

const EVENING = 0.9;
const LATE_EVENING = 23 / 24;
const WORK_POSES: ReadonlySet<string> = new Set(["gather", "chop", "dig", "fish", "build", "throw"]);

function placeOnAxis(person: Person, x: number): void {
  person.mover.x = x;
  person.mover.z = 0;
}

describe("arriving tribes", () => {
  it("settle with the requested number of people", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, 7);

    expect(tribe.memberCount).toBe(7);
    expect(harness.society.population).toBe(7);
    expect(harness.chronicle.takeEntries()).toEqual([expect.objectContaining({ category: "arrival" })]);
  });

  it("refuse land with nowhere to stand", () => {
    const harness = new SocietyHarness({
      world: {
        dimensions: { cellSize: 10, cellsPerSide: 96 },
        heightAt: (x) => {
          return x * 3;
        },
      },
    });

    expect(harness.spawnTribe(7)).toBeNull();
  });
});

describe("daily life", () => {
  it("gathers berries into the stock during the day", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 6);

    tribe.stock.berries = 0;
    harness.run(60);

    const jobs = harness.society.membersOf(tribe).map((person) => {
      return person.job?.kind;
    });

    expect(jobs).toContain("gather");

    harness.run(120);

    expect(totalFood(tribe.stock)).toBeGreaterThan(0);
  });

  it("eats when hungry", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 4);
    const members = harness.society.membersOf(tribe);

    for (const person of members) {
      person.hunger = 0.9;
    }

    harness.run(40);

    expect(
      Math.min(
        ...members.map((person) => {
          return person.hunger;
        })
      )
    ).toBeLessThan(0.6);
  });

  it("goes to sleep at night", () => {
    const harness = new SocietyHarness({ day: EVENING });

    const tribe = settle(harness, 4);

    harness.run(40);

    const sleeping = harness.society.membersOf(tribe).filter((person) => {
      return person.job?.kind === "sleep";
    });

    expect(sleeping.length).toBeGreaterThan(2);
  });

  it("wakes sleepers when the clock is moved to the afternoon", () => {
    const harness = new SocietyHarness({ day: LATE_EVENING });

    const tribe = settle(harness, 4);

    harness.run(40);

    const sleepers = harness.society.membersOf(tribe).filter((person) => {
      return person.pose === "sleep";
    });

    expect(sleepers.length).toBeGreaterThan(0);

    harness.calendar.setHours(14);
    harness.step();

    expect(
      sleepers.map((person) => {
        return person.job?.kind;
      })
    ).not.toContain("sleep");
  });

  it("starves without food", () => {
    const hungryRules = worldRulesSchema.parse({ life: { hungerRate: 2 } });

    const harness = new SocietyHarness({ day: MORNING, rules: hungryRules });

    const tribe = settle(harness, 3);

    for (const person of harness.society.membersOf(tribe)) {
      person.hunger = 1;
      person.health = 0.05;
    }

    tribe.stock.berries = 0;
    harness.run(30);

    expect(harness.society.population).toBeLessThan(3);
    expect(tribe.deaths).toBeGreaterThan(0);
  });
});

describe("danger", () => {
  it("makes people run from a fire nearby", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 4);

    for (const cell of harness.world.grid.cellsInRadius(tribe.campX + 40, tribe.campZ, 25)) {
      harness.fire.ignite(cell, 0.6);
    }

    harness.run(2);

    const fleeing = harness.society.membersOf(tribe).filter((person) => {
      return person.job?.kind === "flee";
    });

    expect(fleeing.length).toBeGreaterThan(0);
  });

  it("kills people caught in a blast", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 4);

    expect(harness.society.findTribe(tribe.id)).toBe(tribe);

    harness.society.damageArea(tribe.campX, tribe.campZ, 200, 5, "blast");

    expect(harness.society.population).toBe(0);
    expect(harness.society.tribes()).toHaveLength(0);
    expect(harness.society.findTribe(tribe.id)).toBeNull();
  });
});

describe("people nearby", () => {
  it("are found nearest first, with ties going to the earlier person", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, 4);
    const [first, second, third, fourth] = harness.society.membersOf(tribe);

    placeOnAxis(first, 10);
    placeOnAxis(second, -10);
    placeOnAxis(third, 5);
    placeOnAxis(fourth, 500);
    harness.society.kill(third, "age");

    expect(
      harness.society.nearestPerson(0, 0, 50, () => {
        return true;
      })
    ).toBe(first);
    expect(
      harness.society.nearestPerson(0, 0, 50, (person) => {
        return person !== first;
      })
    ).toBe(second);
    expect(
      harness.society.nearestPerson(0, 0, 9, () => {
        return true;
      })
    ).toBeNull();
    expect(
      harness.society.countNear(0, 0, 50, () => {
        return true;
      })
    ).toBe(2);
    expect(
      harness.society.countNear(0, 0, 50, (person) => {
        return person === second;
      })
    ).toBe(1);
  });
});

describe("progress", () => {
  it("discovers fire and lights a campfire", () => {
    const fastLearning = worldRulesSchema.parse({ life: { learningSpeed: 5 } });

    const harness = new SocietyHarness({ day: MORNING, rules: fastLearning });

    const tribe = settle(harness, 6);

    tribe.stock.wood = 10;
    harness.run(240);

    expect(tribe.technologies.has("fire")).toBe(true);
    expect(tribe.buildings.campfireId).not.toBeNull();
  });

  it("brings children into a well fed tribe", () => {
    const fertile = worldRulesSchema.parse({ life: { birthRate: 3 } });

    const harness = new SocietyHarness({ day: MORNING, rules: fertile });

    const tribe = settle(harness, 8);

    const hut = harness.buildings.add(
      { kind: "hut", rotation: 0, tribeId: tribe.id, x: tribe.campX + 15, z: tribe.campZ },
      harness.random
    );

    hut.progress = 1;
    tribe.buildings.shelterIds.push(hut.id);
    tribe.stock.grain = 200;
    harness.run(480);

    expect(tribe.births).toBeGreaterThan(0);
  });
});

describe("staying dry", () => {
  it("lets newcomers arrive on dry land only", () => {
    const harness = createStripHarness();

    const tribe = settle(harness, 12);

    const members = harness.society.membersOf(tribe);

    expect(
      members.filter((person) => {
        return !isOnDryLand(harness, person);
      })
    ).toEqual([]);
  });

  it("walks people out of water that rose around them", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 4);

    const [person] = harness.society.membersOf(tribe);

    floodCells(harness.world, harness.world.grid.cellsInRadius(person.mover.x, person.mover.z, 40), 1.6);
    harness.navigation.rebuild();

    expect(harness.world.isWaterAt(person.mover.x, person.mover.z)).toBe(true);

    harness.run(60);

    expect(harness.world.isWaterAt(person.mover.x, person.mover.z)).toBe(false);
  });

  it("drops its work and walks out when the water rises under it", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));
    const { person } = tick;

    const job = findBerries(tick);

    if (job === null) {
      throw new Error("Expected berries to gather");
    }

    assignJob(tick, job);
    harness.run(1);

    floodCells(harness.world, harness.world.grid.cellsInRadius(person.mover.x, person.mover.z, 25), 1);
    harness.navigation.rebuild();
    harness.step();

    expect(person.job).toBeNull();

    let workedInWater = false;

    for (let step = 0; step < 600; step += 1) {
      harness.step();
      workedInWater =
        workedInWater || (harness.world.isWaterAt(person.mover.x, person.mover.z) && WORK_POSES.has(person.pose));
    }

    expect(workedInWater).toBe(false);
    expect(harness.world.isWaterAt(person.mover.x, person.mover.z)).toBe(false);
  });
});
