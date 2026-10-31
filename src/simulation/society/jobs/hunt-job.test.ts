import { describe, expect, it, vi } from "vitest";
import { ANIMALS } from "../../../content/animals.ts";
import type { Animal } from "../../fauna/fauna.ts";
import { STONE_SPEAR } from "../../testing/test-jobs.ts";
import {
  firstMemberTick,
  MORNING,
  runToCompletion,
  SocietyHarness,
  settle,
  tickFor,
} from "../../testing/test-society.ts";
import { carriedAmount } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { findGame, HuntJob } from "./hunt-job.ts";

const HIT_ROLL = 0.2;
const STRIKING_DISTANCE = 20;
const TRAMPLING_DISTANCE = 5;
const HELPER_DISTANCE = 30;

function firstAnimal(harness: SocietyHarness, herd: { memberIds: number[] } | null): Animal {
  const animal = herd === null ? null : harness.fauna.findAnimal(herd.memberIds[0]);

  if (animal === null) {
    throw new Error("Expected an animal");
  }

  return animal;
}

function mammothAt(harness: SocietyHarness, tick: PersonTick, distance: number): Animal {
  const { tribe } = tick;
  const { mover } = tick.person;

  const mammoth = firstAnimal(
    harness,
    harness.fauna.spawnHerd("mammoth", tribe.campX + 40, tribe.campZ, 1, harness.random)
  );

  mover.x = mammoth.mover.x + distance;
  mover.z = mammoth.mover.z;

  return mammoth;
}

function strikeOnce(harness: SocietyHarness, tick: PersonTick, animal: Animal): void {
  const roll = vi.spyOn(harness.random, "chance").mockImplementation((probability) => {
    return HIT_ROLL < probability;
  });
  const hunt = new HuntJob(tick, animal, STONE_SPEAR);

  tick.person.job = hunt;

  for (let elapsed = 0; elapsed < 5 && roll.mock.calls.length === 0; elapsed += tick.seconds) {
    hunt.update(tick);
  }

  if (roll.mock.calls.length === 0) {
    throw new Error("Expected the hunter to strike");
  }
}

describe("hunting mammoths", () => {
  it("names the mammoth when its counterattack kills a hunter", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 6);

    const tick = firstMemberTick(harness, tribe);

    const mammoth = mammothAt(harness, tick, TRAMPLING_DISTANCE);

    mammoth.health = 1000;
    tick.person.health = 0.3;

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

describe("hit odds", () => {
  it("lets a lone hunter with a stone spear miss a mammoth on a middling roll", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 2));
    const mammoth = mammothAt(harness, tick, STRIKING_DISTANCE);
    const { health } = mammoth;

    strikeOnce(harness, tick, mammoth);

    expect(mammoth.health).toBe(health);
  });

  it("lets the same roll wound a mammoth when a second hunter is close by", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 2);
    const [hunter, helper] = harness.society.membersOf(tribe);
    const tick = tickFor(harness, hunter, tribe);
    const mammoth = mammothAt(harness, tick, STRIKING_DISTANCE);
    const { health } = mammoth;

    helper.mover.x = mammoth.mover.x - HELPER_DISTANCE;
    helper.mover.z = mammoth.mover.z;
    helper.job = new HuntJob(tickFor(harness, helper, tribe), mammoth, STONE_SPEAR);

    strikeOnce(harness, tick, mammoth);

    expect(mammoth.health).toBe(health - 1);
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
