import { describe, expect, it } from "vitest";
import {
  addShelter,
  createMiningHarness,
  SocietyHarness,
  settle,
  THROUGH_MINING,
  teach,
} from "../testing/test-society.ts";
import type { Building } from "./buildings.ts";
import { mineFor } from "./camp-plan.ts";
import { canAfford, completeConstruction, handleBuildingLoss, planConstruction } from "./construction.ts";
import type { Tribe } from "./tribe.ts";

const TRIBE_SIZE = 6;

interface Upgrade {
  harness: SocietyHarness;
  hut: Building;
  tent: Building;
  tribe: Tribe;
}

function planUpgrade(): Upgrade {
  const harness = new SocietyHarness();

  const tribe = teach(settle(harness, 3), ["shelter", "huts"]);
  const tent = addShelter(harness, tribe, "tent", tribe.campX + 20, tribe.campZ);

  tent.progress = 1;
  tribe.stock.stone = 10;
  tribe.stock.wood = 30;
  planConstruction(tribe, harness.context);

  const hut = harness.buildings.find(tribe.buildings.constructionSiteId);

  if (hut === null) {
    throw new Error("Expected a hut to be planned");
  }

  return { harness, hut, tent, tribe };
}

describe("construction planning", () => {
  it("lays out a campfire once the tribe knows fire", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, TRIBE_SIZE);

    tribe.technologies.add("fire");
    planConstruction(tribe, harness.context);

    const site = harness.buildings.find(tribe.buildings.constructionSiteId);

    expect(site?.kind).toBe("campfire");
    expect(tribe.buildings.campfireId).toBe(site?.id);
  });

  it("waits until the tribe can afford a building", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, TRIBE_SIZE);

    tribe.technologies.add("fire");
    tribe.stock.wood = 0;
    planConstruction(tribe, harness.context);

    expect(canAfford(tribe, "campfire")).toBe(false);
    expect(tribe.buildings.constructionSiteId).toBeNull();
  });

  it("opens a mine at a copper deposit once the tribe knows mining", () => {
    const harness = createMiningHarness();

    const tribe = settle(harness, 6);

    teach(tribe, THROUGH_MINING, 2);
    tribe.stock.wood = 200;
    tribe.stock.stone = 200;
    tribe.stock.clay = 200;
    tribe.stock.pottery = 20;

    for (let plan = 0; plan < 12; plan += 1) {
      planConstruction(tribe, harness.context);

      const site = harness.buildings.find(tribe.buildings.constructionSiteId);

      if (site !== null) {
        site.progress = 1;
        tribe.buildings.constructionSiteId = null;
      }
    }

    const mine = mineFor(tribe, harness.context, "copper");

    if (mine === null) {
      throw new Error("Expected a mine");
    }

    expect(mine.depositId).toBe(0);
    expect(Math.hypot(mine.x - 160, mine.z - 40)).toBeLessThan(25);
  });
});

describe("upgrades", () => {
  it("replace an outdated shelter once they stand", () => {
    const { harness, hut, tent, tribe } = planUpgrade();

    expect(hut.kind).toBe("hut");
    expect(hut.replacesId).toBe(tent.id);
    expect(tent.isRetiring).toBe(true);

    hut.progress = 1;
    completeConstruction(tribe, hut, harness.context);

    expect(tribe.buildings.constructionSiteId).toBeNull();
    expect(harness.buildings.find(tent.id)).toBeNull();
    expect(harness.buildings.takeLosses()).toEqual([{ building: tent, reason: "replaced" }]);
  });

  it("leave the outdated shelter standing when they burn down unfinished", () => {
    const { harness, hut, tent, tribe } = planUpgrade();

    harness.buildings.remove(hut, "burnt");

    for (const loss of harness.buildings.takeLosses()) {
      handleBuildingLoss(tribe, loss, harness.context);
    }

    expect(tent.isRetiring).toBe(false);
    expect(tribe.buildings.constructionSiteId).toBeNull();
    expect(tribe.buildings.shelterIds).toEqual([tent.id]);
  });
});
