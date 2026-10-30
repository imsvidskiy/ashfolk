import { describe, expect, it, vi } from "vitest";
import { addShelter, SocietyHarness, settle } from "../testing/test-society.ts";
import { buildingPlans } from "./camp-plan.ts";

const TRIBE_SIZE = 6;

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
});
