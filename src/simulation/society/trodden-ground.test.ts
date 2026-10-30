import { describe, expect, it } from "vitest";
import { PlantSpecies } from "../../content/plants.ts";
import { addShelter, MORNING, SocietyHarness, settle } from "../testing/test-society.ts";
import { TroddenGround } from "./trodden-ground.ts";

describe("trodden ground", () => {
  it("bares the earth around buildings and the camp, so nothing grows there", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 4);

    const tent = addShelter(harness, tribe, "tent", tribe.campX + 25, tribe.campZ);

    tent.progress = 1;
    new TroddenGround().update(0.2, harness.context, [tribe]);

    const { world } = harness;

    const camp = world.grid.cellAt(tribe.campX, tribe.campZ);
    const besideTent = world.grid.cellAt(tent.x + 4, tent.z);
    const farAway = world.grid.cellAt(tribe.campX + 200, tribe.campZ + 200);

    expect(world.isTrodden(camp)).toBe(true);
    expect(world.isTrodden(besideTent)).toBe(true);
    expect(world.isTrodden(farAway)).toBe(false);
    expect(world.canGrowWild(besideTent, PlantSpecies.Oak)).toBe(false);
    expect(world.groundChanges.takeRuns().length).toBeGreaterThan(0);
  });

  it("lets grass come back once a camp is left", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 4);

    const trodden = new TroddenGround();

    trodden.update(0.2, harness.context, [tribe]);

    const camp = harness.world.grid.cellAt(tribe.campX, tribe.campZ);

    expect(harness.world.isTrodden(camp)).toBe(true);

    trodden.update(10, harness.context, []);

    expect(harness.world.fields.trodden[camp]).toBe(0);
  });
});
