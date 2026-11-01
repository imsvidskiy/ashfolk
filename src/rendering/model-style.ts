import { float, varying } from "three/tsl";
import { InterpolationSamplingType, type MeshStandardNodeMaterial, type Node } from "three/webgpu";

export const MODEL_ROUGHNESS = 0.85;

export type ModelShading = "faceted" | "smooth";

const MODEL_SHADING: ModelShading = "faceted";

export const PEOPLE_SHADING: ModelShading = "smooth";

export function styleModel(material: MeshStandardNodeMaterial, shading = MODEL_SHADING): void {
  material.flatShading = shading === "faceted";
  material.roughnessNode = float(MODEL_ROUGHNESS);
}

export function modelColor(color: Node<"vec3">, name: string): Node<"vec3"> {
  const shared = varying(color, name);

  if (MODEL_SHADING === "faceted") {
    shared.setInterpolation(InterpolationSamplingType.FLAT);
  }

  return shared;
}
