import { describe, expect, it } from "vitest";
import { bareTribe } from "../../testing/test-rivalry.ts";
import type { Building } from "../buildings.ts";
import { type Claim, claimOf, claimOverlap, claimRadius, isInsideClaim, rangeOverlap } from "./territory.ts";

function claimAt(x: number, radius: number): Claim {
  return { radius, range: radius * 2, tribeId: x, x, z: 0 };
}

describe("territory", () => {
  it("claims more land as a tribe grows and builds", () => {
    const small = claimRadius(7, 0);
    const grown = claimRadius(20, 0);
    const settled = claimRadius(20, 6);

    expect(grown).toBeGreaterThan(small);
    expect(settled).toBeGreaterThan(grown);
    expect(claimRadius(500, 100)).toBe(claimRadius(400, 100));
  });

  it("reaches past the farthest building of the camp", () => {
    const tribe = bareTribe(1);

    const outpost: Building = {
      burningSeconds: 0,
      cell: 0,
      cells: [],
      depositId: -1,
      extent: 0,
      fuel: 1,
      health: 30,
      id: 2,
      isRetiring: false,
      kind: "tent",
      progress: 1,
      replacesId: null,
      rotation: 0,
      seed: 0.5,
      style: 0,
      tribeId: 1,
      x: 600,
      z: 0,
    };

    const claim = claimOf(tribe, [outpost]);

    expect(claim.radius).toBeGreaterThan(600);
    expect(claim.range).toBeGreaterThan(claim.radius);
  });

  it("measures how far two claims overlap", () => {
    expect(claimOverlap(claimAt(0, 200), claimAt(1000, 200))).toBe(0);
    expect(claimOverlap(claimAt(0, 200), claimAt(0, 200))).toBe(1);
    expect(claimOverlap(claimAt(0, 200), claimAt(300, 200))).toBeCloseTo(0.5);
    expect(rangeOverlap(claimAt(0, 200), claimAt(500, 200))).toBeGreaterThan(0);
    expect(claimOverlap(claimAt(0, 200), claimAt(500, 200))).toBe(0);
  });

  it("knows who stands on its land", () => {
    const claim = claimAt(0, 200);

    expect(isInsideClaim(claim, { x: 150, z: 100 })).toBe(true);
    expect(isInsideClaim(claim, { x: 250, z: 0 })).toBe(false);
  });
});
