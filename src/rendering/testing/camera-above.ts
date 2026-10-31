import { Frustum, Matrix4, PerspectiveCamera } from "three/webgpu";
import type { WorldMirror } from "../../game/world-mirror.ts";

export interface CameraView {
  readonly camera: PerspectiveCamera;
  readonly frustum: Frustum;
}

export function frustumOf(camera: PerspectiveCamera): Frustum {
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );
}

export function cameraAbove(mirror: WorldMirror, x: number, z: number, height: number): CameraView {
  const camera = new PerspectiveCamera(60, 1.5, 1, 40_000);
  const ground = mirror.heightAt(x, z);

  camera.position.set(x, ground + height, z + 1);
  camera.lookAt(x, ground, z);
  camera.updateMatrixWorld();

  return { camera, frustum: frustumOf(camera) };
}
