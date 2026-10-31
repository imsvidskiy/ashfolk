import { describe, expect, it } from "vitest";
import { Pose } from "../rig/pose.ts";
import { HUMAN_BONE_COUNT } from "./human-skeleton.ts";
import { bounceBody } from "./leg-cycles.ts";

const SAMPLES = 100;
const BOUNCE_HEIGHT = 0.05;

function heightsOverOneCycle(): number[] {
  const pose = new Pose(HUMAN_BONE_COUNT);

  return Array.from({ length: SAMPLES }, (_, step) => {
    bounceBody(pose, step / SAMPLES);

    return pose.height;
  });
}

function peakStep(heights: readonly number[], from: number, to: number): number {
  const window = heights.slice(from, to);

  return from + window.indexOf(Math.max(...window));
}

describe("body bounce", () => {
  it("keeps the body between the ground and the bounce height", () => {
    const heights = heightsOverOneCycle();

    expect(Math.min(...heights)).toBe(0);
    expect(Math.max(...heights)).toBeLessThanOrEqual(BOUNCE_HEIGHT);
  });

  it("bounces twice a cycle and lands on the ground between the bounces", () => {
    const heights = heightsOverOneCycle();

    const first = peakStep(heights, 0, SAMPLES / 2);
    const second = peakStep(heights, SAMPLES / 2, SAMPLES);

    expect(heights[first]).toBeCloseTo(BOUNCE_HEIGHT, 4);
    expect(heights[second]).toBeCloseTo(BOUNCE_HEIGHT, 4);
    expect(heights.slice(first, second)).toContain(0);
    expect([...heights.slice(second), ...heights.slice(0, first)]).toContain(0);
  });
});
