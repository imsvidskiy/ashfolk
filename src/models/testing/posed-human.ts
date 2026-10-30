import { Vector3 } from "three";
import type { PersonPose } from "../../world/agent-poses.ts";
import { type MeshData, mergeMeshes } from "../mesh/mesh-data.ts";
import type { TribeLook } from "../people/appearance.ts";
import { applyHumanClip, type HumanClipContext } from "../people/human-clips.ts";
import { type HumanPart, humanPartIndex } from "../people/human-model.ts";
import { HUMAN_SKELETON } from "../people/human-skeleton.ts";
import { Pose } from "../rig/pose.ts";
import { SkeletonPoser } from "../rig/skeleton-poser.ts";
import { uniformScales } from "./uniform-scales.ts";

export const ADULT: HumanClipContext = {
  ageGroup: "adult",
  carried: "nothing",
  motion: { armSwing: 1, posture: 0, stride: 1 },
};

export const TRIBE: TribeLook = { accent: 0x33_66_99, fur: 0x55_44_33, id: 2 };

export function posedHuman(clip: PersonPose, phase: number): SkeletonPoser {
  const poser = new SkeletonPoser(HUMAN_SKELETON);
  const pose = new Pose(HUMAN_SKELETON.bones.length);

  applyHumanClip(pose, clip, phase, ADULT);
  poser.pose(pose, uniformScales(HUMAN_SKELETON));

  return poser;
}

export function pointOf(poser: SkeletonPoser, bone: number, rest: Vector3): Vector3 {
  return poser.skinPoint(bone, rest, new Vector3());
}

export function jointOf(poser: SkeletonPoser, bone: number): Vector3 {
  return poser.jointPosition(bone, new Vector3());
}

export function humanPartsMesh(parts: readonly MeshData[], names: readonly HumanPart[]): MeshData {
  return mergeMeshes(
    names.map((name) => {
      return parts[humanPartIndex(name)];
    })
  );
}
