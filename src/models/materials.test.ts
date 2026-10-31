import { describe, expect, it } from "vitest";
import { MaterialSlot } from "./materials.ts";

describe("material slots", () => {
  it("gives every slot its own number, so no two materials share a color", () => {
    const slots = Object.values(MaterialSlot);

    expect(new Set(slots).size).toBe(slots.length);
  });
});
