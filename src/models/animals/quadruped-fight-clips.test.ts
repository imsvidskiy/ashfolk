import { Vector3 } from "three";
import { describe, expect, it, it as test } from "vitest";
import { ANIMAL_KINDS, ANIMALS, type AnimalKind } from "../../content/animals.ts";
import type { AnimalPose } from "../../world/agent-poses.ts";
import { Pose } from "../rig/pose.ts";
import { SkeletonPoser } from "../rig/skeleton-poser.ts";
import { animalAppearance } from "./animal-appearance.ts";
import { ANIMAL_SPECIES, animalBoneScales, poseAnimal } from "./animal-models.ts";
import { QuadrupedBone } from "./quadruped-skeleton.ts";

const MUZZLE_REACH = 0.3;
const FIGHTERS = ANIMAL_KINDS.filter((kind) => {
  return !ANIMALS[kind].isSmallGame;
});

function posed(kind: AnimalKind, clip: AnimalPose, phase: number): SkeletonPoser {
  const species = ANIMAL_SPECIES[kind];

  const poser = new SkeletonPoser(species.skeleton);
  const pose = new Pose(species.skeleton.bones.length);

  poseAnimal(kind, pose, clip, phase, { variation: 0.3 });
  poser.pose(pose, animalBoneScales(kind, animalAppearance({ kind, seed: 0.31, youth: 0 })));

  return poser;
}

function head(poser: SkeletonPoser): Vector3 {
  return poser.jointPosition(QuadrupedBone.Head, new Vector3());
}

function muzzle(kind: AnimalKind, poser: SkeletonPoser): Vector3 {
  const [x, y, z] = ANIMAL_SPECIES[kind].skeleton.bones[QuadrupedBone.Head].joint;

  return poser.skinPoint(QuadrupedBone.Head, new Vector3(x, y, z + MUZZLE_REACH), new Vector3());
}

describe.each(FIGHTERS)("%s fight clips", (kind) => {
  test("throws the head into the strike", () => {
    const gathering = posed(kind, "attack", 0.3);
    const striking = posed(kind, "attack", 0.5);

    expect(muzzle(kind, striking).distanceTo(muzzle(kind, gathering))).toBeGreaterThan(0.08);
  });

  test("lowers the head to charge", () => {
    const running = posed(kind, "run", 0.3);
    const charging = posed(kind, "charge", 0.3);

    expect(head(charging).y).toBeLessThan(head(running).y);
  });
});

describe.each(ANIMAL_KINDS)("%s death clips", (kind) => {
  test("collapses into the pose of the dead", () => {
    const fallen = posed(kind, "fall", 0.95);
    const dead = posed(kind, "dead", 0);

    expect(head(fallen).distanceTo(head(dead))).toBeLessThan(1e-6);
  });
});

describe("a wolf's attack", () => {
  it("lunges the head forward at its prey", () => {
    expect(head(posed("wolf", "attack", 0.5)).z).toBeGreaterThan(head(posed("wolf", "attack", 0.3)).z);
  });
});
