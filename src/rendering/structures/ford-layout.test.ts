import { describe, expect, it } from "vitest";
import { type Ford, STONE_RISE } from "../../world/crossings.ts";
import { NO_WATER } from "../../world/water.ts";
import {
  BAR_SHALLOWEST,
  type FordStone,
  type FordSurroundings,
  LARGEST_STEP_GAP,
  layFord,
  SIDE_DEEPEST,
  SLAB_LARGEST_SHARE,
  STONE_SINK,
  visibleWaterSpan,
} from "./ford-layout.ts";

const WATER_LEVEL = 100;
const RIVER_HALF_WIDTH = 12;
const VISIBLE_HALF_WIDTH = 13;
const BANK_HEIGHT = 100.6;
const BANK_SLOPE = 0.3;
const WATER_FALL = 0.2;

const FORD: Ford = { endX: 16, endZ: 0, id: 0, kind: "ford", seed: 0.37, startX: -16, startZ: 0 };

function riverDepth(x: number, deepest: number): number {
  const fromBank = RIVER_HALF_WIDTH - Math.abs(x);

  return Math.min(deepest, fromBank * 0.4);
}

function river(deepest: number): FordSurroundings {
  function heightAt(x: number): number {
    return Math.abs(x) < RIVER_HALF_WIDTH ? WATER_LEVEL - riverDepth(x, deepest) : BANK_HEIGHT;
  }

  return {
    heightAt: (x) => {
      return heightAt(x);
    },
    shoreDepthAt: (x) => {
      return Math.abs(x) < VISIBLE_HALF_WIDTH ? WATER_LEVEL + 0.2 - heightAt(x) : -1;
    },
    waterLevelAt: (x) => {
      return Math.abs(x) < RIVER_HALF_WIDTH ? WATER_LEVEL : NO_WATER;
    },
    waterSurfaceAt: (x) => {
      return Math.abs(x) < VISIBLE_HALF_WIDTH ? WATER_LEVEL : NO_WATER;
    },
  };
}

function hillsideStream(): FordSurroundings {
  function heightAt(x: number, z: number): number {
    const fromBank = Math.abs(x) - RIVER_HALF_WIDTH;
    const ground = fromBank < 0 ? WATER_LEVEL - riverDepth(x, 1.2) : BANK_HEIGHT + fromBank * BANK_SLOPE;

    return ground - z * WATER_FALL;
  }

  function surfaceAt(x: number, z: number): number {
    return Math.abs(x) < VISIBLE_HALF_WIDTH ? WATER_LEVEL - z * WATER_FALL : NO_WATER;
  }

  return {
    heightAt,
    shoreDepthAt: (x, z) => {
      return Math.abs(x) < RIVER_HALF_WIDTH ? surfaceAt(x, z) + 0.2 - heightAt(x, z) : -1;
    },
    waterLevelAt: (x, z) => {
      return Math.abs(x) < RIVER_HALF_WIDTH ? WATER_LEVEL - Math.round(z / 10) * 10 * WATER_FALL : NO_WATER;
    },
    waterSurfaceAt: surfaceAt,
  };
}

function footpath(stones: readonly FordStone[]): FordStone[] {
  return stones
    .filter((stone) => {
      return stone.kind === "step" || stone.kind === "slab";
    })
    .sort((first, second) => {
      return first.along - second.along;
    });
}

function widestGap(stones: readonly FordStone[]): number {
  const sorted = [...stones].sort((first, second) => {
    return first.along - first.radius - (second.along - second.radius);
  });

  let reach = sorted[0].along - sorted[0].radius;
  let widest = 0;

  for (const stone of sorted) {
    widest = Math.max(widest, stone.along - stone.radius - reach);
    reach = Math.max(reach, stone.along + stone.radius);
  }

  return widest;
}

function averageRadius(stones: readonly FordStone[]): number {
  return (
    stones.reduce((sum, stone) => {
      return sum + stone.radius;
    }, 0) / stones.length
  );
}

describe("layFord", () => {
  it("lays stones from one bank to the other without a gap wider than a stride", () => {
    for (const deepest of [0.3, 1.2, 2.8]) {
      const surroundings = river(deepest);
      const span = visibleWaterSpan(FORD, surroundings);
      const stones = footpath(layFord(FORD, surroundings).stones);
      const [first] = stones;
      const last = stones.at(-1);

      if (span === null || first === undefined || last === undefined) {
        throw new Error(`no ford across a river ${deepest} m deep`);
      }

      expect(first.along - first.radius).toBeLessThanOrEqual(span.start);
      expect(last.along + last.radius).toBeGreaterThanOrEqual(span.end);
      expect(widestGap(stones), `deepest ${deepest}`).toBeLessThanOrEqual(LARGEST_STEP_GAP + 1e-9);
    }
  });

  it("sets larger stones near the banks than in midstream", () => {
    const stones = footpath(layFord(FORD, river(1.2)).stones);

    const nearBanks = stones.filter((stone) => {
      return Math.abs(stone.x) > RIVER_HALF_WIDTH - 2.5;
    });
    const midstream = stones.filter((stone) => {
      return Math.abs(stone.x) < 5;
    });

    expect(nearBanks.length).toBeGreaterThan(1);
    expect(midstream.length).toBeGreaterThan(3);
    expect(averageRadius(nearBanks)).toBeGreaterThan(averageRadius(midstream) * 1.4);
  });

  it("raises stepping stones out of the water and lays flat slabs at the edges", () => {
    const surroundings = river(1.2);
    const stones = footpath(layFord(FORD, surroundings).stones);

    const steps = stones.filter((stone) => {
      return stone.kind === "step";
    });
    const slabs = stones.filter((stone) => {
      return stone.kind === "slab";
    });

    expect(steps.length).toBeGreaterThan(10);
    expect(slabs.length).toBeGreaterThan(0);

    for (const step of steps) {
      expect(step.top).toBeGreaterThan(WATER_LEVEL + STONE_RISE / 3);
      expect(step.bottom).toBeLessThan(WATER_LEVEL - BAR_SHALLOWEST);
    }

    for (const slab of slabs) {
      const ground = surroundings.heightAt(slab.x, slab.z);

      expect(slab.top).toBeGreaterThan(Math.max(ground, WATER_LEVEL));
      expect(slab.top).toBeLessThan(Math.max(ground, WATER_LEVEL) + 0.2);
      expect(slab.bottom).toBeCloseTo(ground - STONE_SINK);
    }
  });

  it("keeps one slab on each bank no larger than the middle stepping stone", () => {
    for (const deepest of [0.3, 1.2, 2.8]) {
      const stones = footpath(layFord(FORD, river(deepest)).stones);

      const steps = stones.filter((stone) => {
        return stone.kind === "step";
      });
      const slabs = stones.filter((stone) => {
        return stone.kind === "slab";
      });
      const middle = steps
        .map((stone) => {
          return stone.radius;
        })
        .toSorted((first, second) => {
          return first - second;
        })[Math.floor(steps.length / 2)];

      expect(slabs.length, `deepest ${deepest}`).toBeLessThanOrEqual(2);

      for (const slab of slabs) {
        expect(slab.radius).toBeLessThanOrEqual(middle * SLAB_LARGEST_SHARE + 1e-9);
      }
    }
  });

  it("keeps the gravel bar under the water and buries its edges in the ground", () => {
    const surroundings = river(2.8);
    const { bar } = layFord(FORD, surroundings);

    const points = bar.flat();
    const raised = points.filter((point) => {
      return point.grounding === 0;
    });

    expect(bar.length).toBeGreaterThan(20);
    expect(raised.length).toBeGreaterThan(bar.length);

    for (const point of raised) {
      expect(point.y).toBeLessThanOrEqual(WATER_LEVEL - BAR_SHALLOWEST + 1e-6);
      expect(point.y).toBeGreaterThanOrEqual(surroundings.heightAt(point.x, point.z));
      expect(surroundings.shoreDepthAt(point.x, point.z)).toBeGreaterThan(0);
    }

    for (const point of points.filter((candidate) => {
      return candidate.grounding === 1;
    })) {
      expect(point.y).toBeLessThan(surroundings.heightAt(point.x, point.z));
    }
  });

  it("sets stones in the water and keeps the ones beside the path from standing tall", () => {
    const surroundings = river(2.8);
    const { stones } = layFord(FORD, surroundings);

    const standing = stones.filter((stone) => {
      return stone.kind !== "slab";
    });
    const beside = stones.filter((stone) => {
      return stone.kind === "boulder";
    });

    expect(beside.length).toBeGreaterThan(0);

    for (const stone of standing) {
      expect(surroundings.shoreDepthAt(stone.x, stone.z)).toBeGreaterThan(0);
    }

    for (const stone of beside) {
      expect(stone.top - (stone.bottom + STONE_SINK)).toBeLessThanOrEqual(SIDE_DEEPEST);
      expect(stone.top).toBeGreaterThan(surroundings.waterSurfaceAt(stone.x, stone.z));
    }
  });

  it("lifts every stepping stone above the drawn water on its upstream side", () => {
    const surroundings = hillsideStream();
    const steps = layFord(FORD, surroundings).stones.filter((stone) => {
      return stone.kind === "step";
    });

    expect(steps.length).toBeGreaterThan(10);

    for (const step of steps) {
      const upstream = surroundings.waterSurfaceAt(step.x, step.z - step.radius);

      expect(step.top).toBeGreaterThan(upstream + STONE_RISE / 2);
    }
  });

  it("tilts the slabs on the banks up the slope", () => {
    const slabs = layFord(FORD, hillsideStream()).stones.filter((stone) => {
      return stone.kind === "slab";
    });

    expect(slabs.length).toBeGreaterThan(1);

    for (const slab of slabs) {
      const uphill = Math.cos(slab.rotation) * slab.pitch * Math.sign(slab.x);

      expect(Math.abs(slab.pitch)).toBeGreaterThan(Math.atan(BANK_SLOPE) * 0.5);
      expect(uphill).toBeGreaterThan(0);
    }
  });

  it("lays the same ford the same way every time and nothing where no water shows", () => {
    const surroundings = river(1.2);

    expect(layFord(FORD, surroundings)).toEqual(layFord(FORD, surroundings));
    expect(
      layFord(FORD, {
        ...surroundings,
        shoreDepthAt: () => {
          return -1;
        },
      })
    ).toEqual({ bar: [], stones: [] });
  });
});
