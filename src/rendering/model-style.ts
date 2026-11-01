import { float, varying } from "three/tsl";
import { InterpolationSamplingType, type MeshStandardNodeMaterial, type Node } from "three/webgpu";

type ModelShading = "faceted" | "smooth";

const MODEL_SHADING: ModelShading = "faceted";

export const MODEL_ROUGHNESS = 0.85;

export function styleModel(material: MeshStandardNodeMaterial): void {
  material.flatShading = MODEL_SHADING === "faceted";
  material.roughnessNode = float(MODEL_ROUGHNESS);
}

export function modelColor(color: Node<"vec3">, name: string): Node<"vec3"> {
  const shared = varying(color, name);

  if (MODEL_SHADING === "faceted") {
    shared.setInterpolation(InterpolationSamplingType.FLAT);
  }

  return shared;
}
