import { describe, expect, it } from "vitest";
import type { IslandSketch } from "../generation/generation-options.ts";
import { shrinkSketch } from "./island-sketch.ts";

function sketchOf(cellsPerSide: number): IslandSketch {
  const count = cellsPerSide * cellsPerSide;

  return {
    cellSize: 10,
    cellsPerSide,
    coastDistance: new Float32Array(count).fill(1),
    ground: null,
    height: Float32Array.from({ length: count }, (_, cell) => {
      return cell;
    }),
    waterSurface: null,
  };
}

describe("island sketch", () => {
  it("keeps a small island as it is", () => {
    const sketch = sketchOf(640);

    expect(shrinkSketch(sketch)).toBe(sketch);
  });

  it("samples a large island down and keeps its width in meters", () => {
    const shrunk = shrinkSketch(sketchOf(1280));

    expect(shrunk.cellsPerSide).toBe(640);
    expect(shrunk.cellSize).toBe(20);
    expect(shrunk.height).toHaveLength(640 * 640);
    expect(shrunk.height[0]).toBe(640.5);
    expect(shrunk.ground).toBeNull();
    expect(shrunk.waterSurface).toBeNull();
  });

  it("blends heights so a slope stays even at an uneven step", () => {
    const shrunk = shrinkSketch(sketchOf(768));

    const rises = Array.from({ length: 12 }, (_, column) => {
      return shrunk.height[320 * 640 + column + 1] - shrunk.height[320 * 640 + column];
    });

    for (const rise of rises) {
      expect(rise).toBeCloseTo(1.2, 1);
    }
  });
});
