import { describe, expect, it, it as test } from "vitest";
import { CROP_KINDS } from "../../content/crops.ts";
import { MaterialSlot } from "../materials.ts";
import { type MeshData, triangleCount } from "../mesh/mesh-data.ts";
import { meshProblems, verticesWhere } from "../testing/mesh-checks.ts";
import { loosePieces } from "../testing/mesh-connectivity.ts";
import { buildCropModel, buildFenceModel, CROP_DETAIL_LEVELS, CROP_HEAD_PART, CROP_HEIGHTS } from "./crop-models.ts";

const FENCE_LENGTH = 10;

const HEAD_SLOTS = {
  barley: MaterialSlot.Grain,
  beans: MaterialSlot.Lichen,
  carrots: MaterialSlot.Carrot,
  flax: MaterialSlot.Flax,
  turnips: MaterialSlot.Turnip,
  wheat: MaterialSlot.Grain,
} as const;

function headsOf(mesh: MeshData): number[] {
  return verticesWhere(mesh, (vertex) => {
    return mesh.channels.part[vertex] === CROP_HEAD_PART;
  });
}

describe.each(CROP_KINDS)("%s clump", (kind) => {
  test("builds clean geometry with every piece rooted at both levels of detail", () => {
    for (const level of CROP_DETAIL_LEVELS) {
      const mesh = buildCropModel(kind, level);

      expect(meshProblems(mesh)).toEqual([]);
      expect(loosePieces(mesh)).toEqual([]);
    }
  });

  test("grows to about its height from the ground", () => {
    const mesh = buildCropModel(kind, "high");

    expect(mesh.bounds.minimum[1]).toBeGreaterThan(-0.06);
    expect(mesh.bounds.maximum[1]).toBeGreaterThan(CROP_HEIGHTS[kind] * 0.75);
    expect(mesh.bounds.maximum[1]).toBeLessThan(CROP_HEIGHTS[kind] * 1.2);
  });

  test("keeps ears, flowers, pods or roots in their own part and color", () => {
    for (const level of CROP_DETAIL_LEVELS) {
      const mesh = buildCropModel(kind, level);
      const heads = headsOf(mesh);

      expect(heads.length).toBeGreaterThan(0);
      expect(
        heads.every((vertex) => {
          return mesh.channels.slot[vertex] === HEAD_SLOTS[kind];
        })
      ).toBe(true);
    }
  });

  test("spends fewer triangles further away", () => {
    expect(triangleCount(buildCropModel(kind, "low"))).toBeLessThan(triangleCount(buildCropModel(kind, "high")));
  });
});

describe("field fence", () => {
  it.each(CROP_DETAIL_LEVELS)("stands its %s posts in the ground along the whole edge", (level) => {
    const fence = buildFenceModel(FENCE_LENGTH, level);

    expect(meshProblems(fence)).toEqual([]);
    expect(loosePieces(fence)).toEqual([]);
    expect(fence.bounds.minimum[1]).toBeLessThan(0);
    expect(fence.bounds.minimum[0]).toBeLessThan(0);
    expect(fence.bounds.maximum[0]).toBeGreaterThan(FENCE_LENGTH);
    expect(
      fence.channels.slot.every((slot) => {
        return slot === MaterialSlot.Wood;
      })
    ).toBe(true);
  });
});
