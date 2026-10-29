import { describe, expect, it } from "vitest";
import { LAKE_NAMES, PEAK_NAMES, POND_NAMES, WATER_NAME_QUALIFIERS } from "../content/landmarks.ts";
import { DEFAULT_GENERATION_OPTIONS } from "../generation/generation-options.ts";
import { generateWorld } from "../generation/world-generator.ts";
import type { Monument } from "../world/monuments.ts";
import type { Lake, Spring } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import {
  findLandmarks,
  type Landmark,
  type LandmarkSource,
  pondAcross,
  SMALLEST_NAMED_POND_ACROSS,
  waterNameAt,
} from "./landmarks.ts";

const GRID = new WorldGrid({ cellSize: 10, cellsPerSide: 8 });

function lake(id: number, cellCount: number): Lake {
  return { cellCount, centerX: id * 10, centerZ: -id * 10, id, level: 40 };
}

function pond(river: number, radius: number): Spring {
  return {
    cells: [],
    directionX: 1,
    directionZ: 0,
    kind: "pond",
    level: 40,
    radius,
    river,
    seed: river * 0.137 + 0.05,
    x: river * 20,
    z: river * 5,
  };
}

function lakeLandmarks(landmarks: readonly Landmark[]): Landmark[] {
  return landmarks.filter((landmark) => {
    return landmark.kind === "lake" || landmark.kind === "pond";
  });
}

function sourceWith(lakes: readonly Lake[], seed = 7, monuments: readonly Monument[] = []): LandmarkSource {
  const heights = new Float32Array(GRID.cellCount).fill(20);

  heights[GRID.index(5, 2)] = 812.4;

  return { grid: GRID, heights, lakes, monuments, seed, springs: [] };
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

  it("names every lake whatever its size", () => {
    const lakes = [lake(1, 80), lake(2, 400), lake(3, 20), lake(4, 150), lake(5, 1)];

    expect(
      lakeLandmarks(findLandmarks(sourceWith(lakes))).map((landmark) => {
        return landmark.id;
      })
    ).toEqual(["lake-1", "lake-2", "lake-3", "lake-4", "lake-5"]);
  });

  it("names the ponds wide enough to read as lakes and leaves small ponds and caves alone", () => {
    const wide = pond(1, 60);
    const small = pond(2, 12);
    const cave: Spring = { ...pond(3, 60), kind: "cave" };

    const names = lakeLandmarks(findLandmarks({ ...sourceWith([]), springs: [wide, small, cave] }));

    expect(pondAcross(wide)).toBeGreaterThan(SMALLEST_NAMED_POND_ACROSS);
    expect(pondAcross(small)).toBeLessThan(SMALLEST_NAMED_POND_ACROSS);
    expect(names).toEqual([expect.objectContaining({ id: "pond-1", kind: "pond", x: wide.x, z: wide.z })]);
    expect(POND_NAMES).toContain(names[0]?.name);
  });

  it("gives every lake and pond its own name", () => {
    const lakes = Array.from({ length: 6 }, (_, index) => {
      return lake(index, 100);
    });
    const springs = Array.from({ length: 6 }, (_, index) => {
      return pond(index, 60);
    });

    const names = lakeLandmarks(findLandmarks({ ...sourceWith(lakes), springs })).map((landmark) => {
      return landmark.name;
    });

    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
  });

  it("keeps the same names for the same seed", () => {
    const lakes = [lake(1, 300), lake(2, 200)];
    const springs = [pond(1, 60)];

    expect(findLandmarks({ ...sourceWith(lakes, 11), springs })).toEqual(
      findLandmarks({ ...sourceWith(lakes, 11), springs })
    );
  });

  it("never runs out of names, even past the lists", () => {
    const lakes = Array.from({ length: LAKE_NAMES.length * 15 }, (_, index) => {
      return lake(index, 100);
    });
    const springs = Array.from({ length: POND_NAMES.length * 3 }, (_, index) => {
      return pond(index, 60);
    });

    const names = lakeLandmarks(findLandmarks({ ...sourceWith(lakes), springs })).map((landmark) => {
      return landmark.name;
    });

    expect(new Set(names).size).toBe(lakes.length + springs.length);
    expect(names).toContain(`Upper ${LAKE_NAMES[0]}`);
  });

  it("keeps the lake and pond lists apart and free of the qualifiers", () => {
    const names = [...LAKE_NAMES, ...POND_NAMES];

    expect(LAKE_NAMES.length).toBeGreaterThanOrEqual(80);
    expect(new Set(names).size).toBe(names.length);
    expect(
      names.filter((name) => {
        return WATER_NAME_QUALIFIERS.includes(name.split(" ")[0] ?? "");
      })
    ).toEqual([]);
  });

  it("qualifies a name once the list wraps", () => {
    const names = ["Reed Lake", "Moon Lake"];

    expect(waterNameAt(names, 1)).toBe("Moon Lake");
    expect(waterNameAt(names, 2)).toBe(`${WATER_NAME_QUALIFIERS[0]} Reed Lake`);
    expect(waterNameAt(names, 2 + 2 * WATER_NAME_QUALIFIERS.length)).toBe(`${WATER_NAME_QUALIFIERS[0]} Reed Lake 2`);
  });

  it("labels every monument with its name and kind", () => {
    const circle: Monument = { cells: [12], id: 4, kind: "stoneCircle", name: "Whispering Ring", x: 15, z: -25 };
    const landmarks = findLandmarks(sourceWith([], 7, [circle]));

    expect(landmarks).toContainEqual(
      expect.objectContaining({ detail: "Stone circle", id: "monument-4", kind: "monument", name: "Whispering Ring" })
    );
  });
});

describe("findLandmarks on a generated world", () => {
  it("names every lake and every pond wide enough to read as one", () => {
    const { dimensions, monuments, seed, terrain, water } = generateWorld(7, DEFAULT_GENERATION_OPTIONS);
    const grid = new WorldGrid(dimensions);
    const source = { grid, heights: terrain.height, lakes: water.lakes, monuments, seed, springs: water.springs };

    const named = new Set(
      lakeLandmarks(findLandmarks(source)).map((landmark) => {
        return landmark.id;
      })
    );
    const wantedPonds = water.springs.filter((spring) => {
      return spring.kind === "pond" && pondAcross(spring) >= SMALLEST_NAMED_POND_ACROSS;
    });

    expect(wantedPonds.length).toBeGreaterThan(0);

    for (const generatedLake of water.lakes) {
      expect(named).toContain(`lake-${generatedLake.id}`);
    }

    for (const spring of wantedPonds) {
      expect(named).toContain(`pond-${spring.river}`);
    }

    expect(named.size).toBe(water.lakes.length + wantedPonds.length);
  });
});
