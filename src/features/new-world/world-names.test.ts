import { describe, expect, it } from "vitest";
import { LONGEST_WORLD_NAME, readWorldName, worldNameFor } from "./world-names.ts";

const ONE_WORD = /^[A-Z][a-z]+$/u;
const TRIPLED_LETTER = /(?<letter>.)\k<letter>\k<letter>/u;

describe("world names", () => {
  it("names every seed the same way each time", () => {
    expect(worldNameFor(7)).toBe("Duskcrest");
  });

  it("gives neighboring seeds different single-word names", () => {
    const names = new Set(
      Array.from({ length: 50 }, (_, seed) => {
        return worldNameFor(seed + 1);
      })
    );

    expect(names.size).toBe(50);

    for (const name of names) {
      expect(name).toMatch(ONE_WORD);
    }
  });

  it("never runs the same letter across the join", () => {
    for (let seed = 1; seed < 2000; seed += 1) {
      const name = worldNameFor(seed).toLowerCase();

      expect(name, name).not.toMatch(TRIPLED_LETTER);
    }
  });

  it("tidies the spaces in a typed name", () => {
    expect(readWorldName("  Old   Ford ")).toBe("Old Ford");
  });

  it("refuses empty and overlong names", () => {
    expect(readWorldName("   ")).toBeNull();
    expect(readWorldName("a".repeat(LONGEST_WORLD_NAME + 1))).toBeNull();
    expect(readWorldName("a".repeat(LONGEST_WORLD_NAME))).toHaveLength(LONGEST_WORLD_NAME);
  });
});
