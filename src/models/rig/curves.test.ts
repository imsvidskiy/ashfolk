import { describe, expect, it } from "vitest";
import { arc, degrees, keyframes, pulse, triangleWave } from "./curves.ts";

describe("animation curves", () => {
  it("converts degrees to radians", () => {
    expect(degrees(180)).toBeCloseTo(Math.PI);
  });

  it("rises and falls once per cycle in a triangle wave", () => {
    expect(triangleWave(0)).toBe(0);
    expect(triangleWave(0.5)).toBe(1);
    expect(triangleWave(0.25)).toBeCloseTo(0.5);
    expect(triangleWave(1.75)).toBeCloseTo(0.5);
  });

  it("peaks a pulse at its center and wraps around", () => {
    expect(pulse(0.4, 0.4, 0.1)).toBe(1);
    expect(pulse(1.4, 0.4, 0.1)).toBeCloseTo(1);
    expect(pulse(0.98, 0.02, 0.05)).toBeCloseTo(pulse(0.06, 0.02, 0.05));
    expect(pulse(0.9, 0.4, 0.1)).toBeLessThan(0.001);
  });

  it("passes through every keyframe and loops back to the first", () => {
    const keys = [
      [0.2, 10],
      [0.5, 40],
      [0.8, 20],
    ] as const;

    expect(keyframes(0.2, keys)).toBe(10);
    expect(keyframes(0.5, keys)).toBe(40);
    expect(keyframes(1.8, keys)).toBe(20);
    expect(keyframes(0.35, keys)).toBeCloseTo(25);
    expect(keyframes(0, keys)).toBeCloseTo(15);
    expect(keyframes(0.9, keys)).toBeCloseTo(keyframes(-0.1, keys));
  });

  it("rises and falls once inside an arc", () => {
    expect(arc(0.2, 0.3, 0.4)).toBe(0);
    expect(arc(0.5, 0.3, 0.4)).toBeCloseTo(1);
    expect(arc(0.75, 0.3, 0.4)).toBe(0);
  });
});
