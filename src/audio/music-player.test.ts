import { describe, expect, it } from "vitest";
import { moodAt, nextTrack } from "./music-player.ts";

describe("music moods", () => {
  it("follows the time of day", () => {
    expect(moodAt(12)).toBe("day");
    expect(moodAt(18)).toBe("dusk");
    expect(moodAt(6)).toBe("dusk");
    expect(moodAt(2)).toBe("night");
  });

  it("never plays the same track twice in a row", () => {
    const first = nextTrack("day", null, 0);

    for (const roll of [0, 0.3, 0.6, 0.99]) {
      expect(nextTrack("day", first, roll)).not.toBe(first);
    }
  });
});
