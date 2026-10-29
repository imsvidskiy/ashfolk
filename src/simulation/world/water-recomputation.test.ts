import { beforeEach, describe, expect, it } from "vitest";
import { PlantSpecies } from "../../content/plants.ts";
import { DEFAULT_GENERATION_OPTIONS, type GenerationOptions } from "../../generation/generation-options.ts";
import { type GeneratedWorld, generateWorld } from "../../generation/world-generator.ts";
import { type Crossing, crossingLength } from "../../world/crossings.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { createTestWorld } from "../testing/test-world.ts";
import { flattenTerrain, raiseTerrain } from "./terrain-editing.ts";
import { WaterRecomputation } from "./water-recomputation.ts";
import { NO_BUILDING, SPRING_GROUND, WorldState } from "./world-state.ts";

const TEST_OPTIONS: GenerationOptions = {
  dimensions: { cellSize: 40, cellsPerSide: 96 },
  erosionStrength: 0.4,
  shape: "round",
};

function riverMiddle(world: WorldState): { x: number; z: number } {
  const longest = world.water.rivers.reduce((first, second) => {
    return second.points.length > first.points.length ? second : first;
  });
  const middle = longest.points[Math.floor(longest.points.length / 2)];

  if (middle === undefined) {
    throw new Error("Expected the island to have a river");
  }

  return { x: middle.x, z: middle.z };
}

describe("water recomputation", () => {
  let world: WorldState;

  beforeEach(() => {
    world = new WorldState(generateWorld(10, TEST_OPTIONS));
  });

  it("waits for the land to stay still before recomputing", () => {
    const recomputation = new WaterRecomputation(world);

    raiseTerrain(world, { radius: 200, ...riverMiddle(world) }, 5);

    expect(recomputation.update(0.1)).toBe("none");
    expect(recomputation.isPending).toBe(true);
    expect(recomputation.update(0.3)).toBe("none");
    expect(recomputation.update(0.5)).toBe("features");
    expect(recomputation.isPending).toBe(false);
  });

  it("does not deepen channels when recomputed repeatedly", () => {
    const recomputation = new WaterRecomputation(world);
    const heightsBefore = Float32Array.from(world.terrain.height);
    const lakesBefore = world.water.lakes.length;

    recomputation.recompute();
    recomputation.recompute();

    const largestChange = heightsBefore.reduce((largest, height, cell) => {
      return Math.max(largest, Math.abs(height - world.terrain.height[cell]));
    }, 0);

    expect(largestChange).toBeLessThan(0.01);
    expect(world.water.lakes).toHaveLength(lakesBefore);
  });

  it("keeps the springs at the heads of the recomputed rivers and their ground reserved", () => {
    const recomputation = new WaterRecomputation(world);

    raiseTerrain(world, { radius: 300, x: 0, z: 0 }, 20);
    recomputation.recompute();

    const reserved = new Set(
      world.water.springs.flatMap((spring) => {
        return spring.cells;
      })
    );

    expect(world.water.springs.length).toBeGreaterThan(0);

    for (const spring of world.water.springs) {
      expect(world.water.rivers[spring.river]).toBeDefined();
    }

    const springGround = Array.from({ length: world.grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return world.occupancy[cell] === SPRING_GROUND;
    });

    for (const cell of springGround) {
      expect(reserved.has(cell)).toBe(true);
    }

    for (const cell of reserved) {
      expect(world.occupancy[cell]).not.toBe(NO_BUILDING);
    }
  });

  it("keeps the water version when recomputing finds the same water", () => {
    const recomputation = new WaterRecomputation(world);

    expect(recomputation.recompute()).toBe("settled");
    expect(world.waterVersion).toBe(0);
  });

  it("reports new water when a spring's ground was freed", () => {
    const recomputation = new WaterRecomputation(world);

    raiseTerrain(world, { radius: 300, x: 0, z: 0 }, 20);
    recomputation.recompute();

    const [spring] = world.water.springs;

    if (spring === undefined) {
      throw new Error("Expected the island to have springs");
    }

    for (const cell of spring.cells) {
      world.occupancy[cell] = NO_BUILDING;
    }

    expect(recomputation.recompute()).toBe("features");
    expect(
      spring.cells.map((cell) => {
        return world.occupancy[cell];
      })
    ).toEqual(
      spring.cells.map(() => {
        return SPRING_GROUND;
      })
    );
  });

  it("clears rocks from the cells the water covers and leaves them on its dry banks", () => {
    const recomputation = new WaterRecomputation(world);
    const { grid } = world;

    const wetCells = Array.from({ length: grid.cellCount }, (_, cell) => {
      return cell;
    }).filter((cell) => {
      return world.isWater(cell);
    });

    for (const cell of wetCells.slice(0, 40)) {
      world.plant({
        bornDay: 0,
        height: 1.5,
        rotation: 0,
        seed: 0.5,
        species: PlantSpecies.Boulder,
        x: grid.cellCenterX(cell),
        z: grid.cellCenterZ(cell),
      });
    }

    recomputation.recompute();

    const wetBoulders = Array.from({ length: world.vegetation.count }, (_, plant) => {
      return plant;
    }).filter((plant) => {
      return (
        world.vegetation.species[plant] === PlantSpecies.Boulder &&
        world.vegetation.state[plant] === PlantState.Alive &&
        world.isWater(world.vegetation.cell[plant])
      );
    });

    expect(wetCells.length).toBeGreaterThan(40);
    expect(wetBoulders).toEqual([]);
  });

  it("keeps carving depths positive after an edit", () => {
    const recomputation = new WaterRecomputation(world);

    raiseTerrain(world, { radius: 300, ...riverMiddle(world) }, 20);
    recomputation.recompute();

    expect(Math.min(...world.terrain.carving)).toBeGreaterThanOrEqual(0);
    expect(world.waterVersion).toBe(1);
  });
});

describe("water recomputation over leveled land", () => {
  it("reports only the heights that recomputing changed", () => {
    const leveled = createTestWorld({ dimensions: { cellSize: 10, cellsPerSide: 48 } });

    const recomputation = new WaterRecomputation(leveled);

    for (let row = 10; row < 20; row += 1) {
      const cell = leveled.grid.index(30, row);

      leveled.terrain.carving[cell] = 3;
      leveled.terrain.height[cell] = 97;
    }

    recomputation.recompute();

    expect(leveled.heightChanges.takeRegion()).toEqual({ firstColumn: 28, firstRow: 8, lastColumn: 32, lastRow: 21 });

    recomputation.recompute();

    expect(leveled.heightChanges.takeRegion()).toBeNull();
  });

  it("does not raise the old channel again once the land over it was leveled", () => {
    const leveled = createTestWorld({ dimensions: { cellSize: 10, cellsPerSide: 24 } });

    const recomputation = new WaterRecomputation(leveled);

    for (let row = 4; row < 20; row += 1) {
      const cell = leveled.grid.index(12, row);

      leveled.terrain.carving[cell] = 3;
      leveled.terrain.height[cell] = 97;
    }

    flattenTerrain(leveled, { radius: 60, x: 5, z: 5 }, 100, 1);
    recomputation.recompute();

    expect(leveled.terrain.height[leveled.grid.cellAt(5, 5)]).toBeCloseTo(100, 2);
  });
});

describe("crossings after the water is worked out again", () => {
  let generated: GeneratedWorld;

  function freshWorld(): WorldState {
    if (generated === undefined) {
      generated = generateWorld(7, DEFAULT_GENERATION_OPTIONS);
    }

    return new WorldState({
      ...generated,
      terrain: {
        ...generated.terrain,
        carving: Float32Array.from(generated.terrain.carving),
        height: Float32Array.from(generated.terrain.height),
        riverStrength: Uint8Array.from(generated.terrain.riverStrength),
        waterSurface: Float32Array.from(generated.terrain.waterSurface),
      },
    });
  }

  function idsOf(crossings: readonly Crossing[]): number[] {
    return crossings
      .map((crossing) => {
        return crossing.id;
      })
      .sort((first, second) => {
        return first - second;
      });
  }

  it("keeps every crossing where the land stayed the same", { timeout: 60_000 }, () => {
    const state = freshWorld();

    const before = state.crossings;

    new WaterRecomputation(state).recompute();

    expect(idsOf(state.crossings)).toEqual(idsOf(before));
    expect(
      state.crossings.map((crossing) => {
        return crossingLength(crossing);
      })
    ).toEqual(
      before.map((crossing) => {
        return expect.closeTo(crossingLength(crossing), 6);
      })
    );
  });

  it("drops a crossing whose river was buried and keeps the others", { timeout: 60_000 }, () => {
    const state = freshWorld();

    const [buried, ...others] = state.crossings;

    if (buried === undefined) {
      throw new Error("Expected the island to have crossings");
    }

    raiseTerrain(state, { radius: 90, x: (buried.startX + buried.endX) / 2, z: (buried.startZ + buried.endZ) / 2 }, 40);
    new WaterRecomputation(state).recompute();

    const remaining = new Set(
      state.crossings.map((crossing) => {
        return crossing.id;
      })
    );

    expect(remaining.has(buried.id)).toBe(false);
    expect(
      others.filter((crossing) => {
        return remaining.has(crossing.id);
      }).length
    ).toBeGreaterThan(others.length * 0.8);
  });
});
