import { describe, expect, it } from "vitest";
import { ResolutionGovernor } from "./resolution-governor.ts";

function playFrames(governor: ResolutionGovernor, elapsed: number, frames: number, hasFocus = true): number {
  let changes = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    if (governor.record(elapsed, hasFocus)) {
      changes += 1;
    }
  }

  return changes;
}

describe("resolution governor", () => {
  it("keeps the sharpest resolution while frames keep up", () => {
    const governor = new ResolutionGovernor(2);

    expect(playFrames(governor, 1000 / 60, 600)).toBe(0);
    expect(governor.pixelRatio(2)).toBe(2);
  });

  it("lowers the resolution step by step while frames are slow", () => {
    const governor = new ResolutionGovernor(2);

    playFrames(governor, 40, 120);

    expect(governor.pixelRatio(2)).toBeLessThan(2);
    expect(governor.pixelRatio(2)).toBeGreaterThanOrEqual(1);
  });

  it("never drops below three quarters of a pixel", () => {
    const governor = new ResolutionGovernor(2);

    playFrames(governor, 80, 2000);

    expect(governor.pixelRatio(1)).toBe(0.75);
  });

  it("raises the resolution again once frames have kept up for a while", () => {
    const governor = new ResolutionGovernor(2);

    playFrames(governor, 40, 120);

    const lowered = governor.pixelRatio(2);

    playFrames(governor, 1000 / 60, 3000);

    expect(governor.pixelRatio(2)).toBeGreaterThan(lowered);
  });

  it("ignores frames slowed down in the background", () => {
    const governor = new ResolutionGovernor(2);

    expect(playFrames(governor, 1000 / 30, 600, false)).toBe(0);
    expect(governor.pixelRatio(2)).toBe(2);
  });

  it("follows a screen that has fewer pixels than the quality allows", () => {
    expect(new ResolutionGovernor(2).pixelRatio(1)).toBe(1);
  });

  it("holds the sharpest resolution while filming however slow the frames are", () => {
    const governor = new ResolutionGovernor(2);

    playFrames(governor, 40, 120);
    governor.hold(true);

    expect(governor.pixelRatio(2)).toBe(2);
    expect(playFrames(governor, 40, 600)).toBe(0);
    expect(governor.pixelRatio(2)).toBe(2);
  });
});
