import { SIDES } from "../mesh/transforms.ts";
import { cosineWave, degrees, pulse, wave } from "../rig/curves.ts";
import type { Pose } from "../rig/pose.ts";
import { bendAnkle, bendKnee, swingLeg } from "./human-joints.ts";

const BOUNCE_HEIGHT = 0.05;
const BOUNCE_LAG = 0.05;

interface StepTiming {
  readonly heelToes: number;
  readonly liftWidth: number;
  readonly pushOffCenter: number;
  readonly pushOffToes: number;
  readonly pushOffWidth: number;
  readonly reachCenter: number;
  readonly reachWidth: number;
  readonly swingToes: number;
}

const WALK_STEP: StepTiming = {
  heelToes: 8,
  liftWidth: 0.07,
  pushOffCenter: 0.56,
  pushOffToes: 16,
  pushOffWidth: 0.07,
  reachCenter: 0.7,
  reachWidth: 0.13,
  swingToes: 10,
};

const RUN_STEP: StepTiming = {
  heelToes: 10,
  liftWidth: 0.08,
  pushOffCenter: 0.5,
  pushOffToes: 26,
  pushOffWidth: 0.08,
  reachCenter: 0.66,
  reachWidth: 0.15,
  swingToes: 14,
};

interface LegCycle {
  readonly knee: number;
  readonly lean: number;
  readonly lift: number;
  readonly outward: number;
  readonly reach: number;
  readonly swing: number;
  readonly timing: StepTiming;
}

export const WALKING: LegCycle = { knee: 5, lean: 5, lift: 15, outward: 2, reach: 62, swing: 25, timing: WALK_STEP };
export const MARCHING: LegCycle = { knee: 8, lean: 6, lift: 18, outward: 3, reach: 66, swing: 27, timing: WALK_STEP };
export const RUNNING: LegCycle = { knee: 18, lean: 14, lift: 22, outward: 2, reach: 92, swing: 44, timing: RUN_STEP };
export const CHARGING: LegCycle = { knee: 20, lean: 16, lift: 22, outward: 3, reach: 92, swing: 44, timing: RUN_STEP };

export function cycleLegs(pose: Pose, phase: number, stride: number, cycle: LegCycle): void {
  const { knee, lean, lift, outward, reach, swing, timing } = cycle;
  const { heelToes, liftWidth, pushOffCenter, pushOffToes, pushOffWidth, reachCenter, reachWidth, swingToes } = timing;

  for (const side of SIDES) {
    const step = side === 1 ? phase : phase + 0.5;
    const forward = degrees(lean) + degrees(swing) * stride * cosineWave(step);
    const toesUp = degrees(
      heelToes * pulse(step, 0, 0.08) -
        pushOffToes * pulse(step, pushOffCenter, pushOffWidth) +
        swingToes * pulse(step, 0.76, 0.1)
    );

    swingLeg(pose, side, { forward, outward: degrees(outward) });
    bendKnee(
      pose,
      side,
      degrees(knee + lift * pulse(step, 0.1, liftWidth) + reach * stride * pulse(step, reachCenter, reachWidth))
    );
    bendAnkle(pose, side, toesUp);
  }
}

export function bounceBody(pose: Pose, phase: number): void {
  pose.height = BOUNCE_HEIGHT * Math.max(0, wave(phase * 2, -BOUNCE_LAG));
}
