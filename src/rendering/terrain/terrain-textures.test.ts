import { WebGPURenderer } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import type { WorldChanges } from "../world-changes.ts";
import { TerrainTextures } from "./terrain-textures.ts";

const SEASON = 0.3;
const NO_CHANGES: WorldChanges = {
  groundRuns: [],
  hasWaterChanged: false,
  heightRegion: null,
  surfaceRuns: [],
  vegetationIndices: [],
  waterLevelRegion: null,
};

function createTextures(): TerrainTextures {
  return new TerrainTextures(createVegetatedMirror({ dimensions: { cellSize: 10, cellsPerSide: 128 } }));
}

function stepsOf(textures: TerrainTextures): number[] {
  const { data } = textures.patchSteps.image;

  return data instanceof Float32Array ? Array.from(data) : [];
}

describe("terrain textures", () => {
  it("keeps the step each terrain patch is drawn at for the water and plants, and full detail where none is", () => {
    const textures = createTextures();
    const levels = Int8Array.from([0, 3, -1, 2]);

    textures.followPatchLevels(Int8Array.from([3, 3, 3, 3]));

    const { version } = textures.patchSteps;

    textures.followPatchLevels(levels);

    const followed = textures.patchSteps.version;

    expect(stepsOf(textures)).toEqual([1, 8, 1, 4]);
    expect(followed).not.toBe(version);

    textures.followPatchLevels(levels);

    expect(textures.patchSteps.version).toBe(followed);
  });

  it("paints the ground on the first update and again only once the season moves on", () => {
    const textures = createTextures();
    const renderer: WebGPURenderer = Object.create(WebGPURenderer.prototype);
    const paint = vi.spyOn(textures.groundAlbedo, "paint").mockImplementation(ignore);

    textures.update(renderer, SEASON, NO_CHANGES);

    expect(paint).toHaveBeenCalledTimes(1);

    textures.update(renderer, SEASON, NO_CHANGES);
    textures.update(renderer, SEASON + 0.005, NO_CHANGES);

    expect(paint).toHaveBeenCalledTimes(1);

    textures.update(renderer, SEASON + 0.02, NO_CHANGES);

    expect(paint).toHaveBeenCalledTimes(2);
  });
});
