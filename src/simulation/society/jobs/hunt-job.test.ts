import { describe, expect, it } from "vitest";
import { ANIMALS } from "../../../content/animals.ts";
import { STONE_SPEAR } from "../../testing/test-jobs.ts";
import {
  firstAnimal,
  firstMemberTick,
  MORNING,
  runToCompletion,
  SocietyHarness,
  settle,
} from "../../testing/test-society.ts";
import { carriedAmount } from "../person.ts";
import { findGame, HuntJob } from "./hunt-job.ts";

describe("hunting mammoths", () => {
  it("names the mammoth when its counterattack kills a hunter", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 6);

    const tick = firstMemberTick(harness, tribe);

    const mammoth = firstAnimal(
      harness,
      harness.fauna.spawnHerd("mammoth", tribe.campX + 40, tribe.campZ, 1, harness.random)
    );

    mammoth.health = 1000;
    tick.person.health = 0.3;
    tick.person.mover.x = mammoth.mover.x + 5;
    tick.person.mover.z = mammoth.mover.z;

    for (let hunt = 0; hunt < 20; hunt += 1) {
      if (!tick.person.isAlive) {
        break;
      }

      runToCompletion(new HuntJob(tick, mammoth, STONE_SPEAR), tick, 60);
    }

    expect(tick.person.isAlive).toBe(false);
    expect(tick.person.causeOfDeath).toBe("mammoth");
    expect(harness.chronicle.takeEntries()).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("trampled by a mammoth") })
    );
  });
});

describe("choosing game", () => {
  it("leaves wolves alone and stalks an ibex instead", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 3);

    const tick = firstMemberTick(harness, tribe);

    tribe.stock.spears = 2;
    harness.fauna.spawnHerd("wolf", tribe.campX + 30, tribe.campZ, 3, harness.random);

    expect(findGame(tick)).toBeNull();

    harness.fauna.spawnHerd("ibex", tribe.campX - 120, tribe.campZ, 2, harness.random);

    expect(findGame(tick)).toBeInstanceOf(HuntJob);
  });

  it("names the ibex with the right article when hunters bring one down", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 3);

    const tick = firstMemberTick(harness, tribe);

    const ibex = firstAnimal(
      harness,
      harness.fauna.spawnHerd("ibex", tribe.campX + 20, tribe.campZ, 1, harness.random)
    );

    tick.person.mover.x = ibex.mover.x + 6;
    tick.person.mover.z = ibex.mover.z;

    for (let hunt = 0; hunt < 30; hunt += 1) {
      if (!ibex.isAlive) {
        break;
      }

      runToCompletion(new HuntJob(tick, ibex, STONE_SPEAR), tick, 30);
    }

    expect(ibex.isAlive).toBe(false);
    expect(harness.chronicle.takeEntries()).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("brought down an ibex") })
    );
  });
});

describe("held game", () => {
  it("stops stalking an animal the player is holding and never picks it", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 3);

    const tick = firstMemberTick(harness, tribe);

    tribe.stock.spears = 2;

    const ibex = firstAnimal(
      harness,
      harness.fauna.spawnHerd("ibex", tribe.campX + 20, tribe.campZ, 1, harness.random)
    );

    const hunt = new HuntJob(tick, ibex, STONE_SPEAR);

    harness.fauna.hold(ibex);

    expect(hunt.update(tick)).toBeNull();
    expect(findGame(tick)).toBeNull();
    expect(ibex.isAlive).toBe(true);
  });
});

describe("small game", () => {
  it("takes a hare near camp over deer far away, but walks to deer that are close enough", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 3);

    const tick = firstMemberTick(harness, tribe);

    tribe.stock.spears = 2;

    const hare = firstAnimal(
      harness,
      harness.fauna.spawnHerd("hare", tribe.campX + 50, tribe.campZ, 1, harness.random)
    );
    const farDeer = firstAnimal(
      harness,
      harness.fauna.spawnHerd("deer", tribe.campX - 300, tribe.campZ, 1, harness.random)
    );

    expect(findGame(tick)).toBeInstanceOf(HuntJob);
    expect(tick.person.mover.goalX).toBeCloseTo(hare.mover.x, -1);

    farDeer.mover.x = tribe.campX - 100;

    expect(findGame(tick)).toBeInstanceOf(HuntJob);
    expect(tick.person.mover.goalX).toBeLessThan(tribe.campX - 60);
  });

  it("brings home a little meat from a hare without a chronicle entry", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 3);

    const tick = firstMemberTick(harness, tribe);

    const hare = firstAnimal(
      harness,
      harness.fauna.spawnHerd("hare", tribe.campX + 20, tribe.campZ, 1, harness.random)
    );

    const meatBefore = tribe.stock.meat;

    harness.chronicle.takeEntries();

    for (let hunt = 0; hunt < 40 && hare.isAlive; hunt += 1) {
      tick.person.mover.x = hare.mover.x + 6;
      tick.person.mover.z = hare.mover.z;
      runToCompletion(new HuntJob(tick, hare, STONE_SPEAR), tick, 30);
    }

    expect(hare.isAlive).toBe(false);
    expect(carriedAmount(tick.person, "meat") + tribe.stock.meat - meatBefore).toBe(ANIMALS.hare.food);
    expect(
      harness.chronicle.takeEntries().filter((entry) => {
        return entry.category === "hunt";
      })
    ).toEqual([]);
  });
});
