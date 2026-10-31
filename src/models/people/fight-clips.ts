import { lerp } from "../../shared/math.ts";
import type { FightPose } from "../../world/agent-poses.ts";
import { SIDES, type Side } from "../mesh/transforms.ts";
import { arc, cosineWave, degrees, type Keyframe, keyframes, wave } from "../rig/curves.ts";
import { once, type Pose, STRIDE_TIMING, seconds } from "../rig/pose.ts";
import type { HumanClip, HumanClipContext } from "./human-clips.ts";
import { bendAnkle, bendElbow, bendKnee, bendTrunk, bendWrist, moveBody, swingArm, swingLeg } from "./human-joints.ts";
import { HumanBone } from "./human-skeleton.ts";
import { bounceBody, CHARGING, cycleLegs, MARCHING, strideScale } from "./leg-cycles.ts";
import { plantFeet } from "./planted-feet.ts";

export const FIGHT_CLIPS: Readonly<Record<FightPose, HumanClip>> = {
  block: { apply: block, timing: seconds(1.2), tool: null },
  brawl: { apply: brawl, timing: seconds(0.9), tool: null },
  charge: { apply: charge, timing: STRIDE_TIMING, tool: null },
  fall: { apply: fall, timing: once(1.5), tool: null },
  flinch: { apply: flinch, timing: once(0.5), tool: null },
  march: { apply: march, timing: STRIDE_TIMING, tool: null },
  thrust: { apply: thrust, timing: seconds(1.1), tool: null },
};

const WEAPON_SIDE: Side = -1;
const GUARD_SIDE: Side = 1;
const HELD_PHASE = 0.99;

const THRUST_REACH: readonly Keyframe[] = [
  [0, 0],
  [0.28, 0],
  [0.44, -1],
  [0.54, 1],
  [0.66, 1],
  [0.86, 0],
];

const LEFT_PUNCH: readonly Keyframe[] = [
  [0, 0],
  [0.12, 1],
  [0.26, 0.1],
  [0.5, 0],
];

const RIGHT_PUNCH: readonly Keyframe[] = [
  [0, 0],
  [0.5, 0],
  [0.62, 1],
  [0.76, 0.1],
];

const FLINCH_JOLT: readonly Keyframe[] = [
  [0, 0],
  [0.18, 1],
  [0.45, 0.7],
  [HELD_PHASE, 0],
];

const FALL_DROP: readonly Keyframe[] = [
  [0, 0],
  [0.2, 0.12],
  [0.55, 0.85],
  [0.66, 1],
  [HELD_PHASE, 1],
];

const FALL_STAGGER: readonly Keyframe[] = [
  [0, 0],
  [0.16, 1],
  [0.4, 0.6],
  [0.66, 0],
  [HELD_PHASE, 0],
];

interface ArmAngles {
  readonly elbow: number;
  readonly forward: number;
  readonly outward: number;
  readonly twist: number;
  readonly wrist: number;
}

interface Stance {
  readonly bodyForward: number;
  readonly bodyTurn: number;
  readonly chestTurn: number;
  readonly guardArm: ArmAngles;
  readonly headTurn: number;
  readonly weaponArm: ArmAngles;
}

const SPEAR_GUARD: Stance = {
  bodyForward: 8,
  bodyTurn: 14,
  chestTurn: 14,
  guardArm: arm(42, -49, 2),
  headTurn: -20,
  weaponArm: arm(-52, -26, 85, 21, -15),
};

const SPEAR_DRAWN_BACK: Stance = {
  bodyForward: 6,
  bodyTurn: 18,
  chestTurn: 18,
  guardArm: arm(9, -32, 29, -73),
  headTurn: -26,
  weaponArm: arm(-49, -23, 24, 30, 39),
};

const SPEAR_LUNGE: Stance = {
  bodyForward: 20,
  bodyTurn: -2,
  chestTurn: -8,
  guardArm: arm(81, -6, 4),
  headTurn: 6,
  weaponArm: arm(4, -19, 104, -13, -89),
};

const SPEAR_LEVELED: Stance = {
  bodyForward: 12,
  bodyTurn: 0,
  chestTurn: 10,
  guardArm: arm(47, -33, 7),
  headTurn: -8,
  weaponArm: arm(-42, -9, 89, 7, -30),
};

const PARRY: Stance = {
  bodyForward: -4,
  bodyTurn: 10,
  chestTurn: 0,
  guardArm: arm(58, 8, 89, -7),
  headTurn: -10,
  weaponArm: arm(95, 82, 114, -89, -37),
};

function arm(forward: number, outward: number, elbow: number, twist = 0, wrist = 0): ArmAngles {
  return { elbow, forward, outward, twist, wrist };
}

function mixAngles(from: ArmAngles, to: ArmAngles, amount: number): ArmAngles {
  return {
    elbow: lerp(from.elbow, to.elbow, amount),
    forward: lerp(from.forward, to.forward, amount),
    outward: lerp(from.outward, to.outward, amount),
    twist: lerp(from.twist, to.twist, amount),
    wrist: lerp(from.wrist, to.wrist, amount),
  };
}

function mixStances(from: Stance, to: Stance, amount: number): Stance {
  return {
    bodyForward: lerp(from.bodyForward, to.bodyForward, amount),
    bodyTurn: lerp(from.bodyTurn, to.bodyTurn, amount),
    chestTurn: lerp(from.chestTurn, to.chestTurn, amount),
    guardArm: mixAngles(from.guardArm, to.guardArm, amount),
    headTurn: lerp(from.headTurn, to.headTurn, amount),
    weaponArm: mixAngles(from.weaponArm, to.weaponArm, amount),
  };
}

function poseArm(pose: Pose, side: Side, angles: ArmAngles): void {
  swingArm(pose, side, {
    forward: degrees(angles.forward),
    outward: degrees(angles.outward),
    twist: degrees(angles.twist),
  });
  bendElbow(pose, side, degrees(angles.elbow));
  bendWrist(pose, side, degrees(angles.wrist));
}

function poseUpperBody(pose: Pose, stance: Stance): void {
  moveBody(pose, { forward: degrees(stance.bodyForward), turnLeft: degrees(stance.bodyTurn) });
  bendTrunk(pose, HumanBone.Chest, { turnLeft: degrees(stance.chestTurn) });
  bendTrunk(pose, HumanBone.Head, { forward: -degrees(4), turnLeft: degrees(stance.headTurn) });
  poseArm(pose, GUARD_SIDE, stance.guardArm);
  poseArm(pose, WEAPON_SIDE, stance.weaponArm);
}

function fightingLegs(pose: Pose, crouch: number, lunge: number): void {
  swingLeg(pose, GUARD_SIDE, { forward: degrees(26) + degrees(18) * lunge, outward: degrees(10) });
  bendKnee(pose, GUARD_SIDE, degrees(22) + degrees(26) * crouch + degrees(22) * lunge);
  bendAnkle(pose, GUARD_SIDE, degrees(8) * lunge);
  swingLeg(pose, WEAPON_SIDE, { forward: -degrees(18) - degrees(14) * lunge, outward: degrees(9) });
  bendKnee(pose, WEAPON_SIDE, degrees(14) + degrees(22) * crouch - degrees(8) * lunge);
  bendAnkle(pose, WEAPON_SIDE, -degrees(10) - degrees(10) * lunge);
}

function march(pose: Pose, phase: number, context: HumanClipContext): void {
  const swing = cosineWave(phase);
  const { armSwing } = context.motion;

  cycleLegs(pose, phase, strideScale(context, context.motion.stride), MARCHING);
  moveBody(pose, { forward: degrees(3), toLeft: degrees(2) * wave(phase), turnLeft: -degrees(4) * swing });
  bendTrunk(pose, HumanBone.Spine, { forward: degrees(2), turnLeft: degrees(4) * swing });
  bendTrunk(pose, HumanBone.Chest, { forward: -degrees(3), turnLeft: degrees(3) * swing });
  bendTrunk(pose, HumanBone.Head, { forward: -degrees(4) + degrees(2) * cosineWave(phase * 2) });
  poseArm(pose, WEAPON_SIDE, arm(34 + 4 * swing, 14, 74, 0, -6));
  poseArm(pose, GUARD_SIDE, arm(4 - 22 * swing * armSwing, 8, 16 + 18 * Math.max(0, -swing)));
}

function charge(pose: Pose, phase: number, context: HumanClipContext): void {
  const swing = cosineWave(phase);

  cycleLegs(pose, phase, strideScale(context, context.motion.stride), CHARGING);
  poseUpperBody(pose, SPEAR_LEVELED);
  moveBody(pose, { turnLeft: -degrees(5) * swing });
  bendTrunk(pose, HumanBone.Spine, { forward: degrees(4), turnLeft: degrees(4) * swing });
  bounceBody(pose, phase);
}

function spearStance(reach: number): Stance {
  if (reach >= 0) {
    return mixStances(SPEAR_GUARD, SPEAR_LUNGE, reach);
  }

  return mixStances(SPEAR_GUARD, SPEAR_DRAWN_BACK, -reach);
}

function thrust(pose: Pose, phase: number): void {
  const reach = keyframes(phase, THRUST_REACH);
  const lunge = Math.max(0, reach);

  fightingLegs(pose, 0.5, lunge);
  poseUpperBody(pose, spearStance(reach));
  bendTrunk(pose, HumanBone.Spine, { forward: degrees(6) * lunge });

  plantFeet(pose);
}

function punchingArm(pose: Pose, side: Side, punch: number): void {
  swingArm(pose, side, { forward: degrees(52) + degrees(38) * punch, outward: -degrees(12) });
  bendElbow(pose, side, degrees(118) - degrees(100) * punch);
}

function brawl(pose: Pose, phase: number): void {
  const left = keyframes(phase, LEFT_PUNCH);
  const right = keyframes(phase, RIGHT_PUNCH);
  const twist = left - right;

  fightingLegs(pose, 0.6, Math.max(left, right) * 0.6);
  moveBody(pose, { forward: degrees(10), turnLeft: degrees(14) * twist });
  bendTrunk(pose, HumanBone.Chest, { forward: degrees(6), turnLeft: -degrees(18) * twist });
  bendTrunk(pose, HumanBone.Head, { forward: -degrees(12), turnLeft: degrees(14) * twist });
  punchingArm(pose, GUARD_SIDE, left);
  punchingArm(pose, WEAPON_SIDE, right);

  plantFeet(pose);
}

function block(pose: Pose, phase: number): void {
  const brace = wave(phase * 2);

  fightingLegs(pose, 0.8, 0);
  poseUpperBody(pose, PARRY);
  bendTrunk(pose, HumanBone.Spine, { forward: -degrees(5) - degrees(2) * brace });

  plantFeet(pose);
}

function flinch(pose: Pose, phase: number): void {
  const jolt = keyframes(Math.min(phase, HELD_PHASE), FLINCH_JOLT);

  fightingLegs(pose, 0.3 + 0.5 * jolt, 0);
  moveBody(pose, { forward: -degrees(10) * jolt, toLeft: degrees(5) * jolt, turnLeft: degrees(14) * jolt });
  bendTrunk(pose, HumanBone.Spine, { forward: -degrees(8) * jolt });
  bendTrunk(pose, HumanBone.Chest, { forward: -degrees(12) * jolt, turnLeft: -degrees(16) * jolt });
  bendTrunk(pose, HumanBone.Head, { forward: -degrees(20) * jolt, toLeft: degrees(10) * jolt });

  for (const side of SIDES) {
    swingArm(pose, side, { forward: degrees(20) + degrees(30) * jolt, outward: degrees(18) + degrees(26) * jolt });
    bendElbow(pose, side, degrees(30) + degrees(40) * jolt);
  }

  plantFeet(pose);
}

function fall(pose: Pose, phase: number): void {
  const progress = Math.min(phase, HELD_PHASE);
  const drop = keyframes(progress, FALL_DROP);
  const stagger = keyframes(progress, FALL_STAGGER);
  const bounce = arc(progress, 0.62, 0.12) * 0.12;
  const standing = 1 - drop;

  pose.grounding = "body";
  moveBody(pose, { forward: -degrees(90) * drop + degrees(6) * bounce, turnLeft: degrees(10) * stagger });
  bendTrunk(pose, HumanBone.Spine, { forward: degrees(18) * stagger * standing });
  bendTrunk(pose, HumanBone.Chest, { forward: degrees(10) * stagger * standing });
  bendTrunk(pose, HumanBone.Head, {
    forward: degrees(26) * stagger - degrees(10) * drop,
    turnLeft: degrees(28) * drop,
  });

  for (const side of SIDES) {
    swingArm(pose, side, {
      forward: degrees(40) * stagger + degrees(10) * drop,
      outward: degrees(14) + degrees(38) * drop + degrees(12) * stagger,
    });
    bendElbow(pose, side, degrees(40) * stagger + degrees(22) * drop);
    swingLeg(pose, side, {
      forward: degrees(30) * stagger * standing + degrees(4) * side * stagger,
      outward: degrees(11) * drop,
    });
    bendKnee(pose, side, degrees(70) * stagger * standing + degrees(10) * drop);
    bendAnkle(pose, side, -degrees(30) * drop);
  }
}
