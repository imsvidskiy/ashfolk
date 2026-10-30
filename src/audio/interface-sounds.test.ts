import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_RANK, InterfaceSounds } from "./interface-sounds.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { createTestSoundEngine } from "./testing/test-sound-engine.ts";

const CLICK_RANK = 1;

describe("interface sounds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays one sound for one gesture and lets the action win over the click", () => {
    const { engine, play } = createTestSoundEngine();
    const sounds = new InterfaceSounds(engine);

    sounds.request(SOUNDS.uiClick, CLICK_RANK);
    sounds.request(SOUNDS.uiPower, ACTION_RANK);
    vi.runAllTimers();

    expect(play).toHaveBeenCalledExactlyOnceWith(SOUNDS.uiPower, null);
  });

  it("keeps the first of two sounds of the same rank", () => {
    const { engine, play } = createTestSoundEngine();
    const sounds = new InterfaceSounds(engine);

    sounds.request(SOUNDS.uiOpen, ACTION_RANK);
    sounds.request(SOUNDS.uiPower, ACTION_RANK);
    vi.runAllTimers();

    expect(play).toHaveBeenCalledExactlyOnceWith(SOUNDS.uiOpen, null);
  });

  it("plays the sounds of separate gestures", () => {
    const { engine, play } = createTestSoundEngine();
    const sounds = new InterfaceSounds(engine);

    sounds.request(SOUNDS.uiClick, CLICK_RANK);
    vi.runAllTimers();
    sounds.request(SOUNDS.uiTab, CLICK_RANK);
    vi.runAllTimers();

    expect(play.mock.calls).toEqual([
      [SOUNDS.uiClick, null],
      [SOUNDS.uiTab, null],
    ]);
  });
});
