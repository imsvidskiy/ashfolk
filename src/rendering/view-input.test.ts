import { Frustum, Matrix4, PerspectiveCamera, Sphere, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { assignSphereLevels, HIDDEN_LEVEL, levelWithin } from "./view-input.ts";

const LIMITS = [100, 300, 900];

interface Item {
  readonly bounds: Sphere;
  level: number;
}

function createView() {
  const camera = new PerspectiveCamera(60, 1, 1, 10_000);

  camera.updateMatrixWorld();

  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );

  return { camera, frustum };
}

function itemAt(z: number, radius: number): Item {
  return { bounds: new Sphere(new Vector3(0, 0, z), radius), level: HIDDEN_LEVEL };
}

describe("view input", () => {
  it("picks the first level whose limit, scaled by the detail, lies beyond the distance", () => {
    expect(levelWithin(50, LIMITS, 1)).toBe(0);
    expect(levelWithin(100, LIMITS, 1)).toBe(1);
    expect(levelWithin(150, LIMITS, 2)).toBe(0);
    expect(levelWithin(850, LIMITS, 0.5)).toBe(HIDDEN_LEVEL);
  });

  it("measures from the surface of a sphere in view and hides the ones behind the camera", () => {
    const { camera, frustum } = createView();
    const near = itemAt(-140, 60);
    const far = itemAt(-500, 10);
    const behind = itemAt(200, 10);

    assignSphereLevels([near, far, behind], camera, frustum, LIMITS, 1);

    expect([near.level, far.level, behind.level]).toEqual([0, 2, HIDDEN_LEVEL]);
  });

  it("reports a change only when a level moves", () => {
    const { camera, frustum } = createView();
    const items = [itemAt(-140, 60)];

    expect(assignSphereLevels(items, camera, frustum, LIMITS, 1)).toBe(true);
    expect(assignSphereLevels(items, camera, frustum, LIMITS, 1)).toBe(false);
    expect(assignSphereLevels(items, camera, frustum, LIMITS, 0.5)).toBe(true);
  });
});
