import {
  Frustum,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import type { CellRegion } from "../../world/change-tracking.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { type PatchContent, PatchGrid } from "./patch-grid.ts";
import { PATCH_STEPS } from "./terrain-patches.ts";

const grid = new WorldGrid({ cellSize: 40, cellsPerSide: 128 });
const NEAR_CORNER = -1280;
const SKY = 5000;

function frustumOver(left: number, right: number): Frustum {
  const camera = new OrthographicCamera(left, right, grid.halfSize, -grid.halfSize, 1, SKY * 2);

  camera.position.set(0, SKY, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );
}

function cameraAt(x: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera();

  camera.position.set(x, 50, z);

  return camera;
}

function wholePatch(region: CellRegion): PatchContent {
  return {
    highest: 10,
    lowest: 0,
    pieces: [{ firstColumn: region.firstColumn, firstRow: region.firstRow, material: 0 }],
  };
}

function createPatches(measure: (region: CellRegion) => PatchContent | null = wholePatch): PatchGrid {
  return new PatchGrid(grid, measure, {
    edges: "open",
    materials: [new MeshBasicNodeMaterial()],
    pieceCells: 64,
    renderOrder: 0,
    shouldCastShadow: false,
  });
}

function geometries(patches: PatchGrid): InstancedBufferGeometry[] {
  return patches.group.children.flatMap((child) => {
    return child instanceof Mesh && child.geometry instanceof InstancedBufferGeometry ? [child.geometry] : [];
  });
}

function originVersions(patches: PatchGrid): number[] {
  return geometries(patches).map((geometry) => {
    const origins = geometry.getAttribute("origin");

    return origins instanceof InstancedBufferAttribute ? origins.version : Number.NaN;
  });
}

describe("patch grid", () => {
  const everything = frustumOver(-grid.halfSize, grid.halfSize);

  it("draws nearer patches finer and leaves out patches beyond the view", () => {
    const patches = createPatches();

    patches.update(cameraAt(NEAR_CORNER, NEAR_CORNER), everything, 1);

    expect(Array.from(patches.chosenLevels)).toEqual([0, 1, 1, 2]);
    expect(
      geometries(patches).map((geometry) => {
        return geometry.instanceCount;
      })
    ).toEqual([1, 2, 1, 0]);

    patches.update(cameraAt(NEAR_CORNER, NEAR_CORNER), frustumOver(-grid.halfSize, -grid.halfSize / 2), 1);

    expect(Array.from(patches.chosenLevels)).toEqual([0, -1, 1, -1]);
  });

  it("takes the shared level of a patch where one is given and draws the coarsest beyond the last distance", () => {
    const patches = createPatches();

    const coarsest = PATCH_STEPS.length - 1;

    patches.update(cameraAt(NEAR_CORNER, NEAR_CORNER), everything, 0.1, Int8Array.from([2, -1, 0, -1]));

    expect(Array.from(patches.chosenLevels)).toEqual([2, coarsest, 0, coarsest]);
  });

  it("skips patches with nothing to draw", () => {
    const patches = createPatches((region) => {
      return region.firstColumn === 0 && region.firstRow === 0 ? null : wholePatch(region);
    });

    patches.update(cameraAt(NEAR_CORNER, NEAR_CORNER), everything, 1);

    expect(Array.from(patches.chosenLevels)).toEqual([-1, 1, 1, 2]);
  });

  it("uploads the patch origins again only once the levels or the pieces change", () => {
    const patches = createPatches();
    const camera = cameraAt(NEAR_CORNER, NEAR_CORNER);

    patches.update(camera, everything, 1);

    const placed = originVersions(patches);

    patches.update(camera, everything, 1);

    expect(originVersions(patches)).toEqual(placed);

    patches.remeasure({ firstColumn: 0, firstRow: 0, lastColumn: 1, lastRow: 1 });
    patches.update(camera, everything, 1);

    const remeasured = originVersions(patches);

    expect(remeasured).not.toEqual(placed);

    patches.update(cameraAt(-NEAR_CORNER, -NEAR_CORNER), everything, 1);

    expect(originVersions(patches)).not.toEqual(remeasured);
  });
});
