import { describe, expect, it } from "vitest";
import { completeStructure, SocietyHarness, settle, teach } from "../testing/test-society.ts";
import type { Building } from "./buildings.ts";
import type { Tribe } from "./tribe.ts";
import { chooseCraft } from "./workshops.ts";

function settleCrafters(harness: SocietyHarness): Tribe {
  const tribe = teach(settle(harness, 4), ["pottery", "spear"]);

  tribe.stock.clay = 6;
  tribe.stock.stone = 4;
  tribe.stock.wood = 20;

  return tribe;
}

function buildKiln(harness: SocietyHarness, tribe: Tribe): Building {
  const kiln = harness.buildings.add(
    { kind: "kiln", rotation: 0, tribeId: tribe.id, x: tribe.campX + 20, z: tribe.campZ },
    harness.random
  );

  return completeStructure(tribe, kiln);
}

describe("crafts", () => {
  it("are made at camp when they need only a workshop, and at their station otherwise", () => {
    const harness = new SocietyHarness();

    const tribe = settleCrafters(harness);

    expect(chooseCraft(tribe, harness.context, {})).toEqual(
      expect.objectContaining({ recipe: "spears", station: null })
    );

    const kiln = buildKiln(harness, tribe);

    expect(chooseCraft(tribe, harness.context, {})).toEqual(
      expect.objectContaining({ recipe: "pottery", station: kiln })
    );
  });

  it("keep pottery in stock for the buildings the tribe saves for", () => {
    const harness = new SocietyHarness();

    const tribe = settleCrafters(harness);

    buildKiln(harness, tribe);
    tribe.stock.pottery = 12;

    expect(chooseCraft(tribe, harness.context, {})?.recipe).toBe("spears");
    expect(chooseCraft(tribe, harness.context, { pottery: 2 })?.recipe).toBe("pottery");
  });

  it("head spears with metal while the tribe has some, and with flint after", () => {
    const harness = new SocietyHarness();

    const tribe = teach(settleCrafters(harness), ["copper"]);

    tribe.stock.copper = 1;

    expect(chooseCraft(tribe, harness.context, {})).toEqual(
      expect.objectContaining({ inputs: { copper: 1, stone: 0, wood: 2 }, material: "copper", recipe: "spears" })
    );

    tribe.stock.copper = 0;

    expect(chooseCraft(tribe, harness.context, {})).toEqual(
      expect.objectContaining({ inputs: { stone: 1, wood: 2 }, material: "stone", recipe: "spears" })
    );
  });
});
