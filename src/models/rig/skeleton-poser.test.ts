import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { HUMAN_SKELETON, HumanBone } from "../people/human-skeleton.ts";
import { uniformScales } from "../testing/uniform-scales.ts";
import { degrees } from "./curves.ts";
import { Pose } from "./pose.ts";
import { contactsFor, type Grounding, NO_PARENT } from "./skeleton.ts";
import { boneRotation, PALETTE_FLOATS_PER_BONE, SkeletonPoser } from "./skeleton-poser.ts";

const IDENTITY_ROWS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const PITCH = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3);
const ROLL = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.5);
const YAW = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7);
const UNIT_SCALE = new Vector3(1, 1, 1);
const UNIT_STEPS = [new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];

function lowestContact(poser: SkeletonPoser, grounding: Grounding): number {
  const point = new Vector3();

  return Math.min(
    ...contactsFor(HUMAN_SKELETON, grounding).map((contact) => {
      return poser.skinPoint(contact.bone, point.set(...contact.position), point).y;
    })
  );
}

function scaledTo(factor: number): Float32Array {
  return uniformScales(HUMAN_SKELETON).map((scale) => {
    return scale * factor;
  });
}

function unevenScales(): Float32Array {
  return uniformScales(HUMAN_SKELETON).map((_, index) => {
    return 0.8 + 0.15 * (index % 3) + 0.05 * (Math.floor(index / 3) % 4);
  });
}

function bentPose(): Pose {
  const pose = new Pose(HUMAN_SKELETON.bones.length);

  for (let bone = 0; bone < HUMAN_SKELETON.bones.length; bone += 1) {
    pose.rotate(bone, degrees(13 * ((bone % 3) - 1)), degrees(7 * ((bone % 4) - 1.5)), degrees(5 * (bone % 2)));
  }

  return pose;
}

function scaledOffset(scales: Float32Array, bone: number): Vector3 {
  const { joint, parent } = HUMAN_SKELETON.bones[bone];

  if (parent === NO_PARENT) {
    return new Vector3(...joint);
  }

  const parentJoint = new Vector3(...HUMAN_SKELETON.bones[parent].joint);

  return new Vector3(...joint).sub(parentJoint).multiply(new Vector3().fromArray(scales, parent * 3));
}

function threeSkins(pose: Pose, scales: Float32Array, lift: number): Matrix4[] {
  const lifted = new Matrix4().makeTranslation(0, lift, 0);
  const worlds: Matrix4[] = [];

  return HUMAN_SKELETON.bones.map((bone, index) => {
    const rotation = boneRotation(pose.angles, index, bone.order === "limb", new Quaternion());
    const parentWorld = bone.parent === NO_PARENT ? lifted : worlds[bone.parent];
    const world = new Matrix4().compose(scaledOffset(scales, index), rotation, UNIT_SCALE).premultiply(parentWorld);
    const scale = new Matrix4().makeScale(scales[index * 3], scales[index * 3 + 1], scales[index * 3 + 2]);
    const toJoint = new Matrix4().makeTranslation(new Vector3(...bone.joint).negate());

    worlds.push(world);

    return new Matrix4().multiplyMatrices(world, scale).multiply(toJoint);
  });
}

describe("bone rotation", () => {
  it("turns a limb by its pitch first and the trunk by its roll first", () => {
    const angles = new Float32Array([0.3, -0.5, 0.7]);

    const limb = boneRotation(angles, 0, true, new Quaternion());
    const trunk = boneRotation(angles, 0, false, new Quaternion());

    expect(limb.angleTo(PITCH.clone().multiply(ROLL).multiply(YAW))).toBeLessThan(1e-6);
    expect(trunk.angleTo(ROLL.clone().multiply(PITCH).multiply(YAW))).toBeLessThan(1e-6);
  });

  it("leaves out the turns a bone does not make", () => {
    const pitchOnly = new Float32Array([0.3, 0, 0]);
    const yawOnly = new Float32Array([0, 0, 0.7]);

    expect(boneRotation(pitchOnly, 0, true, new Quaternion()).angleTo(PITCH)).toBeLessThan(1e-6);
    expect(boneRotation(yawOnly, 0, false, new Quaternion()).angleTo(YAW)).toBeLessThan(1e-6);
    expect(boneRotation(new Float32Array(3), 0, true, new Quaternion()).angleTo(new Quaternion())).toBe(0);
  });
});

describe("skeleton poser", () => {
  it("leaves the rest pose untouched", () => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);
    const palette = new Float32Array(HUMAN_SKELETON.bones.length * PALETTE_FLOATS_PER_BONE);

    poser.pose(new Pose(HUMAN_SKELETON.bones.length), uniformScales(HUMAN_SKELETON));
    poser.writePalette(palette, 0);

    for (let bone = 0; bone < HUMAN_SKELETON.bones.length; bone += 1) {
      const rows = palette.subarray(bone * PALETTE_FLOATS_PER_BONE, (bone + 1) * PALETTE_FLOATS_PER_BONE);

      expect(
        [...rows].map((value) => {
          return Math.round(value * 1e5) / 1e5 + 0;
        })
      ).toEqual(IDENTITY_ROWS);
    }
  });

  it("keeps every child joint attached to its parent", () => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);

    poser.pose(bentPose(), unevenScales());

    for (const [bone, definition] of HUMAN_SKELETON.bones.entries()) {
      if (definition.parent === NO_PARENT) {
        continue;
      }

      const joint = poser.jointPosition(bone, new Vector3());
      const attached = poser.skinPoint(definition.parent, new Vector3(...definition.joint), new Vector3());

      expect(joint.distanceTo(attached)).toBeLessThan(1e-5);
    }
  });

  it("skins every bone as its world turn times its scale around the joint", () => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);
    const pose = bentPose();
    const scales = unevenScales();
    const pelvisJoint = HUMAN_SKELETON.bones[HumanBone.Pelvis].joint;

    poser.pose(pose, scales);

    const lift = poser.jointPosition(HumanBone.Pelvis, new Vector3()).y - pelvisJoint[1];
    const skins = threeSkins(pose, scales, lift);

    for (const [bone, definition] of HUMAN_SKELETON.bones.entries()) {
      for (const step of UNIT_STEPS) {
        const point = new Vector3(...definition.joint).add(step);

        const skinned = poser.skinPoint(bone, point, new Vector3());
        const expected = point.clone().applyMatrix4(skins[bone]);

        expect(skinned.distanceTo(expected), `${definition.name} ${step.toArray()}`).toBeLessThan(1e-6);
      }
    }
  });

  it("stands on the ground whatever the size of the body", () => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);
    const pose = new Pose(HUMAN_SKELETON.bones.length);
    const top = new Vector3();

    for (const factor of [0.5, 1, 1.3]) {
      poser.pose(pose, scaledTo(factor));
      poser.skinPoint(HumanBone.Head, new Vector3(0, 1.75, 0), top);

      expect(lowestContact(poser, "feet")).toBeCloseTo(0, 5);
      expect(top.y).toBeCloseTo(1.75 * factor, 2);
    }
  });

  it("lifts the body above the ground by the pose height", () => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);
    const pose = new Pose(HUMAN_SKELETON.bones.length);

    pose.height = 0.3;
    poser.pose(pose, uniformScales(HUMAN_SKELETON));

    expect(lowestContact(poser, "feet")).toBeCloseTo(0.3, 5);
  });

  it("rests a lying body on its lowest body contact", () => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);
    const pose = new Pose(HUMAN_SKELETON.bones.length);

    pose.grounding = "body";
    pose.height = 0.1;
    pose.rotate(HumanBone.Pelvis, -degrees(90), 0, 0);
    poser.pose(pose, uniformScales(HUMAN_SKELETON));

    expect(lowestContact(poser, "body")).toBeCloseTo(0.1, 5);
  });

  it("bends limbs away from the midline whatever their swing", () => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);
    const pose = new Pose(HUMAN_SKELETON.bones.length);
    const hand = new Vector3();

    pose.rotate(HumanBone.UpperArmLeft, -degrees(170), -degrees(20), 0);
    poser.pose(pose, uniformScales(HUMAN_SKELETON));
    poser.jointPosition(HumanBone.HandLeft, hand);

    expect(hand.y).toBeGreaterThan(1.9);
    expect(hand.x).toBeLessThan(0.19);
  });
});
