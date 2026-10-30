import { describe, expect, it } from "vitest";
import { heardLoudness, voiceToReplace } from "./voices.ts";

describe("heard loudness", () => {
  it("keeps the full volume inside the reference distance", () => {
    expect(heardLoudness(0.8, 100, 40)).toBeCloseTo(0.8);
  });

  it("halves at twice the reference distance", () => {
    expect(heardLoudness(0.8, 100, 200)).toBeCloseTo(0.4);
  });

  it("ignores distance for sounds that are not placed", () => {
    expect(heardLoudness(0.5, 0, 5000)).toBe(0.5);
  });
});

describe("voice to replace", () => {
  const quiet = { loudness: 0.1, priority: 0 };
  const loud = { loudness: 0.9, priority: 3 };

  it("takes a free slot while there is room", () => {
    expect(voiceToReplace([loud], quiet, 2)).toBe(1);
  });

  it("replaces the weakest voice for a stronger one", () => {
    expect(voiceToReplace([loud, quiet, loud], loud, 3)).toBe(1);
  });

  it("drops a sound weaker than every playing voice", () => {
    expect(voiceToReplace([loud, loud], quiet, 2)).toBe(-1);
  });
});
