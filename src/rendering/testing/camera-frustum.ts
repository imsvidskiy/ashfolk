import { type Camera, Frustum, Matrix4 } from "three/webgpu";

export function frustumOf(camera: Camera): Frustum {
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );
}
