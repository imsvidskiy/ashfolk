import { describe, expect, it } from "vitest";
import {
  BROOK_STRENGTH,
  HOP_REACH,
  HOP_WIDTH,
  hopTargets,
  isBrookCell,
  NOT_CLEAR,
  Passage,
  traceHops,
} from "./brooks.ts";
import { NO_WATER, riverCodeOfStrength, riverWidthOfStrength } from "./water.ts";
import { WorldGrid } from "./world-grid.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 32 });
const WIDTH_PER_CODE =
  (riverWidthOfStrength(1) - riverWidthOfStrength(0)) / (riverCodeOfStrength(1) - riverCodeOfStrength(0));
const STRENGTH_SAMPLES = Array.from({ length: 101 }, (_, index) => {
  return index / 100;
});

interface Stream {
  readonly fromX: number;
  readonly strength: number;
  readonly toX: number;
}

function terrainWith(streams: readonly Stream[]) {
  const height = new Float32Array(grid.cellCount).fill(100);
  const waterSurface = new Float32Array(grid.cellCount).fill(NO_WATER);
  const riverStrength = new Uint8Array(grid.cellCount);

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    const x = grid.cellCenterX(cell);

    for (const stream of streams) {
      if (x > stream.fromX && x < stream.toX) {
        waterSurface[cell] = 100.8;
        riverStrength[cell] = stream.strength;
      }
    }
  }

  return { height, riverStrength, waterSurface };
}

function passageIn(terrain: ReturnType<typeof terrainWith>): (cell: number) => Passage {
  return (cell) => {
    if (isBrookCell(terrain, cell)) {
      return Passage.Brook;
    }

    return terrain.waterSurface[cell] === NO_WATER ? Passage.Ground : Passage.Blocked;
  };
}

describe("brooks", () => {
  it("end at the river code hydrology writes for a stream one hop wide", () => {
    function isBrookOfStrength(strength: number): boolean {
      const terrain = terrainWith([{ fromX: 0, strength: riverCodeOfStrength(strength), toX: 10 }]);

      return isBrookCell(terrain, grid.cellAt(5, 0));
    }

    const hoppable = STRENGTH_SAMPLES.filter((strength) => {
      return riverWidthOfStrength(strength) <= HOP_WIDTH;
    });
    const wider = STRENGTH_SAMPLES.filter((strength) => {
      return riverWidthOfStrength(strength) >= HOP_WIDTH + WIDTH_PER_CODE;
    });

    expect(hoppable.length).toBeGreaterThan(0);
    expect(wider.length).toBeGreaterThan(0);
    expect(hoppable.every(isBrookOfStrength)).toBe(true);
    expect(wider.some(isBrookOfStrength)).toBe(false);
  });

  it("are river water no wider than a hop", () => {
    const terrain = terrainWith([
      { fromX: 0, strength: BROOK_STRENGTH, toX: 10 },
      { fromX: 50, strength: BROOK_STRENGTH + 1, toX: 60 },
      { fromX: 100, strength: 0, toX: 110 },
    ]);

    expect(isBrookCell(terrain, grid.cellAt(5, 0))).toBe(true);
    expect(isBrookCell(terrain, grid.cellAt(55, 0))).toBe(false);
    expect(isBrookCell(terrain, grid.cellAt(105, 0))).toBe(false);
    expect(isBrookCell(terrain, grid.cellAt(-25, 0))).toBe(false);
  });

  it("are hopped once on a line straight across and not at all on dry ground", () => {
    const passageOf = passageIn(terrainWith([{ fromX: 0, strength: BROOK_STRENGTH, toX: 20 }]));

    expect(traceHops(grid, { x: -15, z: 3 }, { x: 35, z: -4 }, passageOf)).toBe(1);
    expect(traceHops(grid, { x: -55, z: 3 }, { x: -15, z: 40 }, passageOf)).toBe(0);
  });

  it("cannot be hopped along their length, ending in them or past a wider river", () => {
    const passageOf = passageIn(
      terrainWith([
        { fromX: 0, strength: BROOK_STRENGTH, toX: 20 },
        { fromX: 60, strength: BROOK_STRENGTH + 20, toX: 70 },
      ])
    );

    expect(traceHops(grid, { x: 5, z: -100 }, { x: 5, z: 100 }, passageOf)).toBe(NOT_CLEAR);
    expect(traceHops(grid, { x: -15, z: 0 }, { x: 5, z: 0 }, passageOf)).toBe(NOT_CLEAR);
    expect(traceHops(grid, { x: 45, z: 0 }, { x: 85, z: 0 }, passageOf)).toBe(NOT_CLEAR);
  });

  it("cannot be hopped where the water runs on longer than a hop", () => {
    const passageOf = passageIn(terrainWith([{ fromX: 0, strength: BROOK_STRENGTH, toX: 30 }]));

    expect(HOP_REACH).toBeLessThan(30);
    expect(traceHops(grid, { x: -5, z: 0 }, { x: 35, z: 0 }, passageOf)).toBe(NOT_CLEAR);
  });

  it("lead from a bank only to dry ground on the far side", () => {
    const passageOf = passageIn(terrainWith([{ fromX: 0, strength: BROOK_STRENGTH, toX: 20 }]));

    const targets = hopTargets(grid, grid.cellAt(-5, 5), passageOf);

    expect(targets.length).toBeGreaterThan(0);
    expect(
      targets.every((target) => {
        return grid.cellCenterX(target) > 20;
      })
    ).toBe(true);
  });
});
