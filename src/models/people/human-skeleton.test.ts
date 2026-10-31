import { describe, expect, it } from "vitest";
import { HUMAN_BONE_COUNT, HUMAN_SKELETON, HumanBone } from "./human-skeleton.ts";

describe("human skeleton", () => {
  it("numbers every bone where the skeleton lists it", () => {
    const bones = Object.entries(HumanBone);

    expect(bones).toHaveLength(HUMAN_BONE_COUNT);

    for (const [name, index] of bones) {
      expect(HUMAN_SKELETON.bones[index].name, name).toBe(name.charAt(0).toLowerCase() + name.slice(1));
    }
  });
});
