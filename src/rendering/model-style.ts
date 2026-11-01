import { float, varying } from "three/tsl";
import { InterpolationSamplingType, type MeshStandardNodeMaterial, type Node } from "three/webgpu";

export const MODEL_ROUGHNESS = 0.85;

export function styleModel(material: MeshStandardNodeMaterial, isFaceted = true): void {
  material.flatShading = isFaceted;
  material.roughnessNode = float(MODEL_ROUGHNESS);
}

export function modelColor(color: Node<"vec3">, name: string): Node<"vec3"> {
  const shared = varying(color, name);

  shared.setInterpolation(InterpolationSamplingType.FLAT);

  return shared;
}
