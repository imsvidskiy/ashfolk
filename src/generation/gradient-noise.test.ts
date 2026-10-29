import { describe, expect, it } from "vitest";
import { createRandom } from "../shared/random.ts";
import { type ErodedRidgedOptions, GradientNoise, type NoiseGradient } from "./gradient-noise.ts";

const STEP = 1e-4;

function sampleAt(noise: GradientNoise, x: number, z: number): NoiseGradient {
  return noise.sample(x, z, { gradientX: 0, gradientZ: 0, value: 0 });
}

function samplePoints(count: number): [number, number][] {
  return Array.from({ length: count }, (_, index) => {
    return [Math.sin(index * 12.9898) * 37, Math.cos(index * 78.233) * 37];
  });
}

function averageSteepness(sample: (x: number, z: number) => number): number {
  let total = 0;

  for (const [x, z] of samplePoints(400)) {
    total += Math.hypot(sample(x + 0.01, z) - sample(x, z), sample(x, z + 0.01) - sample(x, z));
  }

  return total / 400;
}

describe("gradient noise", () => {
  it("returns the derivatives of its own values", () => {
    const noise = new GradientNoise(createRandom(5));

    for (const [x, z] of samplePoints(200)) {
      const { gradientX, gradientZ } = sampleAt(noise, x, z);

      const alongX = (sampleAt(noise, x + STEP, z).value - sampleAt(noise, x - STEP, z).value) / (2 * STEP);
      const alongZ = (sampleAt(noise, x, z + STEP).value - sampleAt(noise, x, z - STEP).value) / (2 * STEP);

      expect(gradientX).toBeCloseTo(alongX, 4);
      expect(gradientZ).toBeCloseTo(alongZ, 4);
    }
  });

  it("stays within the unit range and repeats for a seed", () => {
    const noise = new GradientNoise(createRandom(5));
    const again = new GradientNoise(createRandom(5));
    const other = new GradientNoise(createRandom(6));

    const values = samplePoints(500).map(([x, z]) => {
      return sampleAt(noise, x, z).value;
    });

    expect(Math.min(...values)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(sampleAt(again, 3.3, -1.7)).toEqual(sampleAt(noise, 3.3, -1.7));
    expect(sampleAt(other, 3.3, -1.7)).not.toEqual(sampleAt(noise, 3.3, -1.7));
  });

  it("smooths the finer octaves of ridges on steep ground", () => {
    const noise = new GradientNoise(createRandom(9));
    const ridges: ErodedRidgedOptions = { damping: 0, gain: 0.5, octaves: 6, rounding: 0.02, slopeScale: 1 };

    const sharp = averageSteepness((x, z) => {
      return noise.erodedRidged(x, z, ridges);
    });
    const eroded = averageSteepness((x, z) => {
      return noise.erodedRidged(x, z, { ...ridges, damping: 8 });
    });

    expect(eroded).toBeLessThan(sharp * 0.8);
  });
});
