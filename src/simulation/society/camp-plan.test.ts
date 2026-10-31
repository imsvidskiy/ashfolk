import { describe, expect, it, vi } from "vitest";
import { BUILDINGS } from "../../content/buildings.ts";
import { addShelter, completeStructure, SocietyHarness, settle, teach } from "../testing/test-society.ts";
import { buildingPlans } from "./camp-plan.ts";

const TRIBE_SIZE = 6;
const WALL_EXTENT = 20;
const KEPT_FROM_WALL = 4;

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

    completeStructure(
      tribe,
      harness.buildings.add(
        { extent: WALL_EXTENT, kind: "palisade", rotation: 0, tribeId: tribe.id, x: tribe.campX, z: tribe.campZ },
        harness.random
      )
    );

    const kiln = buildingPlans(tribe, harness.context).find((plan) => {
      return plan.kind === "kiln";
    });

    if (kiln === undefined) {
      throw new Error("Expected a kiln to be planned");
    }

    expect(kiln.farthest).toBeCloseTo(WALL_EXTENT - BUILDINGS.kiln.footprint - KEPT_FROM_WALL);
    expect(kiln.nearest).toBe(kiln.farthest);
  });
});
