import { describe, expect, it } from "vitest";
import { ANIMAL_KINDS } from "../../content/animals.ts";
import { ANIMAL_SPECIES } from "./animal-models.ts";
import { FIRST_EXTRA_BONE, QuadrupedBone } from "./quadruped-skeleton.ts";

const BONE_NAMES = Object.entries(QuadrupedBone)
  .sort(([, first], [, second]) => {
    return first - second;
  })
  .map(([name]) => {
    return name.charAt(0).toLowerCase() + name.slice(1);
  });

describe("quadruped skeleton", () => {
  it.each(ANIMAL_KINDS)("numbers every shared bone of a %s where its skeleton puts it", (kind) => {
    const { bones } = ANIMAL_SPECIES[kind].skeleton;

    expect(
      bones.slice(0, FIRST_EXTRA_BONE).map((bone) => {
        return bone.name;
      })
    ).toEqual(BONE_NAMES);
  });
});
