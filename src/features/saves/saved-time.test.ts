import { describe, expect, it } from "vitest";
import { describePeople, formatSavedAt } from "./saved-time.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 100 * 24 * HOUR;

describe("saved time", () => {
  it("calls a save from the last moments just now", () => {
    expect(formatSavedAt(NOW - 30_000, NOW)).toBe("just now");
    expect(formatSavedAt(NOW + 5000, NOW)).toBe("just now");
  });

  it("counts minutes, hours and days since a save", () => {
    expect(formatSavedAt(NOW - 50_000, NOW)).toBe("1 minute ago");
    expect(formatSavedAt(NOW - 12 * MINUTE, NOW)).toBe("12 minutes ago");
    expect(formatSavedAt(NOW - 3 * HOUR, NOW)).toBe("3 hours ago");
    expect(formatSavedAt(NOW - 30 * HOUR, NOW)).toBe("yesterday");
    expect(formatSavedAt(NOW - 5 * 24 * HOUR, NOW)).toBe("5 days ago");
  });

  it("counts people in words", () => {
    expect(describePeople(0)).toBe("0 people");
    expect(describePeople(1)).toBe("1 person");
    expect(describePeople(12)).toBe("12 people");
  });
});
