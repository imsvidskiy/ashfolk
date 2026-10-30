import { describe, expect, it } from "vitest";
import { isBetterMaterial } from "./weapons.ts";

describe("tool materials", () => {
  it("rank metal above stone and never above itself", () => {
    expect(isBetterMaterial("bronze", "stone")).toBe(true);
    expect(isBetterMaterial("stone", "bronze")).toBe(false);
    expect(isBetterMaterial("iron", "iron")).toBe(false);
  });
});
