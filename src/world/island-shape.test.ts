import { describe, expect, it } from "vitest";
import { createIslandShape, type IslandShape, isIslandShapeKind } from "./island-shape.ts";

const ANGLES = 48;

function coastAround(shape: IslandShape, radius: number): number[] {
  return Array.from({ length: ANGLES }, (_, step) => {
    const angle = (step / ANGLES) * Math.PI * 2;

    return shape.coastDistanceAt(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

describe("island shapes", () => {
  it("measure a square island from its straight sides", () => {
    const square = createIslandShape("square", 7);

    expect(square.coastDistanceAt(0, 0)).toBe(1);
    expect(square.coastDistanceAt(0.5, -0.25)).toBe(0.5);
    expect(square.coastDistanceAt(-1, 0.3)).toBe(0);
  });

  it("draw the same round coast for a seed and another coast for another seed", () => {
    const coast = coastAround(createIslandShape("round", 7), 0.8);

    expect(coastAround(createIslandShape("round", 7), 0.8)).toEqual(coast);
    expect(coastAround(createIslandShape("round", 8), 0.8)).not.toEqual(coast);
  });

  it("keep a round island on land at its middle and inside the square it is cut from", () => {
    for (const seed of [1, 7, 42, 149, 900]) {
      const round = createIslandShape("round", seed);

      expect(round.coastDistanceAt(0, 0)).toBeGreaterThan(0.7);
      expect(Math.max(...coastAround(round, 0.98))).toBeLessThan(0);
      expect(round.coastDistanceAt(0.97, 0.97)).toBeLessThan(0);
    }

    expect(createIslandShape("round", 149).coastDistanceAt(-0.98, 0)).toBeLessThan(0);
  });

  it("know their names", () => {
    expect(isIslandShapeKind("round")).toBe(true);
    expect(isIslandShapeKind("triangle")).toBe(false);
  });
});
