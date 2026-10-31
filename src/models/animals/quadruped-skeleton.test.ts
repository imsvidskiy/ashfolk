import { describe, expect, it } from "vitest";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import type { BoneDefinition } from "../rig/skeleton.ts";
import { DEER_FRAME } from "./deer-model.ts";
import { HARE_FRAME } from "./hare-model.ts";
import { IBEX_FRAME } from "./ibex-model.ts";
import { MAMMOTH_FRAME } from "./mammoth-model.ts";
import { createQuadrupedSkeleton, FIRST_EXTRA_BONE, QuadrupedBone, type QuadrupedFrame } from "./quadruped-skeleton.ts";
import { WOLF_FRAME } from "./wolf-model.ts";

const FRAMES: Readonly<Record<AnimalKind, QuadrupedFrame>> = {
  deer: DEER_FRAME,
  hare: HARE_FRAME,
  ibex: IBEX_FRAME,
  mammoth: MAMMOTH_FRAME,
  wolf: WOLF_FRAME,
};

const BONE_NAMES = Object.entries(QuadrupedBone)
  .sort(([, first], [, second]) => {
    return first - second;
  })
  .map(([name]) => {
    return name.charAt(0).toLowerCase() + name.slice(1);
  });

function namesOf(bones: readonly BoneDefinition[]): string[] {
  return bones.map((bone) => {
    return bone.name;
  });
}

describe("quadruped skeleton", () => {
  it.each(ANIMAL_KINDS)("numbers every shared bone of a %s where its skeleton puts it", (kind) => {
    const { bones } = createQuadrupedSkeleton(FRAMES[kind]);

    expect(namesOf(bones.slice(0, FIRST_EXTRA_BONE))).toEqual(BONE_NAMES);
  });

  it.each(ANIMAL_KINDS)("starts the extra bones of a %s right after the shared ones", (kind) => {
    const { bones } = createQuadrupedSkeleton(FRAMES[kind]);

    expect(namesOf(bones.slice(FIRST_EXTRA_BONE))).toEqual(namesOf(FRAMES[kind].extraBones));
  });
});
