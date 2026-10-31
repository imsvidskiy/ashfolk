import { clamp, lerp, smoothstep } from "../shared/math.ts";
import { type GrabbableKind, type GrabTarget, type HeldView, isTarget } from "../simulation/hand/grab-target.ts";

export const HELD_LIFT = 4;
export const LIFT_SECONDS = 0.38;
export const FALL_SHARE = 0.62;
export const BOUNCE_HEIGHT = 0.45;

const OVERSHOOT = 1.701_58;
const FOLLOW_RATE = 14;
const LEAN_SPEED = 25;
const LARGEST_TILT = 0.4;
const TILT_STIFFNESS = 80;
const TILT_DAMPING = 8;
const DROP_SECONDS = 0.42;
const RETURN_METERS_PER_SECOND = 120;
const LONGEST_RETURN_SECONDS = 0.9;
const LONGEST_SETTLE_SECONDS = DROP_SECONDS + LONGEST_RETURN_SECONDS;
const ARC_PER_METER = 0.12;
const HIGHEST_ARC = 8;
const UNKNOWN_DURATION = 0;

export interface HandPose {
  readonly lift: number;
  readonly tiltX: number;
  readonly tiltZ: number;
  readonly x: number;
  readonly z: number;
}

type MotionPhase = "carried" | "settling";

export function liftPop(seconds: number): number {
  const shifted = clamp(seconds / LIFT_SECONDS, 0, 1) - 1;

  return 1 + (OVERSHOOT + 1) * shifted ** 3 + OVERSHOOT * shifted ** 2;
}

export function landing(progress: number, fromLift: number): number {
  if (progress < FALL_SHARE) {
    const fall = progress / FALL_SHARE;

    return fromLift * (1 - fall * fall);
  }

  const hop = clamp((progress - FALL_SHARE) / (1 - FALL_SHARE), 0, 1);

  return BOUNCE_HEIGHT * 4 * hop * (1 - hop);
}

export class HandMotion {
  #duration = UNKNOWN_DURATION;
  #fromLift = 0;
  #fromX = 0;
  #fromZ = 0;
  #lift = 0;
  #phase: MotionPhase = "carried";
  #seconds = 0;
  #subject: GrabTarget | null = null;
  #tiltSpeedX = 0;
  #tiltSpeedZ = 0;
  #tiltX = 0;
  #tiltZ = 0;
  #x = 0;
  #z = 0;

  get subject(): GrabTarget | null {
    return this.#subject;
  }

  update(held: HeldView | null, seconds: number): void {
    if (held !== null) {
      this.#carry(held, seconds);

      return;
    }

    if (this.#subject === null) {
      return;
    }

    if (this.#phase === "carried") {
      this.#release();
    }

    this.#settle(seconds);
  }

  poseOf(kind: GrabbableKind, id: number, restX: number, restZ: number): HandPose | null {
    if (!isTarget(this.#subject, kind, id)) {
      return null;
    }

    if (this.#phase === "settling") {
      this.#placeSettling(restX, restZ);
    }

    return { lift: this.#lift, tiltX: this.#tiltX, tiltZ: this.#tiltZ, x: this.#x, z: this.#z };
  }

  #carry(held: HeldView, seconds: number): void {
    if (this.#phase !== "carried" || !isTarget(this.#subject, held.kind, held.id)) {
      this.#pickUp(held);

      return;
    }

    this.#seconds += seconds;

    const blend = 1 - Math.exp(-FOLLOW_RATE * seconds);
    const stepX = (held.x - this.#x) * blend;
    const stepZ = (held.z - this.#z) * blend;

    this.#x += stepX;
    this.#z += stepZ;
    this.#lift = lerp(this.#fromLift, HELD_LIFT, liftPop(this.#seconds));

    if (seconds <= 0) {
      return;
    }

    const speed = Math.hypot(stepX, stepZ) / seconds;
    const lean = speed > 0 ? (LARGEST_TILT * Math.tanh(speed / LEAN_SPEED)) / speed : 0;

    this.#swing((stepX / seconds) * lean, (stepZ / seconds) * lean, seconds);
  }

  #pickUp(held: HeldView): void {
    const isRegrab = isTarget(this.#subject, held.kind, held.id);

    this.#subject = { id: held.id, kind: held.kind };
    this.#phase = "carried";
    this.#seconds = 0;

    if (isRegrab) {
      this.#fromLift = this.#lift;

      return;
    }

    this.#fromLift = 0;
    this.#lift = 0;
    this.#x = held.x;
    this.#z = held.z;
    this.#tiltX = 0;
    this.#tiltZ = 0;
    this.#tiltSpeedX = 0;
    this.#tiltSpeedZ = 0;
  }

  #swing(goalX: number, goalZ: number, seconds: number): void {
    this.#tiltSpeedX += (TILT_STIFFNESS * (goalX - this.#tiltX) - TILT_DAMPING * this.#tiltSpeedX) * seconds;
    this.#tiltSpeedZ += (TILT_STIFFNESS * (goalZ - this.#tiltZ) - TILT_DAMPING * this.#tiltSpeedZ) * seconds;
    this.#tiltX = clamp(this.#tiltX + this.#tiltSpeedX * seconds, -LARGEST_TILT, LARGEST_TILT);
    this.#tiltZ = clamp(this.#tiltZ + this.#tiltSpeedZ * seconds, -LARGEST_TILT, LARGEST_TILT);
  }

  #release(): void {
    this.#phase = "settling";
    this.#seconds = 0;
    this.#duration = UNKNOWN_DURATION;
    this.#fromX = this.#x;
    this.#fromZ = this.#z;
    this.#fromLift = this.#lift;
  }

  #settle(seconds: number): void {
    this.#seconds += seconds;
    this.#swing(0, 0, seconds);

    const isKnownAndDone = this.#duration !== UNKNOWN_DURATION && this.#seconds >= this.#duration;

    if (isKnownAndDone || this.#seconds >= LONGEST_SETTLE_SECONDS) {
      this.#subject = null;
    }
  }

  #placeSettling(restX: number, restZ: number): void {
    const distance = Math.hypot(restX - this.#fromX, restZ - this.#fromZ);

    if (this.#duration === UNKNOWN_DURATION) {
      this.#duration = DROP_SECONDS + Math.min(distance / RETURN_METERS_PER_SECOND, LONGEST_RETURN_SECONDS);
    }

    const progress = clamp(this.#seconds / this.#duration, 0, 1);
    const travel = smoothstep(0, 1, progress / FALL_SHARE);
    const arc =
      Math.min(distance * ARC_PER_METER, HIGHEST_ARC) * Math.sin(Math.PI * Math.min(1, progress / FALL_SHARE));

    this.#x = lerp(this.#fromX, restX, travel);
    this.#z = lerp(this.#fromZ, restZ, travel);
    this.#lift = landing(progress, this.#fromLift) + arc;
  }
}
