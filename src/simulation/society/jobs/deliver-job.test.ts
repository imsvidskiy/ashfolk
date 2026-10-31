import { describe, expect, it } from "vitest";
import { placeMover } from "../../agents/movement.ts";
import { firstMemberTick, MORNING, runToCompletion, SocietyHarness, settle } from "../../testing/test-society.ts";
import { dropCarrying, isCarryingAnything, pickUp, walkSpeed } from "../person.ts";
import { DeliverJob } from "./deliver-job.ts";

describe("delivering", () => {
  it("carries goods to the storehouse and adds them to the stock", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);
    const storehouse = harness.buildings.add(
      { kind: "storehouse", rotation: 0, tribeId: tribe.id, x: tribe.campX + 40, z: tribe.campZ },
      harness.random
    );
    const { mover } = tick.person;
    const { stone } = tribe.stock;

    storehouse.progress = 1;
    tribe.buildings.storehouseId = storehouse.id;
    pickUp(tick.person, "stone", 5, "stone");

    const job = new DeliverJob(tick);

    expect(Math.hypot(mover.goalX - storehouse.x, mover.goalZ - storehouse.z)).toBeLessThan(
      Math.hypot(mover.goalX - tribe.campX, mover.goalZ - tribe.campZ)
    );
    expect(runToCompletion(job, tick, 60)).toBe(true);
    expect(tribe.stock.stone - stone).toBe(5);
    expect(isCarryingAnything(tick.person)).toBe(false);
  });

  it("slows under a heavy load but not under a basket of berries", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);
    const { person } = tick;

    placeMover(person.mover, tribe.campX + 40, tribe.campZ);
    pickUp(person, "stone", 5, "stone");
    new DeliverJob(tick).update(tick);

    const loadedSpeed = person.speed;

    dropCarrying(person);
    pickUp(person, "berries", 5, "berries");
    new DeliverJob(tick).update(tick);

    expect(loadedSpeed).toBeLessThan(walkSpeed(person));
    expect(person.speed).toBe(walkSpeed(person));
  });
});
