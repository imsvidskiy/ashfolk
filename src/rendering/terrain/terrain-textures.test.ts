import { describe, expect, it } from "vitest";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { TerrainTextures } from "./terrain-textures.ts";

function stepsOf(textures: TerrainTextures): number[] {
  const { data } = textures.patchSteps.image;

  return data instanceof Float32Array ? Array.from(data) : [];
}

describe("terrain textures", () => {
  it("keeps the step each terrain patch is drawn at for the water and plants, and full detail where none is", () => {
    const textures = new TerrainTextures(createVegetatedMirror({ dimensions: { cellSize: 10, cellsPerSide: 128 } }));
    const levels = Int8Array.from([0, 3, -1, 2]);

    const { version } = textures.patchSteps;

    textures.followPatchLevels(levels);

    const followed = textures.patchSteps.version;

    expect(stepsOf(textures)).toEqual([1, 8, 1, 4]);
    expect(followed).not.toBe(version);

    textures.followPatchLevels(levels);

    expect(textures.patchSteps.version).toBe(followed);
  });
});
