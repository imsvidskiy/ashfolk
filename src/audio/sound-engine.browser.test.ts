import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { ignore } from "../shared/ignore.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { DEFAULT_SOUND_LEVELS, SoundEngine } from "./sound-engine.ts";

describe("sound engine", () => {
  it("creates no audio context before a gesture", async () => {
    const engine = new SoundEngine();
    const detach = engine.attach(window);

    expect(engine.context).toBeNull();
    expect(engine.isAudible).toBe(false);

    await userEvent.keyboard("{Shift}");

    expect(engine.context).not.toBeNull();
    expect(engine.isAudible).toBe(true);
    detach();
  });

  it("goes quiet when muted", async () => {
    const engine = new SoundEngine();
    const detach = engine.attach(window);

    await userEvent.keyboard("{Shift}");
    await vi.waitFor(() => {
      expect(engine.context?.state).toBe("running");
    });
    engine.setLevels({ ...DEFAULT_SOUND_LEVELS, isMuted: true });

    expect(engine.isAudible).toBe(false);
    expect(engine.loop(SOUNDS.fire, { x: 0, y: 0, z: 0 }, { seconds: 1, volume: 1 })).not.toBeNull();
    await vi.waitFor(() => {
      expect(engine.context?.state).toBe("suspended");
    });

    engine.setLevels(DEFAULT_SOUND_LEVELS);

    await vi.waitFor(() => {
      expect(engine.context?.state).toBe("running");
    });
    detach();
  });

  it("stays silent and reports a sound it cannot load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(ignore);
    const engine = new SoundEngine();
    const detach = engine.attach(window);

    await userEvent.keyboard("{Shift}");
    engine.play(SOUNDS.uiClick, null);

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Could not load the sound"), expect.any(Error));
    });
    detach();
  });
});
