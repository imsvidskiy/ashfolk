import { Quaternion, Vector3 } from "three";
import { onSide, type Side, type Triple } from "../mesh/transforms.ts";
import { degrees } from "../rig/curves.ts";
import { ANGLES_PER_BONE, type Pose, RotationAxis } from "../rig/pose.ts";
import { boneRotation } from "../rig/skeleton-poser.ts";
import { HUMAN_SKELETON, HumanBone, HumanJoint, otherSide, sideBones } from "./human-skeleton.ts";

const SOLVER_STEPS = 16;
const DEEPEST_KNEE = degrees(150);
const STEEPEST_BALL_OF_FOOT = degrees(40);
const WIDEST_STEP_BACK = degrees(30);
const FRONT_SIDE: Side = 1;
const BACK_SIDE = otherSide(FRONT_SIDE);
const pelvisRotation = new Quaternion();
const thighRotation = new Quaternion();
const shinRotation = new Quaternion();
const footRotation = new Quaternion();
const point = new Vector3();

interface LegChain {
  readonly ankle: Vector3;
  readonly contacts: readonly Vector3[];
  readonly hip: Vector3;
  readonly knee: Vector3;
}

const LEFT_LEG = legChain(1);
const RIGHT_LEG = legChain(-1);

function angleOf(pose: Pose, bone: number, axis: number): number {
  return pose.angles[bone * ANGLES_PER_BONE + axis];
}

function between(from: Triple, to: Triple): Vector3 {
  return new Vector3(...to).sub(new Vector3(...from));
}

function legChain(side: Side): LegChain {
  const { foot } = sideBones(side);

  const hip = onSide(HumanJoint.Hip, side);
  const knee = onSide(HumanJoint.Knee, side);
  const ankle = onSide(HumanJoint.Ankle, side);

  return {
    ankle: between(knee, ankle),
    contacts: HUMAN_SKELETON.footContacts
      .filter((contact) => {
        return contact.bone === foot;
      })
      .map((contact) => {
        return between(ankle, contact.position);
      }),
    hip: between(HumanJoint.Pelvis, hip),
    knee: between(hip, knee),
  };
}

function rotateUpperLeg(pose: Pose, side: Side): void {
  boneRotation(pose.angles, HumanBone.Pelvis, false, pelvisRotation);
  boneRotation(pose.angles, sideBones(side).thigh, true, thighRotation);
}

function lowestContact(pose: Pose, side: Side): number {
  rotateUpperLeg(pose, side);

  return lowestBelowThigh(pose, side);
}

function lowestBelowThigh(pose: Pose, side: Side): number {
  const bones = sideBones(side);
  const chain = side === 1 ? LEFT_LEG : RIGHT_LEG;

  boneRotation(pose.angles, bones.shin, true, shinRotation);
  boneRotation(pose.angles, bones.foot, true, footRotation);

  let lowest = Number.POSITIVE_INFINITY;

  for (const contact of chain.contacts) {
    point
      .copy(contact)
      .applyQuaternion(footRotation)
      .add(chain.ankle)
      .applyQuaternion(shinRotation)
      .add(chain.knee)
      .applyQuaternion(thighRotation)
      .add(chain.hip)
      .applyQuaternion(pelvisRotation);
    lowest = Math.min(lowest, point.y);
  }

  return lowest;
}

function setPitch(pose: Pose, bone: number, angle: number): void {
  pose.rotate(bone, angle - angleOf(pose, bone, RotationAxis.Pitch), 0, 0);
}

function shinPitch(pose: Pose, side: Side): number {
  const { shin, thigh } = sideBones(side);

  return (
    angleOf(pose, HumanBone.Pelvis, RotationAxis.Pitch) +
    angleOf(pose, thigh, RotationAxis.Pitch) +
    angleOf(pose, shin, RotationAxis.Pitch)
  );
}

function footTilt(pose: Pose, side: Side): number {
  const { foot } = sideBones(side);

  const toesDown = shinPitch(pose, side) + angleOf(pose, foot, RotationAxis.Pitch);

  return Math.min(Math.max(toesDown, 0), STEEPEST_BALL_OF_FOOT);
}

function limitStepBack(pose: Pose, side: Side): void {
  const { thigh } = sideBones(side);

  const pelvis = angleOf(pose, HumanBone.Pelvis, RotationAxis.Pitch);

  setPitch(pose, thigh, Math.min(pelvis + angleOf(pose, thigh, RotationAxis.Pitch), WIDEST_STEP_BACK) - pelvis);
}

function bendLeg(pose: Pose, side: Side, knee: number, tilt: number): void {
  const { foot, shin } = sideBones(side);

  setPitch(pose, shin, knee);
  setPitch(pose, foot, tilt - shinPitch(pose, side));
}

function reachDown(pose: Pose, side: Side, target: number, tilt: number): void {
  const { thigh } = sideBones(side);

  let straighter = Math.max(
    0,
    -angleOf(pose, HumanBone.Pelvis, RotationAxis.Pitch) - angleOf(pose, thigh, RotationAxis.Pitch)
  );
  let deeper = Math.max(straighter, DEEPEST_KNEE);

  rotateUpperLeg(pose, side);

  for (let step = 0; step < SOLVER_STEPS; step += 1) {
    const middle = (straighter + deeper) / 2;

    bendLeg(pose, side, middle, tilt);

    if (lowestBelowThigh(pose, side) > target) {
      deeper = middle;
    } else {
      straighter = middle;
    }
  }

  bendLeg(pose, side, (straighter + deeper) / 2, tilt);
}

export function plantFeet(pose: Pose): void {
  limitStepBack(pose, BACK_SIDE);

  const backTilt = footTilt(pose, BACK_SIDE);

  bendLeg(pose, BACK_SIDE, angleOf(pose, sideBones(BACK_SIDE).shin, RotationAxis.Pitch), backTilt);

  const backLowest = lowestContact(pose, BACK_SIDE);

  reachDown(pose, FRONT_SIDE, backLowest, 0);

  const frontLowest = lowestContact(pose, FRONT_SIDE);

  if (frontLowest > backLowest) {
    reachDown(pose, BACK_SIDE, frontLowest, backTilt);
  }
}
