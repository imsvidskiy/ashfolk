import { beforeAll, describe, expect, it } from "vitest";
import { generationFingerprint } from "./generation-fingerprint.ts";
import type { GenerationOptions } from "./generation-options.ts";
import { type GeneratedWorld, generateWorld } from "./world-generator.ts";

const OPTIONS: GenerationOptions = {
  dimensions: { cellSize: 20, cellsPerSide: 128 },
  erosionStrength: 1,
  shape: "round",
};

function replacedFirst<T>(items: readonly T[], change: (item: T) => T): T[] {
  const [first, ...rest] = items;

  if (first === undefined) {
    throw new Error("The test world has none of these");
  }

  return [change(first), ...rest];
}

describe("generation fingerprints", () => {
  let world: GeneratedWorld;

  beforeAll(() => {
    world = generateWorld(7, OPTIONS);
  }, 60_000);

  it("gives the same island the same fingerprint and another island a different one", () => {
    const fingerprint = generationFingerprint(world);

    expect(generationFingerprint(generateWorld(7, OPTIONS))).toBe(fingerprint);
    expect(generationFingerprint(generateWorld(8, OPTIONS))).not.toBe(fingerprint);
  }, 60_000);

  it("keeps the fingerprints of known islands until generation is meant to change", () => {
    expect(generationFingerprint(world)).toBe(1_012_312_499);
    expect(generationFingerprint(generateWorld(7, { ...OPTIONS, shape: "square" }))).toBe(3_368_171_413);
  }, 60_000);

  it("changes when one river point moves", () => {
    const rivers = replacedFirst(world.water.rivers, (river) => {
      return {
        ...river,
        points: replacedFirst(river.points, (point) => {
          return { ...point, x: point.x + 1 };
        }),
      };
    });

    expect(generationFingerprint({ ...world, water: { ...world.water, rivers } })).not.toBe(
      generationFingerprint(world)
    );
  });

  it("changes when one lake level moves", () => {
    const lakes = replacedFirst(world.water.lakes, (lake) => {
      return { ...lake, level: lake.level + 1 };
    });

    expect(generationFingerprint({ ...world, water: { ...world.water, lakes } })).not.toBe(
      generationFingerprint(world)
    );
  });

  it("changes when one deposit covers another number of cells", () => {
    const deposits = replacedFirst(world.deposits, (deposit) => {
      return { ...deposit, cells: deposit.cells.slice(1) };
    });

    expect(generationFingerprint({ ...world, deposits })).not.toBe(generationFingerprint(world));
  });

  it("changes when one cell holds another biome", () => {
    const biome = world.terrain.biome.slice();

    biome[0] += 1;

    expect(generationFingerprint({ ...world, terrain: { ...world.terrain, biome } })).not.toBe(
      generationFingerprint(world)
    );
  });

  it("changes when one plant is gone", () => {
    const changed = generateWorld(7, OPTIONS);
    const fingerprint = generationFingerprint(changed);

    changed.vegetation.remove(0);

    expect(generationFingerprint(changed)).not.toBe(fingerprint);
  }, 60_000);

  it("gives a stable whole number when a layer holds NaN", () => {
    const height = world.terrain.height.slice();

    height[0] = Number.NaN;

    const withNaN = { ...world, terrain: { ...world.terrain, height } };
    const fingerprint = generationFingerprint(withNaN);

    expect(Number.isInteger(fingerprint)).toBe(true);
    expect(fingerprint).toBeGreaterThanOrEqual(0);
    expect(generationFingerprint(withNaN)).toBe(fingerprint);
  });
});
