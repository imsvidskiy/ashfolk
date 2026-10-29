import { describe, expect, it } from "vitest";
import { LAKE_NAMES, PEAK_NAMES } from "../content/landmarks.ts";
import { type IslandSizeKind, islandDimensions } from "../world/island-size.ts";
import type { Monument } from "../world/monuments.ts";
import type { Lake } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { findLandmarks, type LandmarkSource } from "./landmarks.ts";

const GRID = new WorldGrid({ cellSize: 10, cellsPerSide: 8 });

function lake(id: number, cellCount: number): Lake {
  return { cellCount, centerX: id * 10, centerZ: -id * 10, id, level: 40 };
}

function sourceWith(lakes: readonly Lake[], seed = 7, monuments: readonly Monument[] = []): LandmarkSource {
  const heights = new Float32Array(GRID.cellCount).fill(20);

  heights[GRID.index(5, 2)] = 812.4;

  return { grid: GRID, heights, lakes, monuments, seed };
}

describe("findLandmarks", () => {
  it("names the highest peak with its height", () => {
    const [peak] = findLandmarks(sourceWith([]));

    expect(peak).toMatchObject({
      detail: "812 m",
      kind: "peak",
      x: GRID.cellCenterX(GRID.index(5, 2)),
      z: GRID.cellCenterZ(GRID.index(5, 2)),
    });
    expect(PEAK_NAMES).toContain(peak?.name);
  });

  it("names only the three largest lakes", () => {
    const landmarks = findLandmarks(sourceWith([lake(1, 80), lake(2, 400), lake(3, 20), lake(4, 150), lake(5, 90)]));
    const lakes = landmarks.filter((landmark) => {
      return landmark.kind === "lake";
    });

    expect(
      lakes.map((landmark) => {
        return landmark.id;
      })
    ).toEqual(["lake-2", "lake-4", "lake-5"]);
  });

  it("names more lakes on a larger island and fewer on a smaller one", () => {
    const lakes = [lake(1, 80), lake(2, 400), lake(3, 120), lake(4, 150), lake(5, 90)];

    function namedLakesOn(size: IslandSizeKind): number {
      const grid = new WorldGrid(islandDimensions(size));
      const source = { grid, heights: new Float32Array(grid.cellCount), lakes, monuments: [], seed: 7 };

      return findLandmarks(source).filter((landmark) => {
        return landmark.kind === "lake";
      }).length;
    }

    expect(namedLakesOn("large")).toBe(4);
    expect(namedLakesOn("small")).toBe(2);
  });

  it("gives every lake its own name", () => {
    const landmarks = findLandmarks(sourceWith([lake(1, 300), lake(2, 200), lake(3, 100)]));
    const names = landmarks
      .filter((landmark) => {
        return landmark.kind === "lake";
      })
      .map((landmark) => {
        return landmark.name;
      });

    expect(new Set(names).size).toBe(3);
    expect(
      names.every((name) => {
        return LAKE_NAMES.includes(name);
      })
    ).toBe(true);
  });

  it("keeps the same names for the same seed", () => {
    const lakes = [lake(1, 300), lake(2, 200)];

    expect(findLandmarks(sourceWith(lakes, 11))).toEqual(findLandmarks(sourceWith(lakes, 11)));
  });

  it("labels every monument with its name and kind", () => {
    const circle: Monument = { cells: [12], id: 4, kind: "stoneCircle", name: "Whispering Ring", x: 15, z: -25 };
    const landmarks = findLandmarks(sourceWith([], 7, [circle]));

    expect(landmarks).toContainEqual(
      expect.objectContaining({ detail: "Stone circle", id: "monument-4", kind: "monument", name: "Whispering Ring" })
    );
  });
});
