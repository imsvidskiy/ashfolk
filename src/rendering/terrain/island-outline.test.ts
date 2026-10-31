import { describe, expect, it } from "vitest";
import { FULL_TURN, wrapAngle } from "../../shared/math.ts";
import { createRoundMirror } from "../testing/round-mirror.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { type GroundArea, IslandOutline, type OutlineSide } from "./island-outline.ts";

const AREA_SIZE = 160;
const SAMPLE_STEP = 2;
const COAST_SAMPLES = 24;
const round = createRoundMirror();

function sampledSides(outline: IslandOutline, area: GroundArea): Set<boolean> {
  const sides = new Set<boolean>();

  for (let z = area.minimumZ; z <= area.maximumZ; z += SAMPLE_STEP) {
    for (let x = area.minimumX; x <= area.maximumX; x += SAMPLE_STEP) {
      sides.add(outline.isInside(x, z));
    }
  }

  return sides;
}

describe("island outline", () => {
  it("tells areas wholly inside or outside the coast from those it crosses", () => {
    const outline = new IslandOutline(round);

    const { halfSize } = round.grid;
    const found = new Set<OutlineSide>();
    const misplaced: string[] = [];

    for (let minimumZ = -halfSize; minimumZ < halfSize; minimumZ += AREA_SIZE) {
      for (let minimumX = -halfSize; minimumX < halfSize; minimumX += AREA_SIZE) {
        const area = { maximumX: minimumX + AREA_SIZE, maximumZ: minimumZ + AREA_SIZE, minimumX, minimumZ };
        const side = outline.sideOf(area, 0);

        found.add(side);

        if (side !== "across" && sampledSides(outline, area).has(side === "outside")) {
          misplaced.push(`${side} at ${minimumX}, ${minimumZ}`);
        }
      }
    }

    expect(misplaced).toEqual([]);
    expect(found).toEqual(new Set(["across", "inside", "outside"]));
  });

  it("puts points on the round coast and turns them outward", () => {
    const outline = new IslandOutline(round);

    for (let sample = 0; sample < COAST_SAMPLES; sample += 1) {
      const angle = (sample / COAST_SAMPLES) * FULL_TURN;
      const [x, z] = outline.atCoast(Math.cos(angle), Math.sin(angle));
      const [outwardX, outwardZ] = outline.outwardAt(x, z);

      expect(wrapAngle(Math.atan2(z, x) - angle)).toBeCloseTo(0);
      expect(outline.isInside(x * 0.99, z * 0.99)).toBe(true);
      expect(outline.isInside(x * 1.01, z * 1.01)).toBe(false);
      expect(Math.hypot(outwardX, outwardZ)).toBeCloseTo(1);
      expect(outwardX * Math.cos(angle) + outwardZ * Math.sin(angle)).toBeGreaterThan(0);
    }
  });

  it("follows the grid edge of a square island", () => {
    const square = createVegetatedMirror();
    const outline = new IslandOutline(square);

    const { cellSize, halfSize } = square.grid;
    const edge = halfSize - cellSize / 2;

    expect(outline.coast).toBeNull();
    expect(outline.isInside(edge - 1, 0)).toBe(true);
    expect(outline.isInside(0, -edge - 1)).toBe(false);
    expect(outline.atCoast(12, -34)).toEqual([12, -34]);
    expect(outline.outwardAt(50, -10)).toEqual([1, 0]);
    expect(outline.outwardAt(-5, -40)).toEqual([0, -1]);
    expect(
      outline.sideOf({ maximumX: halfSize, maximumZ: halfSize, minimumX: -halfSize, minimumZ: -halfSize }, 0)
    ).toBe("inside");
  });
});
