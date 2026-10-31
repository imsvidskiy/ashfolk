import { describe, expect, it } from "vitest";
import type { HeldView } from "../simulation/hand/grab-target.ts";
import {
  BOUNCE_HEIGHT,
  FALL_SHARE,
  HandMotion,
  type HandPose,
  HELD_LIFT,
  LIFT_SECONDS,
  landing,
  liftPop,
} from "./hand-motion.ts";

const FRAME = 1 / 60;
const DEER: HeldView = { id: 4, isPlaceable: true, kind: "animal", x: 0, z: 0 };

function run(motion: HandMotion, held: HeldView | null, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME) {
    motion.update(held, FRAME);
  }
}

function poseOf(motion: HandMotion): HandPose {
  const pose = motion.poseOf("animal", DEER.id, 0, 0);

  if (pose === null) {
    throw new Error("The deer should be in the hand");
  }

  return pose;
}

describe("hand motion", () => {
  it("pops up past the carrying height and settles on it", () => {
    expect(liftPop(0)).toBeCloseTo(0);
    expect(liftPop(LIFT_SECONDS)).toBeCloseTo(1);
    expect(Math.max(liftPop(LIFT_SECONDS * 0.6), liftPop(LIFT_SECONDS * 0.75))).toBeGreaterThan(1.05);
  });

  it("falls to the ground and hops once on landing", () => {
    expect(landing(0, HELD_LIFT)).toBe(HELD_LIFT);
    expect(landing(FALL_SHARE, HELD_LIFT)).toBeCloseTo(0);
    expect(landing((FALL_SHARE + 1) / 2, HELD_LIFT)).toBeCloseTo(BOUNCE_HEIGHT);
    expect(landing(1, HELD_LIFT)).toBeCloseTo(0);
  });

  it("lifts only the held thing", () => {
    const motion = new HandMotion();

    run(motion, DEER, LIFT_SECONDS * 2);

    expect(poseOf(motion).lift).toBeCloseTo(HELD_LIFT);
    expect(motion.poseOf("animal", DEER.id + 1, 0, 0)).toBeNull();
    expect(motion.poseOf("person", DEER.id, 0, 0)).toBeNull();
  });

  it("trails the pointer and leans the way it travels", () => {
    const motion = new HandMotion();

    run(motion, DEER, LIFT_SECONDS);

    for (let step = 1; step <= 6; step += 1) {
      motion.update({ ...DEER, x: step * 2 }, FRAME);
    }

    const pose = poseOf(motion);

    expect(pose.x).toBeGreaterThan(0);
    expect(pose.x).toBeLessThan(12);
    expect(pose.tiltX).toBeGreaterThan(0);
    expect(Math.abs(pose.tiltZ)).toBeLessThan(1e-6);
  });

  it("flies back to where it was picked up after a refused drop and then lets go", () => {
    const motion = new HandMotion();

    run(motion, DEER, LIFT_SECONDS);
    run(motion, { ...DEER, isPlaceable: false, x: 60 }, 1);
    motion.update(null, FRAME);

    const start = poseOf(motion);

    run(motion, null, 0.25);

    const midway = poseOf(motion);

    expect(start.x).toBeGreaterThan(50);
    expect(midway.x).toBeGreaterThan(0);
    expect(midway.x).toBeLessThan(start.x);
    expect(midway.lift).toBeGreaterThan(0);

    run(motion, null, 2);

    expect(motion.subject).toBeNull();
  });

  it("carries on from mid-flight when the same thing is grabbed again", () => {
    const motion = new HandMotion();

    run(motion, DEER, LIFT_SECONDS);
    run(motion, { ...DEER, isPlaceable: false, x: 60 }, 1);
    motion.update(null, FRAME);
    poseOf(motion);
    run(motion, null, 0.1);

    const midway = poseOf(motion);

    motion.update({ ...DEER, x: 200 }, FRAME);

    const regrabbed = poseOf(motion);

    motion.update({ ...DEER, x: 200 }, FRAME);

    const carried = poseOf(motion);

    expect(regrabbed.x).toBeCloseTo(midway.x);
    expect(regrabbed.x).toBeLessThan(100);
    expect(midway.lift).toBeGreaterThan(HELD_LIFT);
    expect(regrabbed.lift).toBeCloseTo(midway.lift);
    expect(carried.lift).toBeGreaterThan(HELD_LIFT);

    run(motion, { ...DEER, x: 200 }, LIFT_SECONDS * 2);

    expect(poseOf(motion).lift).toBeCloseTo(HELD_LIFT);
  });

  it("starts afresh when another thing is grabbed", () => {
    const motion = new HandMotion();

    run(motion, DEER, 1);
    motion.update({ ...DEER, id: 9, x: 40 }, FRAME);

    expect(motion.subject).toEqual({ id: 9, kind: "animal" });
    expect(motion.poseOf("animal", 9, 0, 0)).toMatchObject({ lift: 0, x: 40 });
  });

  it("pops another thing up from the ground while the last one is landing", () => {
    const motion = new HandMotion();
    const fresh = new HandMotion();
    const fawn: HeldView = { ...DEER, id: 9, x: 40 };

    run(motion, DEER, LIFT_SECONDS * 2);
    motion.update(null, FRAME);

    for (const hand of [motion, fresh]) {
      hand.update(fawn, FRAME);
      hand.update(fawn, FRAME);
    }

    const pose = motion.poseOf("animal", fawn.id, 0, 0);

    expect(pose).toEqual(fresh.poseOf("animal", fawn.id, 0, 0));
    expect(pose).toMatchObject({ lift: expect.closeTo(HELD_LIFT * liftPop(FRAME)) });
  });
});
