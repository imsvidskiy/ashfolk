import { describe, expect, it } from "vitest";
import { alongPath, type DetailSteps, segmentsAtLeast, segmentsUpTo, thinned } from "./level-of-detail.ts";

const NEAR: DetailSteps = { hasSmallParts: true };
const FAR: DetailSteps = { hasSmallParts: false };

describe("level of detail", () => {
  it("thins a path to every other point and keeps both ends", () => {
    expect(thinned([0, 1, 2, 3, 4])).toEqual([0, 2, 4]);
    expect(thinned([0, 1, 2, 3, 4, 5])).toEqual([0, 2, 4, 5]);
    expect(thinned([0, 1])).toEqual([0, 1]);
  });

  it("keeps every path point only where small parts show", () => {
    const path = [0, 1, 2, 3, 4, 5];

    expect(alongPath(path, NEAR)).toEqual(path);
    expect(alongPath(path, FAR)).toEqual([0, 2, 4, 5]);
  });

  it("caps segments lower when small parts are hidden", () => {
    expect(segmentsUpTo(NEAR, 12)).toBe(8);
    expect(segmentsUpTo(FAR, 12)).toBe(4);
    expect(segmentsUpTo(FAR, 3)).toBe(3);
  });

  it("raises segments to a floor that never passes the cap", () => {
    expect(segmentsAtLeast(NEAR, 6, 3)).toBe(6);
    expect(segmentsAtLeast(FAR, 6, 3)).toBe(4);
    expect(segmentsAtLeast(FAR, 6, 5)).toBe(5);
  });
});
