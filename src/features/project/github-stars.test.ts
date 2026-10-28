import { describe, expect, it } from "vitest";
import { formatStars } from "./github-stars.ts";

describe("github stars", () => {
  it("shortens large star counts", () => {
    expect(formatStars(8)).toBe("8");
    expect(formatStars(2000)).toBe("2K");
    expect(formatStars(15_340)).toBe("15.3K");
  });
});
