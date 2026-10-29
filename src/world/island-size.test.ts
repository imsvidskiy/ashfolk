import { describe, expect, it } from "vitest";
import { countForArea, isIslandSizeKind, islandDimensions, islandSizeOf, islandSpanShare } from "./island-size.ts";
import { DEFAULT_GRID_DIMENSIONS } from "./world-grid.ts";

describe("island sizes", () => {
  it("keeps the normal island on the default grid", () => {
    expect(islandDimensions("normal")).toBe(DEFAULT_GRID_DIMENSIONS);
  });

  it("keeps 10 m cells and tiles every size into whole terrain patches", () => {
    for (const size of ["small", "normal", "large"] as const) {
      const { cellSize, cellsPerSide } = islandDimensions(size);

      expect(cellSize).toBe(10);
      expect(cellsPerSide % 64).toBe(0);
    }

    expect(islandDimensions("small").cellsPerSide).toBeLessThan(640);
    expect(islandDimensions("large").cellsPerSide).toBeGreaterThan(640);
  });

  it("reads the size back from the dimensions and treats others as normal", () => {
    expect(islandSizeOf(islandDimensions("small"))).toBe("small");
    expect(islandSizeOf(islandDimensions("large"))).toBe("large");
    expect(islandSizeOf(DEFAULT_GRID_DIMENSIONS)).toBe("normal");
    expect(islandSizeOf({ cellSize: 20, cellsPerSide: 128 })).toBe("normal");
  });

  it("measures each size against the normal island", () => {
    expect(islandSpanShare(DEFAULT_GRID_DIMENSIONS)).toBe(1);
    expect(islandSpanShare(islandDimensions("small"))).toBe(0.8);
    expect(islandSpanShare(islandDimensions("large"))).toBe(1.2);
  });

  it("knows its size names", () => {
    expect(isIslandSizeKind("large")).toBe(true);
    expect(isIslandSizeKind("huge")).toBe(false);
  });

  it("keeps counts of the normal island and of test grids, and scales them with the area of other sizes", () => {
    expect(countForArea(DEFAULT_GRID_DIMENSIONS, 3)).toBe(3);
    expect(countForArea(islandDimensions("small"), 3)).toBe(2);
    expect(countForArea(islandDimensions("large"), 3)).toBe(4);
    expect(countForArea(islandDimensions("small"), 1)).toBe(1);
    expect(countForArea({ cellSize: 20, cellsPerSide: 128 }, 3)).toBe(3);
  });
});
