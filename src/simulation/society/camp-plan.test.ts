import { describe, expect, it, vi } from "vitest";
import { BUILDINGS } from "../../content/buildings.ts";
import { addShelter, addStructure, SocietyHarness, settle, teach } from "../testing/test-society.ts";
import { type BuildingPlan, buildingPlans } from "./camp-plan.ts";
import type { SocietyContext } from "./society-context.ts";
import type { Tribe } from "./tribe.ts";

const TRIBE_SIZE = 6;
const WALL_EXTENT = 20;

function kilnPlan(tribe: Tribe, context: SocietyContext): BuildingPlan {
  const kiln = buildingPlans(tribe, context).find((plan) => {
    return plan.kind === "kiln";
  });

  if (kiln === undefined) {
    throw new Error("Expected a kiln to be planned");
  }

  return kiln;
}

describe("building plans", () => {
  it("plans a wall without drawing from the random stream", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, TRIBE_SIZE);

    tribe.technologies.add("bronze");

    for (let index = 0; index < 5; index += 1) {
      addShelter(harness, tribe, "tent", tribe.campX + index * 12, tribe.campZ + 20).progress = 1;
    }

    const draw = vi.spyOn(harness.random, "next");

    const kinds = buildingPlans(tribe, harness.context).map((plan) => {
      return plan.kind;
    });

    expect(tribe.fields).toHaveLength(0);
    expect(kinds).toContain("palisade");
    expect(draw).not.toHaveBeenCalled();
  });

  it("keeps new buildings inside the camp wall", () => {
    const harness = new SocietyHarness();

    const tribe = teach(settle(harness, TRIBE_SIZE), ["pottery"]);

    const unwalled = kilnPlan(tribe, harness.context);

    addStructure(harness, tribe, { extent: WALL_EXTENT, kind: "palisade", x: tribe.campX, z: tribe.campZ });

    const kiln = kilnPlan(tribe, harness.context);

    expect(kiln.farthest + BUILDINGS.kiln.footprint).toBeLessThan(WALL_EXTENT);
    expect(kiln.farthest).toBeLessThan(unwalled.nearest);
    expect(kiln.nearest).toBe(kiln.farthest);
  });
});
