import { describe, expect, it } from "vitest";
import { resourcesInGroup } from "./resources.ts";

describe("resources", () => {
  it("list the resources of one group", () => {
    expect(resourcesInGroup("arms")).toEqual(["spears", "bows", "arrows"]);
    expect(resourcesInGroup("ore")).toEqual(["copperOre", "tinOre", "ironOre"]);
  });
});
