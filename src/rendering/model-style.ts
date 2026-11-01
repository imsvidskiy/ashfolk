import { float } from "three/tsl";
import type { MeshStandardNodeMaterial } from "three/webgpu";

type ModelShading = "faceted" | "smooth";

const MODEL_SHADING: ModelShading = "faceted";
export const MODEL_ROUGHNESS = 0.85;

export function styleModel(material: MeshStandardNodeMaterial): void {
  material.flatShading = MODEL_SHADING === "faceted";
  material.roughnessNode = float(MODEL_ROUGHNESS);
}
