import { float, normalView, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

const WARMTH = vec3(1, 0.9, 0.72);
const BODY_BRIGHTENING = 0.22;
const RIM_BRIGHTENING = 0.8;
const RIM_LIGHT = 0.07;
const RIM_SHARPNESS = 2.5;

export function brightenHighlighted(color: Node<"vec3">, strength: Node<"float">): Node<"vec3"> {
  const rim = float(1).sub(normalView.z.abs()).pow(RIM_SHARPNESS).mul(strength);
  const brightening = WARMTH.mul(rim.mul(RIM_BRIGHTENING).add(strength.mul(BODY_BRIGHTENING)));

  return color.mul(vec3(1).add(brightening)).add(WARMTH.mul(rim.mul(RIM_LIGHT)));
}
