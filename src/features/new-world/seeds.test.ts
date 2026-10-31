import { describe, expect, it } from "vitest";
import { LARGEST_SEED, randomSeed, readSeed } from "./seeds.ts";

describe("seeds", () => {
  it("draws whole numbers within the allowed range", () => {
    const seeds = Array.from({ length: 200 }, () => {
      return randomSeed();
    });

    expect(
      seeds.every((seed) => {
        return Number.isInteger(seed);
      })
    ).toBe(true);
    expect(Math.min(...seeds)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...seeds)).toBeLessThanOrEqual(LARGEST_SEED);
  });

  it("reads a typed seed from the first to the largest one", () => {
    expect(readSeed(" 42 ")).toBe(42);
    expect(readSeed("1")).toBe(1);
    expect(readSeed(String(LARGEST_SEED))).toBe(LARGEST_SEED);
  });

  it("refuses typed seeds that are blank, fractional or out of range", () => {
    for (const text of ["", "  ", "island", "4.5", "0", "-3", String(LARGEST_SEED + 1)]) {
      expect(readSeed(text), text).toBeNull();
    }
  });
});
