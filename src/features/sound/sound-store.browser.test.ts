import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOUND_LEVELS } from "../../audio/sound-engine.ts";
import { ignore } from "../../shared/ignore.ts";
import { readStoredLevels, useSoundStore } from "./sound-store.ts";

const STORAGE_KEY = "ashfolk.sound";

function saveLevels(levels: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { levels }, version: 0 }));
}

function readSavedLevels(): unknown {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved === null) {
    return null;
  }

  return JSON.parse(saved);
}

describe("sound store", () => {
  it("starts with the default levels", () => {
    expect(useSoundStore.getState().levels).toEqual(DEFAULT_SOUND_LEVELS);
  });

  it("saves the sound settings", () => {
    useSoundStore.getState().setMuted(true);
    useSoundStore.getState().setVolume("music", 0.2);

    expect(readSavedLevels()).toEqual({
      state: { levels: { ...DEFAULT_SOUND_LEVELS, isMuted: true, music: 0.2 } },
      version: 0,
    });
  });

  it("remembers the saved sound settings", async () => {
    saveLevels({ ...DEFAULT_SOUND_LEVELS, isMuted: true, music: 0.2 });

    await useSoundStore.persist.rehydrate();

    expect(useSoundStore.getState().levels).toEqual({ ...DEFAULT_SOUND_LEVELS, isMuted: true, music: 0.2 });
  });

  it("ignores and reports broken sound settings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    expect(readStoredLevels({ levels: { master: 3 } })).toEqual(DEFAULT_SOUND_LEVELS);
    expect(warn).toHaveBeenCalledExactlyOnceWith("Ignoring the saved sound settings", expect.any(Array));
  });
});
