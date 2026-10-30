import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CARRIED_ITEMS, PERSON_POSES, type PersonPose } from "../../world/agent-poses.ts";
import { Pose } from "../rig/pose.ts";
import type { ContactPoint } from "../rig/skeleton.ts";
import { SkeletonPoser } from "../rig/skeleton-poser.ts";
import { measureStride } from "../rig/stride.ts";
import { ADULT, jointOf, pointOf, posedHuman } from "../testing/posed-human.ts";
import { uniformScales } from "../testing/uniform-scales.ts";
import { applyHumanClip, type HumanClipContext } from "./human-clips.ts";
import { HUMAN_SKELETON, HumanBone } from "./human-skeleton.ts";
import { RIGHT_FIST } from "./prop-placement.ts";

const RIGHT_FIST_POINT = new Vector3(...RIGHT_FIST);
const STICK_TIP = new Vector3(-0.217, 0.122, 0.038);
const PLANTED = 0.02;
const STANDING_WORK: readonly PersonPose[] = [
  "gather",
  "chop",
  "dig",
  "fish",
  "throw",
  "mine",
  "shoot",
  "thrust",
  "brawl",
  "block",
  "flinch",
];
const KNEE_CONTACT = HUMAN_SKELETON.allContacts.find((contact) => {
  return contact.bone === HumanBone.ShinRight && contact.position[1] > 0.4;
});

function footHeights(poser: SkeletonPoser): number[] {
  const point = new Vector3();

  return HUMAN_SKELETON.footContacts.map((contact) => {
    return poser.skinPoint(contact.bone, point.set(...contact.position), point).y;
  });
}

function lowestFoot(poser: SkeletonPoser): number {
  return Math.min(...footHeights(poser));
}

function contactHeight(poser: SkeletonPoser, contact: ContactPoint): number {
  return poser.skinPoint(contact.bone, new Vector3(...contact.position), new Vector3()).y;
}

function strideOf(clip: PersonPose, context: HumanClipContext): number {
  return measureStride({
    pose: new Pose(HUMAN_SKELETON.bones.length),
    poser: new SkeletonPoser(HUMAN_SKELETON),
    sample: (pose, phase) => {
      applyHumanClip(pose, clip, phase, context);
    },
    scales: uniformScales(HUMAN_SKELETON),
    skeleton: HUMAN_SKELETON,
  });
}

describe("human clips", () => {
  it("produces a finite pose for every activity, item and moment", () => {
    const pose = new Pose(HUMAN_SKELETON.bones.length);

    for (const clip of PERSON_POSES) {
      for (const carried of CARRIED_ITEMS) {
        for (const phase of [0, 0.13, 0.5, 0.77, 3.2]) {
          applyHumanClip(pose, clip, phase, { ...ADULT, carried });

          expect(
            [...pose.angles].every((angle) => {
              return Number.isFinite(angle);
            })
          ).toBe(true);
          expect(Number.isFinite(pose.height)).toBe(true);
        }
      }
    }
  });

  it("alternates the leading foot while walking", () => {
    const start = posedHuman("walk", 0);
    const half = posedHuman("walk", 0.5);

    expect(jointOf(start, HumanBone.FootLeft).z).toBeGreaterThan(jointOf(start, HumanBone.FootRight).z);
    expect(jointOf(half, HumanBone.FootRight).z).toBeGreaterThan(jointOf(half, HumanBone.FootLeft).z);
  });

  it("covers more ground per stride when running", () => {
    const walking = strideOf("walk", ADULT);
    const running = strideOf("run", ADULT);
    const elderly = strideOf("walk", { ...ADULT, ageGroup: "elder" });

    expect(walking).toBeGreaterThan(1.2);
    expect(walking).toBeLessThan(2);
    expect(running).toBeGreaterThan(walking * 1.3);
    expect(elderly).toBeLessThan(walking);
  });

  it("swings the axe from above the head down to the waist", () => {
    const windUp = posedHuman("chop", 0.2);
    const strike = posedHuman("chop", 0.55);

    expect(jointOf(windUp, HumanBone.HandRight).y).toBeGreaterThan(jointOf(windUp, HumanBone.Head).y);
    expect(jointOf(strike, HumanBone.HandRight).y).toBeLessThan(jointOf(strike, HumanBone.Chest).y);
  });

  it("brings the body down to the ground when resting", () => {
    for (const clip of ["sleep", "dead", "sit", "pray"] as const) {
      expect(jointOf(posedHuman(clip, 0.3), HumanBone.Pelvis).y).toBeLessThan(0.6);
    }

    expect(jointOf(posedHuman("idle", 0.3), HumanBone.Pelvis).y).toBeGreaterThan(0.85);
  });

  it("draws the bow string back to the face while holding the bow out toward the target", () => {
    const anchored = posedHuman("shoot", 0.5);

    const head = jointOf(anchored, HumanBone.Head);
    const drawHand = jointOf(anchored, HumanBone.HandRight);
    const bowHand = jointOf(anchored, HumanBone.HandLeft);

    expect(drawHand.distanceTo(head)).toBeLessThan(0.2);
    expect(bowHand.z - drawHand.z).toBeGreaterThan(0.5);
    expect(Math.abs(bowHand.y - drawHand.y)).toBeLessThan(0.12);
  });

  it("swings the pickaxe from over the head down to the ground", () => {
    const windUp = posedHuman("mine", 0.2);
    const strike = posedHuman("mine", 0.62);

    expect(jointOf(windUp, HumanBone.HandRight).y).toBeGreaterThan(jointOf(windUp, HumanBone.Head).y);
    expect(jointOf(strike, HumanBone.HandRight).y).toBeLessThan(1);
  });

  it("keeps both feet on the ground through standing work and fights", () => {
    for (const clip of STANDING_WORK) {
      for (let phase = 0; phase < 1; phase += 0.05) {
        const [leftHeel, leftToe, rightHeel, rightToe] = footHeights(posedHuman(clip, phase));

        expect(Math.min(leftHeel, leftToe), `${clip} ${phase} left`).toBeLessThan(PLANTED);
        expect(Math.min(rightHeel, rightToe), `${clip} ${phase} right`).toBeLessThan(PLANTED);
        expect(Math.abs(leftHeel - leftToe), `${clip} ${phase} leading foot flat`).toBeLessThan(PLANTED);
      }
    }
  });

  it("kneels on one knee to build, with the hammer stone coming down to the ground", () => {
    if (KNEE_CONTACT === undefined) {
      throw new Error("The skeleton needs a knee contact");
    }

    for (let phase = 0; phase < 1; phase += 0.05) {
      const poser = posedHuman("build", phase);
      const [leftHeel, leftToe] = footHeights(poser);

      expect(contactHeight(poser, KNEE_CONTACT), `${phase} knee`).toBeLessThan(PLANTED);
      expect(Math.max(leftHeel, leftToe), `${phase} standing foot`).toBeLessThan(PLANTED);
    }

    expect(jointOf(posedHuman("build", 0.5), HumanBone.HandRight).y).toBeGreaterThan(1);
    expect(pointOf(posedHuman("build", 0.64), HumanBone.HandRight, RIGHT_FIST_POINT).y).toBeLessThan(0.35);
  });

  it("drives the digging stick down into the ground", () => {
    const raised = posedHuman("dig", 0.2);
    const thrust = posedHuman("dig", 0.55);

    expect(pointOf(raised, HumanBone.HandRight, STICK_TIP).y).toBeGreaterThan(0.25);
    expect(pointOf(thrust, HumanBone.HandRight, STICK_TIP).y).toBeLessThan(0.05);
    expect(pointOf(raised, HumanBone.HandRight, STICK_TIP).y).toBeLessThan(
      pointOf(raised, HumanBone.HandRight, RIGHT_FIST_POINT).y - 0.5
    );
  });

  it("is in the air at the widest stride of a leap and lands as the legs pass", () => {
    expect(lowestFoot(posedHuman("leap", 0))).toBeGreaterThan(0.15);
    expect(lowestFoot(posedHuman("leap", 0.5))).toBeGreaterThan(0.15);
    expect(lowestFoot(posedHuman("leap", 0.25))).toBeLessThan(PLANTED);
    expect(lowestFoot(posedHuman("leap", 0.75))).toBeLessThan(PLANTED);
  });

  it("leaves the ground in the middle of a jump", () => {
    expect(lowestFoot(posedHuman("play", 0.48))).toBeGreaterThan(0.15);
  });
});
