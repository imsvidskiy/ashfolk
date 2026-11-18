import { describe, expect, it } from "vitest";
import { tornadoDuration, tornadoPositionAt } from "./tornado-path.ts";

describe("tornado paths", () => {
  const path = [0, 0, 10, 0, 10, 20];

  it("last half a second for every leg", () => {
    expect(tornadoDuration(path)).toBeCloseTo(1);
  });

  it("move along each leg in turn and stay at the end once spent", () => {
    expect(tornadoPositionAt(path, 0)).toEqual({ x: 0, z: 0 });
    expect(tornadoPositionAt(path, 0.25)).toEqual({ x: 5, z: 0 });
    expect(tornadoPositionAt(path, 0.75)).toEqual({ x: 10, z: 10 });
    expect(tornadoPositionAt(path, 5)).toEqual({ x: 10, z: 20 });
  });
});
