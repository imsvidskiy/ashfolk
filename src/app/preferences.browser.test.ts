import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOUND_LEVELS } from "../audio/sound-engine.ts";
import { ignore } from "../shared/ignore.ts";
import {
  storedLabelsShown,
  storedQuality,
  storedSoundLevels,
  storeLabelsShown,
  storeQuality,
  storeSoundLevels,
} from "./preferences.ts";

const QUALITY_KEY = "dawnfolk.quality";
const LABELS_KEY = "dawnfolk.labels";
const SOUND_KEY = "dawnfolk.sound";

describe("saved preferences", () => {
  it("has no saved quality at first", () => {
    expect(storedQuality()).toBeNull();
  });

  it("remembers the saved quality", () => {
    storeQuality("high");

    expect(storedQuality()).toBe("high");
    expect(localStorage.getItem(QUALITY_KEY)).toBe("high");
  });

  it("replaces the saved quality", () => {
    storeQuality("high");
    storeQuality("low");

    expect(storedQuality()).toBe("low");
  });

  it("ignores and reports a saved quality it does not know", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    localStorage.setItem(QUALITY_KEY, "ultra");

    expect(storedQuality()).toBeNull();
    expect(warn).toHaveBeenCalledExactlyOnceWith("Ignoring a saved graphics quality", expect.any(Array));
  });

  it("shows map labels until they are turned off", () => {
    expect(storedLabelsShown()).toBe(true);

    storeLabelsShown(false);

    expect(storedLabelsShown()).toBe(false);
    expect(localStorage.getItem(LABELS_KEY)).toBe("hidden");

    storeLabelsShown(true);

    expect(storedLabelsShown()).toBe(true);
  });

  it("shows map labels when the saved setting is unknown", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    localStorage.setItem(LABELS_KEY, "sometimes");

    expect(storedLabelsShown()).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith("Ignoring a saved label setting", expect.any(Array));
  });

  it("remembers the sound settings", () => {
    expect(storedSoundLevels()).toBeNull();

    storeSoundLevels({ ...DEFAULT_SOUND_LEVELS, isMuted: true, music: 0.2 });

    expect(storedSoundLevels()).toEqual({ ...DEFAULT_SOUND_LEVELS, isMuted: true, music: 0.2 });
  });

  it("ignores and reports broken sound settings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);

    localStorage.setItem(SOUND_KEY, JSON.stringify({ master: 3 }));

    expect(storedSoundLevels()).toBeNull();
    expect(warn).toHaveBeenCalledExactlyOnceWith("Ignoring the saved sound settings", expect.any(Array));
  });
});
