import { describe, expect, it, onTestFinished, vi } from "vitest";
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

  it("seeks timed cues at natural pitch and cancels both playing and still-decoding sounds", async () => {
    const engine = new SoundEngine();
    const detach = engine.attach(window);

    onTestFinished(detach);
    await userEvent.keyboard("{Shift}");

    const { context } = engine;

    if (context === null) {
      throw new Error("The gesture did not unlock sound");
    }

    onTestFinished(() => {
      return context.close();
    });
    await vi.waitFor(() => {
      expect(context.state).toBe("running");
    });

    const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const decode = vi.spyOn(context, "decodeAudioData").mockResolvedValue(buffer);
    const start = vi.spyOn(AudioBufferSourceNode.prototype, "start");
    const stop = vi.spyOn(AudioBufferSourceNode.prototype, "stop");
    const playing = new AbortController();

    vi.spyOn(window, "fetch").mockImplementation(() => {
      return Promise.resolve(new Response(new ArrayBuffer(8)));
    });
    engine.play(SOUNDS.nuclearFall, null, { offsetSeconds: 1.4, signal: playing.signal });
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledOnce();
    });
    expect(start.mock.calls[0]?.[1]).toBeGreaterThanOrEqual(1.4);
    expect(start.mock.instances[0]).toMatchObject({ playbackRate: { value: 1 } });
    playing.abort();
    expect(stop).toHaveBeenCalledOnce();

    const waiting = new AbortController();
    let finishDecode: (result: AudioBuffer) => void = ignore;
    const pending = new Promise<AudioBuffer>((resolve) => {
      finishDecode = resolve;
    });

    decode.mockReturnValueOnce(pending);
    engine.play(SOUNDS.nuclearImpact, null, { offsetSeconds: 0, signal: waiting.signal });
    await vi.waitFor(() => {
      expect(decode).toHaveBeenCalledTimes(2);
    });
    waiting.abort();
    finishDecode(buffer);
    await pending;
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    expect(start).toHaveBeenCalledOnce();
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
