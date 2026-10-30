import { bool, cameraPosition, dot, float, fract, length, max, screenCoordinate, smoothstep, vec2 } from "three/tsl";
import type { MeshStandardNodeMaterial, Node, Vector3 } from "three/webgpu";
import { smoothstep as smoothstepNumber } from "../shared/math.ts";
import { markOutlined } from "./outlines.ts";

const CAMERA_FADE_MARGIN = 0.5;
const CAMERA_FADE_BAND = 3;

export const CAMERA_FADE_REACH = CAMERA_FADE_MARGIN + CAMERA_FADE_BAND;

const DISSOLVE_START = 0.6;
const NOISE_SCALE = 52.982_918_9;
const NOISE_STEP = vec2(0.067_110_56, 0.005_837_15);

export interface ObjectExtent {
  readonly height: number;
  readonly radius: number;
}

export function extentOf(positions: Float32Array): ObjectExtent {
  let height = 0;
  let radius = 0;

  for (let offset = 0; offset < positions.length; offset += 3) {
    height = Math.max(height, positions[offset + 1]);
    radius = Math.max(radius, Math.hypot(positions[offset], positions[offset + 2]));
  }

  return { height, radius };
}

export function columnVisibility(camera: Vector3, base: Vector3, extent: ObjectExtent): number {
  const sideways = Math.max(Math.hypot(camera.x - base.x, camera.z - base.z) - extent.radius, 0);
  const above = Math.max(camera.y - base.y - extent.height, 0);

  return smoothstepNumber(CAMERA_FADE_MARGIN, CAMERA_FADE_MARGIN + CAMERA_FADE_BAND, Math.hypot(sideways, above));
}

export function columnVisibilityNode(base: Node<"vec3">, radius: Node<"float">, height: Node<"float">): Node<"float"> {
  const toCamera = cameraPosition.sub(base);
  const sideways = max(length(toCamera.xz).sub(radius), 0);
  const above = max(toCamera.y.sub(height), 0);

  return smoothstep(CAMERA_FADE_MARGIN, CAMERA_FADE_MARGIN + CAMERA_FADE_BAND, length(vec2(sideways, above)));
}

export function fadeNearCamera(material: MeshStandardNodeMaterial, visibility: Node<"float">): void {
  const threshold = fract(float(NOISE_SCALE).mul(fract(dot(screenCoordinate.xy, NOISE_STEP))));

  material.maskNode = threshold.lessThan(visibility.div(DISSOLVE_START));
  material.maskShadowNode = bool(true);

  markOutlined(material, smoothstep(DISSOLVE_START, 1, visibility));
}
