import { describe, expect, it } from "vitest";
import type { Spring } from "../../world/water.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { CaveOutlets } from "./cave-outlets.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 32 });

const SPRING: Omit<Spring, "kind" | "x" | "z"> = {
  cells: [],
  directionX: 0,
  directionZ: 1,
  level: 4,
  radius: 4,
  river: 0,
  seed: 0.3,
};

const SPRINGS: readonly Spring[] = [
  { ...SPRING, kind: "cave", x: -60, z: -60 },
  { ...SPRING, kind: "pond", x: 60, z: 60 },
];

function slotAt(outlets: CaveOutlets, x: number, z: number): number {
  const cells = outlets.cells.image.data;

  return cells instanceof Float32Array ? cells[grid.cellAt(x, z)] : Number.NaN;
}

describe("cave outlets", () => {
  it("marks the cells from inside each cave to where its river runs free, and leaves ponds out", () => {
    const outlets = new CaveOutlets(grid, SPRINGS);

    expect(slotAt(outlets, -60, -60)).toBe(1);
    expect(slotAt(outlets, -60, -45)).toBe(1);
    expect(slotAt(outlets, -60, -120)).toBe(0);
    expect(slotAt(outlets, 0, -60)).toBe(0);
    expect(slotAt(outlets, 60, 60)).toBe(0);

    outlets.rebuild([]);

    expect(slotAt(outlets, -60, -60)).toBe(0);
  });

  it("reaches two grid cells beside the mouth, where a river can still be wet", () => {
    const outlets = new CaveOutlets(grid, SPRINGS);

    expect(slotAt(outlets, -95, -55)).toBe(1);
    expect(slotAt(outlets, -25, -55)).toBe(1);
    expect(slotAt(outlets, -105, -55)).toBe(0);
    expect(slotAt(outlets, -15, -55)).toBe(0);
  });
});
