import { describe, expect, it } from "vitest";
import { WorldMirror } from "../../game/world-mirror.ts";
import { Simulation } from "../../simulation/simulation.ts";
import {
  centerCell,
  createVegetatedWorld,
  floodCells,
  floodStrip,
  fordAcross,
  riverStrip,
  type TestWorldOptions,
} from "../../simulation/testing/test-world.ts";
import { BROOK_STRENGTH } from "../../world/brooks.ts";
import { type Crossing, STONE_RISE } from "../../world/crossings.ts";
import { standingHeight } from "./agent-view-input.ts";

const WADING_DEPTH = 1.1;

function flatSimulation(overrides: Partial<TestWorldOptions> = {}): Simulation {
  return new Simulation(
    createVegetatedWorld({
      dimensions: { cellSize: 10, cellsPerSide: 64 },
      heightAt: () => {
        return 100;
      },
      ...overrides,
    })
  );
}

function mirrorWithPool(depth: number) {
  const simulation = flatSimulation();

  const pool = centerCell(simulation.world);

  floodCells(simulation.world, [pool], depth);

  const { grid } = simulation.world;

  return {
    mirror: new WorldMirror(simulation.initialWorld(), 0),
    x: grid.cellCenterX(pool),
    z: grid.cellCenterZ(pool),
  };
}

describe("standing height", () => {
  it("stands on dry ground", () => {
    const { mirror, x, z } = mirrorWithPool(3);

    expect(standingHeight(mirror, x + 200, z, WADING_DEPTH)).toBeCloseTo(100, 3);
  });

  it("wades through shallow water on the bottom", () => {
    const { mirror, x, z } = mirrorWithPool(0.6);

    expect(standingHeight(mirror, x, z, WADING_DEPTH)).toBeCloseTo(100, 3);
  });

  it("keeps the head above deep water", () => {
    const { mirror, x, z } = mirrorWithPool(3);

    expect(standingHeight(mirror, x, z, WADING_DEPTH)).toBeCloseTo(103 - WADING_DEPTH, 3);
  });
});

describe("standing over brooks", () => {
  it("runs over a brook ankle-deep in the water, not on its bed", () => {
    const simulation = flatSimulation();

    riverStrip(simulation.world, -20, 0, BROOK_STRENGTH);
    riverStrip(simulation.world, 40, 60, BROOK_STRENGTH + 20);

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    expect(standingHeight(mirror, -5, 0, WADING_DEPTH)).toBeCloseTo(100.62, 3);
    expect(standingHeight(mirror, 45, 0, WADING_DEPTH)).toBeCloseTo(100, 3);
  });
});

describe("standing on crossings", () => {
  function mirrorWithRiver(crossing: Crossing): WorldMirror {
    const simulation = flatSimulation({ crossings: [crossing] });

    floodStrip(simulation.world, 20, 1.5);

    return new WorldMirror(simulation.initialWorld(), 0);
  }

  it("steps on the stones of a ford just above the water", () => {
    const mirror = mirrorWithRiver(fordAcross(-24, 24, 0));

    expect(standingHeight(mirror, 0, 0.2, WADING_DEPTH)).toBeCloseTo(101.5 + STONE_RISE, 3);
    expect(standingHeight(mirror, 0, 6, WADING_DEPTH)).toBeCloseTo(101.5 - WADING_DEPTH, 3);
    expect(standingHeight(mirror, -60, 0, WADING_DEPTH)).toBeCloseTo(100, 3);
  });

  it("walks along the top of a fallen log", () => {
    const mirror = mirrorWithRiver({
      endDeck: 101.2,
      endX: 25,
      endZ: 10,
      id: 0,
      kind: "log",
      seed: 0.3,
      startDeck: 101.2,
      startX: -25,
      startZ: 10,
    });

    expect(standingHeight(mirror, 0, 10, WADING_DEPTH)).toBeCloseTo(101.2, 3);
    expect(standingHeight(mirror, -25, 10, WADING_DEPTH)).toBeCloseTo(101.2, 3);
    expect(standingHeight(mirror, -25, 12, WADING_DEPTH)).toBeCloseTo(100, 3);
  });
});
