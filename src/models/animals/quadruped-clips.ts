import type { AnimalPose } from "../../world/agent-poses.ts";
import { SIDES } from "../mesh/transforms.ts";
import { cosineWave, degrees, type Keyframe, keyframes, wave } from "../rig/curves.ts";
import { type ClipTiming, type Pose, STRIDE_TIMING, seconds } from "../rig/pose.ts";
import { QUADRUPED_FIGHT_CLIPS } from "./quadruped-fight-clips.ts";
import {
  bendBone,
  GALLOP_PHASES,
  type LegPhases,
  LYING_SPREAD,
  LYING_SWING,
  moveLeg,
  stepLegs,
  WALK_PHASES,
} from "./quadruped-motion.ts";
import { LEG_ENDS, type LegEnd, QuadrupedBone, sideName } from "./quadruped-skeleton.ts";

const HOP_PHASES: LegPhases = {
  front: { left: 0.5, right: 0.58 },
  hind: { left: 0, right: 0.03 },
};

const WALKING_HOP = 0.45;
const HOP_HEIGHT = 0.1;
const GRAZING_STANCE: Readonly<Record<LegEnd, number>> = { front: degrees(4), hind: -degrees(3) };

const GRAZING_ALERT: readonly Keyframe[] = [
  [0, 0],
  [0.55, 0],
  [0.62, 1],
  [0.78, 1],
  [0.85, 0],
];

type RunKind = "amble" | "gallop" | "hop";

export interface GaitStyle {
  readonly deadHeadRoll: number;
  readonly grazeReach: number;
  readonly headBob: number;
  readonly leap: number;
  readonly lowerFlex: number;
  readonly runKind: RunKind;
  readonly runSwing: number;
  readonly tailSwish: number;
  readonly walkSwing: number;
}

export interface AnimalClipContext {
  readonly gait: GaitStyle;
  readonly variation: number;
}

export type ExtraMotion = (pose: Pose, clip: AnimalPose, phase: number) => void;

export interface AnimalClip {
  readonly apply: (pose: Pose, phase: number, context: AnimalClipContext) => void;
  readonly timing: ClipTiming;
}

export const QUADRUPED_CLIPS: Readonly<Record<AnimalPose, AnimalClip>> = {
  dead: { apply: lieDead, timing: seconds(10) },
  graze: { apply: graze, timing: seconds(9) },
  run: { apply: run, timing: STRIDE_TIMING },
  walk: { apply: walk, timing: STRIDE_TIMING },
  ...QUADRUPED_FIGHT_CLIPS,
};

function swishTail(pose: Pose, phase: number, amount: number): void {
  bendBone(pose, QuadrupedBone.Tail, degrees(10), amount * wave(phase * 2));
}

function hop(pose: Pose, phase: number, context: AnimalClipContext, effort: number): void {
  const { gait } = context;

  stepLegs(pose, phase, gait.runSwing * effort, gait.lowerFlex * (0.6 + 0.6 * effort), HOP_PHASES);
  bendBone(pose, QuadrupedBone.Pelvis, degrees(12) * effort * wave(phase, 0.1));
  bendBone(pose, QuadrupedBone.Spine, -degrees(14) * effort * wave(phase));
  bendBone(pose, QuadrupedBone.Chest, degrees(6) * effort * wave(phase, 0.2));
  bendBone(pose, QuadrupedBone.Neck, -degrees(4) + gait.headBob * wave(phase, 0.3));
  bendBone(pose, QuadrupedBone.Tail, -degrees(25) * effort);
  pose.height = HOP_HEIGHT * effort * Math.max(0, wave(phase, -0.62));
}

function walk(pose: Pose, phase: number, context: AnimalClipContext): void {
  const { gait } = context;

  if (gait.runKind === "hop") {
    hop(pose, phase, context, WALKING_HOP);

    return;
  }

  stepLegs(pose, phase, gait.walkSwing, gait.lowerFlex, WALK_PHASES);
  bendBone(pose, QuadrupedBone.Pelvis, 0, degrees(1.5) * wave(phase), degrees(2) * wave(phase));
  bendBone(pose, QuadrupedBone.Neck, gait.headBob * cosineWave(phase * 2));
  bendBone(pose, QuadrupedBone.Head, -gait.headBob * 0.5 * cosineWave(phase * 2));
  swishTail(pose, phase, gait.tailSwish * 0.4);
}

function gallop(pose: Pose, phase: number, context: AnimalClipContext): void {
  const { gait } = context;

  stepLegs(pose, phase, gait.runSwing, gait.lowerFlex * 1.4, GALLOP_PHASES);
  bendBone(pose, QuadrupedBone.Pelvis, degrees(6) * wave(phase, 0.1));
  bendBone(pose, QuadrupedBone.Spine, -degrees(8) * wave(phase));
  bendBone(pose, QuadrupedBone.Chest, degrees(5) * wave(phase, 0.2));
  bendBone(pose, QuadrupedBone.Neck, degrees(10) + degrees(8) * wave(phase, 0.3));
  bendBone(pose, QuadrupedBone.Tail, -degrees(30));
  pose.height = 0.16 * Math.max(0, wave(phase, -0.62));
}

function amble(pose: Pose, phase: number, context: AnimalClipContext): void {
  const { gait } = context;

  stepLegs(pose, phase, gait.runSwing, gait.lowerFlex * 1.25, WALK_PHASES);
  bendBone(pose, QuadrupedBone.Pelvis, degrees(2), degrees(2.5) * wave(phase), degrees(3) * wave(phase));
  bendBone(pose, QuadrupedBone.Neck, degrees(4) + gait.headBob * 1.5 * cosineWave(phase * 2));
  swishTail(pose, phase, gait.tailSwish);
}

function run(pose: Pose, phase: number, context: AnimalClipContext): void {
  if (context.gait.runKind === "hop") {
    hop(pose, phase, context, 1);

    return;
  }

  if (context.gait.runKind === "gallop") {
    gallop(pose, phase, context);

    return;
  }

  amble(pose, phase, context);
}

function graze(pose: Pose, phase: number, context: AnimalClipContext): void {
  const { gait, variation } = context;

  const alert = keyframes(phase + variation, GRAZING_ALERT);
  const chew = wave(phase * 9) * (1 - alert);

  bendBone(pose, QuadrupedBone.Neck, gait.grazeReach * (1 - alert) - degrees(8) * alert, 0, degrees(18) * alert);
  bendBone(
    pose,
    QuadrupedBone.Head,
    degrees(20) * (1 - alert) + degrees(3) * chew,
    0,
    degrees(10) * alert * wave(phase * 3)
  );
  bendBone(pose, QuadrupedBone.Chest, degrees(4) * (1 - alert));

  for (const end of LEG_ENDS) {
    for (const side of SIDES) {
      moveLeg(pose, end, side, GRAZING_STANCE[end], 0, degrees(1.5));
    }
  }

  swishTail(pose, phase * 2, gait.tailSwish);
}

function lieDead(pose: Pose, _phase: number, context: AnimalClipContext): void {
  pose.grounding = "body";
  bendBone(pose, QuadrupedBone.Pelvis, 0, degrees(88));
  bendBone(pose, QuadrupedBone.Neck, degrees(30), degrees(10));
  bendBone(pose, QuadrupedBone.Head, degrees(15), context.gait.deadHeadRoll);

  for (const end of LEG_ENDS) {
    for (const side of SIDES) {
      moveLeg(pose, end, side, LYING_SWING[end], degrees(12), LYING_SPREAD[sideName(side)]);
    }
  }
}

export function leapPerStride(gait: GaitStyle, clip: AnimalPose): number {
  if (gait.runKind !== "hop") {
    return 0;
  }

  if (clip === "walk") {
    return gait.leap * WALKING_HOP;
  }

  return clip === "run" || clip === "charge" ? gait.leap : 0;
}

export function applyAnimalClip(
  pose: Pose,
  clip: AnimalPose,
  phase: number,
  context: AnimalClipContext,
  extra: ExtraMotion | null
): void {
  pose.reset();
  QUADRUPED_CLIPS[clip].apply(pose, phase, context);

  if (extra !== null) {
    extra(pose, clip, phase);
  }
}
