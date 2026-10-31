import { describe, expect, it } from "vitest";
import type { DepositKind } from "../../content/deposits.ts";
import type { Deposit } from "../../world/deposits.ts";
import { MORNING, SocietyHarness, settle, THROUGH_MINING, teach } from "../testing/test-society.ts";
import { prospectingMove } from "./prospecting.ts";
import type { Tribe } from "./tribe.ts";

const FAR_VEIN_X = 1800;
const VEIN_WITH_CLAY_X = -1900;
const CLAY_BANK_X = -2000;
const NEAR_VEIN_X = 400;

function farDeposit(id: number, kind: DepositKind, x: number): Deposit {
  return { cells: [], id, kind, x, z: 0 };
}

function readyTribe(deposits: readonly Deposit[]): { harness: SocietyHarness; tribe: Tribe } {
  const harness = new SocietyHarness({ day: MORNING, world: { deposits } });

  const tribe = teach(settle(harness, 4), THROUGH_MINING, 2);

  tribe.migrationStartDay = harness.context.environment.day - 10;
  tribe.stock.grain = 100;

  return { harness, tribe };
}

describe("prospecting", () => {
  it("leads a tribe that lacks ore to a far vein with clay beside it before a nearer one", () => {
    const { harness, tribe } = readyTribe([
      farDeposit(0, "copper", FAR_VEIN_X),
      farDeposit(1, "copper", VEIN_WITH_CLAY_X),
      farDeposit(2, "clay", CLAY_BANK_X),
    ]);

    expect(prospectingMove(tribe, harness.context)).toEqual({
      kind: "copper",
      origin: { x: VEIN_WITH_CLAY_X, z: 0 },
      reason: "they went to look for copper veins",
    });
  });

  it("stays when a vein is within reach, the tribe has just moved, or it lacks food for the road", () => {
    const near = readyTribe([farDeposit(0, "copper", NEAR_VEIN_X)]);

    expect(prospectingMove(near.tribe, near.harness.context)).toBeNull();

    const settler = readyTribe([farDeposit(0, "copper", FAR_VEIN_X)]);

    settler.tribe.migrationStartDay = settler.harness.context.environment.day;

    expect(prospectingMove(settler.tribe, settler.harness.context)).toBeNull();

    const hungry = readyTribe([farDeposit(0, "copper", FAR_VEIN_X)]);

    hungry.tribe.stock.grain = 0;
    hungry.tribe.stock.berries = 0;

    expect(prospectingMove(hungry.tribe, hungry.harness.context)).toBeNull();
  });
});
