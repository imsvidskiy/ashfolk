import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { SIDES } from "../mesh/transforms.ts";
import { degrees } from "../rig/curves.ts";
import { Pose } from "../rig/pose.ts";
import { SkeletonPoser } from "../rig/skeleton-poser.ts";
import { uniformScales } from "../testing/uniform-scales.ts";
import { bendElbow, bendKnee, moveBody, swingArm, swingLeg } from "./human-joints.ts";
import { HUMAN_BONE_COUNT, HUMAN_SKELETON, HumanBone, sideBones } from "./human-skeleton.ts";

function jointAfter(move: (pose: Pose) => void, bone: number): Vector3 {
  const pose = new Pose(HUMAN_BONE_COUNT);
  const poser = new SkeletonPoser(HUMAN_SKELETON);

  move(pose);
  poser.pose(pose, uniformScales(HUMAN_SKELETON));

  return poser.jointPosition(bone, new Vector3());
}

describe("human joints", () => {
  it("swings arms and legs forward and out to their own side", () => {
    for (const side of SIDES) {
      const { foot, hand } = sideBones(side);

      const armForward = jointAfter((pose) => {
        swingArm(pose, side, { forward: degrees(60) });
      }, hand);
      const armOutward = jointAfter((pose) => {
        swingArm(pose, side, { outward: degrees(40) });
      }, hand);
      const legForward = jointAfter((pose) => {
        swingLeg(pose, side, { forward: degrees(40) });
      }, foot);
      const legOutward = jointAfter((pose) => {
        swingLeg(pose, side, { outward: degrees(20) });
      }, foot);

      expect(armForward.z, `${side}`).toBeGreaterThan(0.3);
      expect(legForward.z, `${side}`).toBeGreaterThan(0.3);
      expect(armOutward.x * side, `${side}`).toBeGreaterThan(0.4);
      expect(legOutward.x * side, `${side}`).toBeGreaterThan(0.2);
    }
  });

  it("bends elbows forward and knees back", () => {
    for (const side of SIDES) {
      const { foot, hand } = sideBones(side);

      const bentArm = jointAfter((pose) => {
        bendElbow(pose, side, degrees(90));
      }, hand);
      const bentLeg = jointAfter((pose) => {
        bendKnee(pose, side, degrees(60));
      }, foot);

      expect(bentArm.z, `${side}`).toBeGreaterThan(0.2);
      expect(bentLeg.z, `${side}`).toBeLessThan(-0.2);
    }
  });

  it("leans the body forward and to the left and turns it to the left", () => {
    const leaning = jointAfter((pose) => {
      moveBody(pose, { forward: degrees(30) });
    }, HumanBone.Head);
    const tilted = jointAfter((pose) => {
      moveBody(pose, { toLeft: degrees(20) });
    }, HumanBone.Head);
    const turned = jointAfter((pose) => {
      moveBody(pose, { turnLeft: degrees(30) });
    }, HumanBone.HandLeft);

    expect(leaning.z).toBeGreaterThan(0.2);
    expect(tilted.x).toBeGreaterThan(0.15);
    expect(turned.z).toBeLessThan(-0.05);
  });
});
