import { describe, expect, it } from "vitest";
import { WorldMirror } from "../../game/world-mirror.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { sampleHeight } from "../../world/terrain-sampling.ts";
import { createRoundMirror } from "../testing/round-mirror.ts";
import { buildIslandBaseGeometry, islandPlinthHeight } from "./island-base-geometry.ts";
import { type CoastPoint, IslandOutline } from "./island-outline.ts";

const CELLS_PER_SIDE = 32;
const COAST_TOLERANCE = 1.5;
const NUDGE = 0.01;
const round = createRoundMirror();

function rimPoints(mirror: WorldMirror): (readonly [number, number])[] {
  const outline = new IslandOutline(mirror);

  const { cliff } = buildIslandBaseGeometry(mirror, outline, islandPlinthHeight(mirror, outline));

  const topPoints = cliff.getAttribute("topPoint");
  const cliffAmounts = cliff.getAttribute("cliffAmount");
  const rim: (readonly [number, number])[] = [];

  for (let vertex = 0; vertex < cliffAmounts.count; vertex += 1) {
    if (cliffAmounts.getX(vertex) === 1) {
      rim.push([topPoints.getX(vertex), topPoints.getY(vertex)]);
    }
  }

  return rim;
}

function latticeLines(
  mirror: WorldMirror,
  from: readonly [number, number],
  towards: readonly [number, number]
): number[] {
  const { cellSize, halfSize } = mirror.grid;

  const length = Math.hypot(towards[0] - from[0], towards[1] - from[1]);
  const share = NUDGE / length;

  const x = from[0] + (towards[0] - from[0]) * share;
  const z = from[1] + (towards[1] - from[1]) * share;

  const column = (x + halfSize) / cellSize - 0.5;
  const row = (z + halfSize) / cellSize - 0.5;

  return [Math.floor(column), Math.floor(row), Math.floor(column + row), Math.floor(column - row)];
}

function coastOf(outline: IslandOutline): readonly CoastPoint[] {
  if (outline.coast === null) {
    throw new Error("A round island has a coast outline");
  }

  return outline.coast;
}

function squareMirror(cellsPerSide = CELLS_PER_SIDE): WorldMirror {
  const world = createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide } });

  return new WorldMirror(new Simulation(world).initialWorld(), 0);
}

describe("island base geometry", () => {
  it("tops the square cliff at every edge cell exactly once", () => {
    const mirror = squareMirror();

    const { grid } = mirror;

    const last = CELLS_PER_SIDE - 1;
    const edges = new Set<string>();

    const rim = rimPoints(mirror).map(([x, z]) => {
      const cell = grid.cellAt(x, z);

      return `${grid.columnOf(cell)},${grid.rowOf(cell)}`;
    });

    for (let position = 0; position <= last; position += 1) {
      edges.add(`${position},0`).add(`${position},${last}`).add(`0,${position}`).add(`${last},${position}`);
    }

    expect(rim).toHaveLength(edges.size);
    expect(new Set(rim)).toEqual(edges);
  });

  it("hangs the underside tip deeper under a larger island", () => {
    for (const [cellsPerSide, depth] of [
      [CELLS_PER_SIDE, 1650],
      [768, 1650 * 1.2],
    ] as const) {
      const mirror = squareMirror(cellsPerSide);
      const outline = new IslandOutline(mirror);
      const plinth = islandPlinthHeight(mirror, outline);

      const positions = buildIslandBaseGeometry(mirror, outline, plinth).underside.getAttribute("position");

      expect(positions.getY(positions.count - 1)).toBeCloseTo(plinth - depth * 1.12, 2);
    }
  });

  it("tops the round cliff along the outline the terrain is cut by", () => {
    const outline = new IslandOutline(round);

    const rim = rimPoints(round);
    const coast = coastOf(outline);

    expect(rim).toHaveLength(coast.length);

    for (const [index, [x, z]] of rim.entries()) {
      const { angle, radius } = coast[index];

      expect(x).toBeCloseTo(Math.cos(angle) * radius, 3);
      expect(z).toBeCloseTo(Math.sin(angle) * radius, 3);
      expect(Math.abs(sampleHeight(round.terrain.coastDistance, round.grid, x, z))).toBeLessThan(COAST_TOLERANCE);
    }
  });

  it("tucks the round cliff top under the terrain edge", () => {
    const outline = new IslandOutline(round);

    const { cliff } = buildIslandBaseGeometry(round, outline, islandPlinthHeight(round, outline));

    const positions = cliff.getAttribute("position");
    const cliffAmounts = cliff.getAttribute("cliffAmount");
    const outside: number[] = [];

    for (let vertex = 0; vertex < cliffAmounts.count; vertex += 1) {
      const isTop = cliffAmounts.getX(vertex) === 1;

      if (isTop && !outline.isInside(positions.getX(vertex), positions.getZ(vertex))) {
        outside.push(vertex);
      }
    }

    expect(outside).toEqual([]);
  });

  it("breaks the cliff top at every line of the terrain mesh it crosses", () => {
    const rim = rimPoints(round);

    const segments = rim
      .map((start, index) => {
        return [start, rim[(index + 1) % rim.length]] as const;
      })
      .filter(([start, end]) => {
        return Math.hypot(end[0] - start[0], end[1] - start[1]) > NUDGE * 2;
      });

    for (const [start, end] of segments) {
      expect(latticeLines(round, end, start)).toEqual(latticeLines(round, start, end));
    }
  });
});
