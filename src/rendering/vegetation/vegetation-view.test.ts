import {
  DirectionalLight,
  Frustum,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { CAMERA_FADE_REACH } from "../camera-fade.ts";
import { FireGlow } from "../effects/fire-glow.ts";
import { TerrainTextures } from "../terrain/terrain-textures.ts";
import { drawnInstances } from "../testing/drawn-meshes.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { FLOATS_PER_PLANT } from "./vegetation-chunks.ts";
import { VegetationView } from "./vegetation-view.ts";

function createView(): { mirror: WorldMirror; view: VegetationView } {
  const mirror = createVegetatedMirror();

  return { mirror, view: new VegetationView(mirror, new TerrainTextures(mirror), new FireGlow(mirror.grid)) };
}

function updateFrom(view: VegetationView, x: number, y: number, z: number): void {
  const camera = new PerspectiveCamera(60, 1.5, 0.1, 40_000);

  camera.position.set(x, y, z);
  camera.lookAt(x + 10, y - 2, z);
  camera.updateMatrixWorld();

  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );

  view.update(camera, frustum, new DirectionalLight(), 1, 0);
}

function fadingMeshes(view: VegetationView): Mesh<InstancedBufferGeometry>[] {
  return view.group.children.filter((child): child is Mesh<InstancedBufferGeometry> => {
    return (
      child instanceof Mesh &&
      child.geometry instanceof InstancedBufferGeometry &&
      child.material instanceof MeshStandardNodeMaterial &&
      child.material.maskNode !== null
    );
  });
}

function fadingCount(view: VegetationView): number {
  return fadingMeshes(view).reduce((total, mesh) => {
    return total + (mesh.visible ? mesh.geometry.instanceCount : 0);
  }, 0);
}

function plantCountNear(view: VegetationView, x: number, y: number, z: number): number {
  const camera = new PerspectiveCamera();

  camera.position.set(x, y, z);

  return view.chunks.chunks.reduce((total, chunk) => {
    if (chunk.bounds.isEmpty() || chunk.bounds.distanceToPoint(camera.position) >= CAMERA_FADE_REACH) {
      return total;
    }

    return (
      total +
      chunk.buckets.reduce((sum, bucket) => {
        return sum + bucket.length / FLOATS_PER_PLANT;
      }, 0)
    );
  }, 0);
}

describe("vegetation view", () => {
  it("draws only the plants in chunks around the camera with the fading material", () => {
    const { mirror, view } = createView();

    const { vegetation } = mirror;
    const [x] = vegetation.x;
    const [z] = vegetation.z;
    const [height] = vegetation.height;
    const y = mirror.heightAt(x, z) + height * 0.5;

    updateFrom(view, x, y, z);

    const near = plantCountNear(view, x, y, z);

    expect(near).toBeGreaterThan(0);
    expect(fadingCount(view)).toBe(near);
    expect(fadingCount(view)).toBeLessThan(vegetation.count);
  });

  it("puts every plant back on the solid material once the camera leaves", () => {
    const { mirror, view } = createView();

    const [x] = mirror.vegetation.x;
    const [z] = mirror.vegetation.z;

    updateFrom(view, x, mirror.heightAt(x, z) + 1, z);

    expect(fadingCount(view)).toBeGreaterThan(0);

    updateFrom(view, x, 5000, z);

    expect(fadingCount(view)).toBe(0);
  });

  it("stops drawing a plant removed from a chunk on screen", () => {
    const { mirror, view } = createView();

    const { vegetation } = mirror;
    const [x] = vegetation.x;
    const [z] = vegetation.z;
    const y = mirror.heightAt(x, z) + 1;

    updateFrom(view, x, y, z);

    const before = drawnInstances(view.group, "plantPlacement");

    vegetation.state[0] = PlantState.Removed;
    view.plantsChanged([0]);
    updateFrom(view, x, y, z);

    expect(drawnInstances(view.group, "plantPlacement")).toBe(before - 1);
  });

  it("shows every fading batch on the first frame, so its pipeline compiles before the camera comes close", () => {
    const { view } = createView();

    updateFrom(view, 0, 5000, 0);

    expect(fadingMeshes(view).length).toBeGreaterThan(0);
    expect(
      fadingMeshes(view).every((mesh) => {
        return mesh.visible;
      })
    ).toBe(true);

    updateFrom(view, 0, 5000, 0);

    expect(
      fadingMeshes(view).some((mesh) => {
        return mesh.visible;
      })
    ).toBe(false);
  });
});
