import type { Frustum, PerspectiveCamera, Sphere } from "three/webgpu";
import type { WorldMirror } from "../game/world-mirror.ts";

export const HIDDEN_LEVEL = -1;

export interface ViewInput {
  readonly camera: PerspectiveCamera;
  readonly detail: number;
  readonly frustum: Frustum;
  readonly mirror: WorldMirror;
}

export function assignSphereLevels(
  items: Iterable<{ readonly bounds: Sphere; level: number }>,
  camera: PerspectiveCamera,
  frustum: Frustum,
  limits: readonly number[],
  detail: number
): boolean {
  let hasChanged = false;

  for (const item of items) {
    const distance = Math.max(0, camera.position.distanceTo(item.bounds.center) - item.bounds.radius);

    const level = frustum.intersectsSphere(item.bounds)
      ? limits.findIndex((limit) => {
          return distance < limit * detail;
        })
      : HIDDEN_LEVEL;

    if (level !== item.level) {
      item.level = level;
      hasChanged = true;
    }
  }

  return hasChanged;
}
