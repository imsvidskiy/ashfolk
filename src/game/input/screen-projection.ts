import { type Camera, type Ray, type Raycaster, Vector2, type Vector3 } from "three/webgpu";
import type { ScreenPoint, ViewportSize } from "./ground-picker.ts";

const aimed = new Vector2();

export function aimRay(raycaster: Raycaster, camera: Camera, screen: ScreenPoint, viewport: ViewportSize): Ray {
  aimed.set((screen.x / viewport.width) * 2 - 1, -(screen.y / viewport.height) * 2 + 1);
  raycaster.setFromCamera(aimed, camera);

  return raycaster.ray;
}

export function projectToNormalized(camera: Camera, x: number, y: number, z: number, target: Vector3): Vector3 | null {
  const viewPoint = target.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);

  if (viewPoint.z >= 0) {
    return null;
  }

  return viewPoint.applyMatrix4(camera.projectionMatrix);
}

export function normalizedToPixels(normalized: Vector3, viewport: ViewportSize): ScreenPoint {
  return {
    x: ((normalized.x + 1) / 2) * viewport.width,
    y: ((1 - normalized.y) / 2) * viewport.height,
  };
}
