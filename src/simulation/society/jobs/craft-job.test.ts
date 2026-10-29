import { describe, expect, it } from "vitest";
import {
  completeStructure,
  firstMemberTick,
  MORNING,
  runToCompletion,
  SocietyHarness,
  settle,
  THROUGH_MINING,
  teach,
} from "../../testing/test-society.ts";
import { constructionNeeds } from "../construction.ts";
import { assignJob, dropJob } from "../decisions.ts";
import type { PersonTick } from "../society-context.ts";
import { workSpeed } from "../tools.ts";
import { chooseCraft } from "../workshops.ts";
import { CraftJob } from "./craft-job.ts";
import { SleepJob } from "./sleep-job.ts";

function smeltingTick(harness: SocietyHarness): PersonTick {
  const tribe = settle(harness, 4);

  teach(tribe, [...THROUGH_MINING, "copper"], 2);
  completeStructure(
    tribe,
    harness.buildings.add(
      { kind: "smelter", rotation: 0, tribeId: tribe.id, x: tribe.campX + 20, z: tribe.campZ },
      harness.random
    )
  );
  tribe.stock.copperOre = 9;
  tribe.stock.wood = 20;

  return firstMemberTick(harness, tribe);
}

function startCrafting(harness: SocietyHarness, tick: PersonTick): void {
  const order = chooseCraft(tick.tribe, harness.context, constructionNeeds(tick.tribe, harness.context));

  if (order !== null) {
    assignJob(tick, new CraftJob(tick, order));
  }
}

describe("crafting", () => {
  it("smelts copper ore into copper at the smelter and makes copper tools from it", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = smeltingTick(harness);
    const { tribe } = tick;

    for (let batch = 0; batch < 3; batch += 1) {
      const order = chooseCraft(tribe, harness.context, constructionNeeds(tribe, harness.context));

      expect(order?.recipe).toBe("copper");

      if (order === null) {
        return;
      }

      runToCompletion(new CraftJob(tick, order), tick, 200);
    }

    expect(tribe.stock.copper).toBe(6);
    expect(tribe.stock.copperOre).toBe(0);

    const tools = chooseCraft(tribe, harness.context, constructionNeeds(tribe, harness.context));

    expect(tools?.recipe).toBe("tools");

    if (tools === null) {
      return;
    }

    const speedWithStone = workSpeed(tribe);

    runToCompletion(new CraftJob(tick, tools), tick, 200);

    expect(tribe.tools).toBe("copper");
    expect(workSpeed(tribe)).toBeGreaterThan(speedWithStone);
    expect(tribe.stock.copper).toBe(0);
  });

  it("heads new spears with bronze once the tribe casts it", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 4);

    const tick = firstMemberTick(harness, tribe);

    teach(tribe, [...THROUGH_MINING, "copper", "bronze"], 2);
    tribe.stock.bronze = 3;
    tribe.stock.wood = 10;
    tribe.stock.arrows = 100;
    tribe.stock.bows = 10;

    const order = chooseCraft(tribe, harness.context, constructionNeeds(tribe, harness.context));

    expect(order?.recipe).toBe("spears");
    expect(order?.material).toBe("bronze");

    if (order === null) {
      return;
    }

    runToCompletion(new CraftJob(tick, order), tick, 200);

    expect(tribe.armory).toBe("bronze");
    expect(tribe.stock.bronze).toBe(2);
  });

  it("puts the inputs back in the stock when the crafter is called away", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = smeltingTick(harness);
    const { stock } = tick.tribe;

    startCrafting(harness, tick);

    expect(tick.person.job?.kind).toBe("craft");
    expect(stock.copperOre).toBe(6);

    assignJob(tick, new SleepJob(tick));

    expect(stock.copperOre).toBe(9);

    startCrafting(harness, tick);
    dropJob(tick.tribe, tick.person);

    expect(stock.copperOre).toBe(9);
  });
});
