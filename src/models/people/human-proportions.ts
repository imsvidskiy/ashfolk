import { SIDES } from "../mesh/transforms.ts";
import type { BodyShape } from "./appearance.ts";
import { HUMAN_BONE_COUNT, HumanBone, sideBones } from "./human-skeleton.ts";

export const FIGURE_SCALE = 1.18;

const STYLIZED_HEAD = 1.35;
const STYLIZED_TRUNK = 1.1;
const STYLIZED_ARMS = 1.25;
const STYLIZED_LEGS = 1.05;

function setScale(scales: Float32Array, bone: number, x: number, y: number, z: number): void {
  scales[bone * 3] = x * FIGURE_SCALE;
  scales[bone * 3 + 1] = y * FIGURE_SCALE;
  scales[bone * 3 + 2] = z * FIGURE_SCALE;
}

export function humanBoneScales(body: BodyShape): Float32Array {
  const { build, headSize, height, hipWidth, legLength, shoulderWidth } = body;

  const scales = new Float32Array(HUMAN_BONE_COUNT * 3);
  const girth = build ** 0.6 * STYLIZED_TRUNK;
  const limbGirth = build ** 0.5 * STYLIZED_ARMS;
  const forearmGirth = build ** 0.4 * STYLIZED_ARMS;
  const thighGirth = build ** 0.6 * STYLIZED_LEGS;
  const shinGirth = build ** 0.45 * STYLIZED_LEGS;
  const head = height * headSize * STYLIZED_HEAD;

  setScale(scales, HumanBone.Pelvis, height * hipWidth * girth, height, height * build ** 0.8);
  setScale(scales, HumanBone.Spine, height * ((hipWidth + shoulderWidth) / 2) * girth, height, height * build ** 0.9);
  setScale(scales, HumanBone.Chest, height * shoulderWidth * girth, height, height * build ** 0.7);
  setScale(scales, HumanBone.Neck, height * build ** 0.3, height, height * build ** 0.3);
  setScale(scales, HumanBone.Head, head, head, head);

  for (const side of SIDES) {
    const bones = sideBones(side);

    setScale(scales, bones.upperArm, height * limbGirth, height, height * limbGirth);
    setScale(scales, bones.forearm, height * forearmGirth, height, height * forearmGirth);
    setScale(scales, bones.hand, height * (0.92 + 0.08 * build), height, height * (0.92 + 0.08 * build));
    setScale(scales, bones.thigh, height * thighGirth, height * legLength, height * thighGirth);
    setScale(scales, bones.shin, height * shinGirth, height * legLength, height * shinGirth);
    setScale(scales, bones.foot, height * build ** 0.3, height, height * legLength ** 0.5);
  }

  return scales;
}
