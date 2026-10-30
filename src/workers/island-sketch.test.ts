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
    expect(shrunk.height[0]).toBe(1281);
    expect(shrunk.ground).toBeNull();
    expect(shrunk.waterSurface).toBeNull();
  });
});
