import { describe, expect, it, vi } from "vitest";
import { SOUNDS } from "./sound-catalog.ts";
import { SoundVariations } from "./sound-variations.ts";

describe("sound variations", () => {
  it("picks another file after a click even with other sounds in between", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const variations = new SoundVariations();
    const first = variations.pick(SOUNDS.uiClick);

    variations.pick(SOUNDS.uiTab);
    expect(variations.pick(SOUNDS.uiClick)).not.toBe(first);
  });

  it("favours a different recording without alternating a pair in lockstep", () => {
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    const variations = new SoundVariations();
    const first = variations.pick(SOUNDS.uiClose);

    expect(variations.pick(SOUNDS.uiClose)).toBe(first);
    roll.mockReturnValue(0.9);
    expect(variations.pick(SOUNDS.uiClose)).not.toBe(first);
  });
});
