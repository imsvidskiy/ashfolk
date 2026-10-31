import { describe, expect, it } from "vitest";
import { RECIPES } from "../../content/recipes.ts";
import { addStructure, SocietyHarness, settle, teach } from "../testing/test-society.ts";
import type { Tribe } from "./tribe.ts";
import { chooseCraft } from "./workshops.ts";

const LARGE_POTTERY_STOCK = 50;

function settleCrafters(harness: SocietyHarness): Tribe {
  const tribe = teach(settle(harness, 4), ["pottery", "spear"]);

  tribe.stock.clay = 6;
  tribe.stock.stone = 4;
  tribe.stock.wood = 20;

  return tribe;
}

describe("crafts", () => {
  it("are made at camp when they need only a workshop, and at their station otherwise", () => {
    const harness = new SocietyHarness();

    const tribe = settleCrafters(harness);

    expect(chooseCraft(tribe, harness.context, {})).toEqual(
      expect.objectContaining({ recipe: "spears", station: null })
    );

    const kiln = addStructure(harness, tribe, { kind: "kiln", x: tribe.campX + 20, z: tribe.campZ });

    expect(chooseCraft(tribe, harness.context, {})).toEqual(
      expect.objectContaining({ recipe: "pottery", station: kiln })
    );
  });

  it("keep pottery in stock for the buildings the tribe saves for", () => {
    const harness = new SocietyHarness();

    const tribe = settleCrafters(harness);

    addStructure(harness, tribe, { kind: "kiln", x: tribe.campX + 20, z: tribe.campZ });
    tribe.stock.pottery = LARGE_POTTERY_STOCK;

    expect(chooseCraft(tribe, harness.context, {})?.recipe).toBe("spears");
    expect(chooseCraft(tribe, harness.context, { pottery: LARGE_POTTERY_STOCK })?.recipe).toBe("pottery");
  });

  it("head spears with metal while the tribe has some, and with flint after", () => {
    const harness = new SocietyHarness();

    const tribe = teach(settleCrafters(harness), ["copper"]);

    tribe.stock.copper = 1;

    const copperHeaded = chooseCraft(tribe, harness.context, {});

    expect(copperHeaded).toEqual(expect.objectContaining({ material: "copper", recipe: "spears" }));
    expect(copperHeaded?.inputs.copper).toBe(1);
    expect(copperHeaded?.inputs.stone).toBeFalsy();

    tribe.stock.copper = 0;

    expect(chooseCraft(tribe, harness.context, {})).toEqual(
      expect.objectContaining({ inputs: RECIPES.spears.inputs, material: "stone", recipe: "spears" })
    );
  });
});
