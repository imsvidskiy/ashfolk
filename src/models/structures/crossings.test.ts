import { describe, expect, it, it as test } from "vitest";
import { MaterialSlot } from "../materials.ts";
import { type MeshData, triangleCount, vertexCount } from "../mesh/mesh-data.ts";
import { highestOpenEdge, meshProblems } from "../testing/mesh-checks.ts";
import { loosePieces } from "../testing/mesh-connectivity.ts";
import {
  buildFallenLogs,
  buildSteppingStones,
  CROSSING_DETAIL_LEVELS,
  type CrossingDetailLevel,
  FALLEN_LOG_LENGTHS,
  FALLEN_LOG_ROOT_RADIUS,
  FALLEN_LOG_VARIANTS,
  fallenLogVariant,
  STEPPING_STONE_HEIGHT,
} from "./crossings.ts";

const GROUND_LEVEL = 0.05;

const MODELS: readonly (readonly [string, (level: CrossingDetailLevel) => MeshData[]])[] = [
  ["stepping stones", buildSteppingStones],
  ["fallen logs", buildFallenLogs],
];

function averageTriangles(meshes: readonly MeshData[]): number {
  return (
    meshes.reduce((sum, mesh) => {
      return sum + triangleCount(mesh);
    }, 0) / meshes.length
  );
}

function lowestNear(mesh: MeshData, along: number, reach: number): number {
  let lowest = Number.POSITIVE_INFINITY;

  for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
    if (Math.abs(mesh.positions[vertex * 3] - along) < reach) {
      lowest = Math.min(lowest, mesh.positions[vertex * 3 + 1]);
    }
  }

  return lowest;
}

function shareOfSlot(mesh: MeshData, slot: number, beyond = Number.NEGATIVE_INFINITY): number {
  let count = 0;
  let matching = 0;

  for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
    if (mesh.positions[vertex * 3] > beyond) {
      count += 1;
      matching += mesh.channels.slot[vertex] === slot ? 1 : 0;
    }
  }

  return matching / count;
}

describe.each(MODELS)("%s", (_name, build) => {
  test("builds clean variants at every level of detail", () => {
    for (const level of CROSSING_DETAIL_LEVELS) {
      for (const mesh of build(level)) {
        expect(meshProblems(mesh)).toEqual([]);
      }
    }
  });

  test("closes every variant everywhere above the ground", () => {
    for (const level of CROSSING_DETAIL_LEVELS) {
      for (const [variant, mesh] of build(level).entries()) {
        expect(highestOpenEdge(mesh), `${level} variant ${variant}`).toBeLessThan(GROUND_LEVEL);
      }
    }
  });

  test("keeps every part of every variant attached to the ground", () => {
    for (const level of CROSSING_DETAIL_LEVELS) {
      for (const [variant, mesh] of build(level).entries()) {
        const detached = loosePieces(mesh);

        expect(detached, `${level} variant ${variant}`).toEqual([]);
      }
    }
  });

  test("spends fewer triangles further away", () => {
    expect(averageTriangles(build("medium"))).toBeLessThan(averageTriangles(build("high")));
    expect(averageTriangles(build("low"))).toBeLessThan(averageTriangles(build("medium")));
  });

  test("gives the same model for the same variant", () => {
    const [first] = build("medium");
    const [again] = build("medium");

    expect(again.positions).toEqual(first.positions);
  });
});

describe("stepping stones", () => {
  it("stand on the riverbed and reach their full height with a flat, worn top", () => {
    for (const stone of buildSteppingStones("high")) {
      const width = stone.bounds.maximum[0] - stone.bounds.minimum[0];

      expect(stone.bounds.minimum[1]).toBeCloseTo(0, 2);
      expect(stone.bounds.maximum[1]).toBeCloseTo(STEPPING_STONE_HEIGHT, 1);
      expect(width).toBeGreaterThan(0.7);
      expect(width).toBeLessThan(1.4);
      expect(shareOfSlot(stone, MaterialSlot.PaleStone)).toBeGreaterThan(0.05);
    }
  });
});

describe("fallen logs", () => {
  it("rest on the ground from the root to the broken tip", () => {
    for (const [variant, log] of buildFallenLogs("high").entries()) {
      const length = FALLEN_LOG_LENGTHS[variant % FALLEN_LOG_LENGTHS.length];

      for (const along of [length * 0.2, length * 0.5, length * 0.95]) {
        expect(lowestNear(log, along, 0.6), `variant ${variant} at ${along.toFixed(1)}`).toBeLessThan(0.06);
        expect(lowestNear(log, along, 0.6), `variant ${variant} at ${along.toFixed(1)}`).toBeGreaterThan(-0.12);
      }

      expect(log.bounds.maximum[0]).toBeGreaterThan(length);
      expect(log.bounds.maximum[0]).toBeLessThan(length + 1);
    }
  });

  it("are mostly bare wood with a root plate rising at the root end", () => {
    for (const log of buildFallenLogs("high")) {
      expect(shareOfSlot(log, MaterialSlot.Deadwood, 4)).toBeGreaterThan(0.7);
      expect(log.channels.slot).toContain(MaterialSlot.Bark);
      expect(log.bounds.maximum[1]).toBeGreaterThan(FALLEN_LOG_ROOT_RADIUS * 3.5);
      expect(log.bounds.minimum[0]).toBeLessThan(0);
    }
  });

  it("picks the closest length and every shape of a log", () => {
    const shapes = FALLEN_LOG_VARIANTS / FALLEN_LOG_LENGTHS.length;

    for (const [lengthIndex, length] of FALLEN_LOG_LENGTHS.entries()) {
      for (const span of [length - 1, length + 1]) {
        const variants = new Set(
          Array.from({ length: 16 }, (_, step) => {
            return fallenLogVariant(span, step / 16);
          })
        );

        for (const variant of variants) {
          expect(Number.isInteger(variant)).toBe(true);
          expect(variant).toBeLessThan(FALLEN_LOG_VARIANTS);
          expect(variant % FALLEN_LOG_LENGTHS.length).toBe(lengthIndex);
        }

        expect(variants.size).toBe(shapes);
      }
    }
  });
});
