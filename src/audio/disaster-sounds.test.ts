import { describe, expect, it, vi } from "vitest";
import type {
  BlackHoleEffect,
  NuclearCloudEffect,
  NuclearFallEffect,
  SimulationEffect,
} from "../simulation/effects.ts";
import { DisasterSounds } from "./disaster-sounds.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { createTestSoundEngine } from "./testing/test-sound-engine.ts";

const VIEW = { focusX: 10, focusZ: 5, viewDistance: 300 };
const POINT = { x: 10, y: 20, z: 5 };

const DROP: NuclearFallEffect = {
  dropId: 3,
  durationSeconds: 4.4,
  kind: "nuclear-fall",
  radius: 180,
  surfaceY: POINT.y,
  x: POINT.x,
  z: POINT.z,
};
const IMPACT: NuclearCloudEffect = {
  dropId: DROP.dropId,
  isInWater: false,
  kind: "nuclear-cloud",
  radius: DROP.radius,
  surfaceY: POINT.y,
  x: POINT.x,
  z: POINT.z,
};

const WELL: BlackHoleEffect = {
  durationSeconds: 8,
  kind: "black-hole",
  radius: 180,
  surfaceY: 20,
  wellId: 7,
  x: 10,
  z: 5,
};

function frame(tick: number, effects: SimulationEffect[] = [], isPaused = false, speed = 1) {
  return { effects, isPaused, speed, tick };
}

describe("disaster sounds", () => {
  it("times the end of the falling cue to the impact, including pause and speed changes", () => {
    const { engine, play } = createTestSoundEngine();
    const sounds = new DisasterSounds(engine);

    sounds.hear(frame(100, [DROP]), VIEW);
    sounds.hear(frame(115), VIEW);
    expect(play).not.toHaveBeenCalled();

    sounds.hear(frame(117), VIEW);
    expect(play.mock.calls[0]?.[0]).toBe(SOUNDS.nuclearFall);
    expect(play.mock.calls[0]?.[2]?.offsetSeconds).toBeCloseTo(0.1);

    sounds.hear(frame(120, [], true), VIEW);
    expect(play.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    sounds.hear(frame(120, [], true), VIEW);
    expect(play).toHaveBeenCalledTimes(1);

    sounds.hear(frame(120, [], false, 4), VIEW);
    expect(play.mock.calls[1]?.[2]?.offsetSeconds).toBeCloseTo(2.2);
    sounds.hear(frame(125), VIEW);
    expect(play.mock.calls[1]?.[2]?.signal?.aborted).toBe(true);
    expect(play.mock.calls[2]?.[2]?.offsetSeconds).toBeCloseTo(0.9);

    sounds.hear(frame(144, [IMPACT]), VIEW);
    expect(play.mock.calls[2]?.[2]?.signal?.aborted).toBe(true);
    expect(
      play.mock.calls.slice(3).map(([sound]) => {
        return sound;
      })
    ).toEqual([SOUNDS.nuclearImpact, SOUNDS.nuclearTail]);
    expect(play.mock.calls[4]?.[2]?.delaySeconds).toBe(0.32);
    sounds.dispose();
    expect(play.mock.calls[3]?.[2]?.signal?.aborted).toBe(true);
    expect(play.mock.calls[4]?.[2]?.signal?.aborted).toBe(true);
  });

  it("restores the remaining part of a legacy fall and replaces overlapping reverberation", () => {
    const { engine, play } = createTestSoundEngine();
    const sounds = new DisasterSounds(engine);

    sounds.hear(frame(20, [{ ...DROP, durationSeconds: 2.8, elapsedSeconds: 1.1 }, IMPACT], true), VIEW, true);
    expect(play).not.toHaveBeenCalled();
    sounds.hear(frame(20), VIEW);
    expect(play.mock.calls[0]?.[2]?.offsetSeconds).toBeCloseTo(1.1);

    sounds.hear(frame(37, [{ ...IMPACT, isInWater: true }]), VIEW);
    sounds.hear(frame(39, [{ ...IMPACT, dropId: 9 }]), VIEW);
    expect(play.mock.calls[2]?.[2]?.signal?.aborted).toBe(true);
    expect(play.mock.calls[4]?.[2]?.signal?.aborted).toBe(false);
    expect(
      play.mock.calls.map(([sound]) => {
        return sound;
      })
    ).not.toContain(SOUNDS.explosionWater);
    sounds.dispose();
  });

  it("preloads active disasters once sound is audible and resumes from their current age", () => {
    const { engine, loop, play } = createTestSoundEngine();
    const sounds = new DisasterSounds(engine);
    const audible = vi.spyOn(engine, "isAudible", "get").mockReturnValue(false);
    const preload = vi.spyOn(engine, "preload");
    const { levels } = engine;

    sounds.hear(frame(10, [DROP, WELL], true), VIEW);
    expect(preload).not.toHaveBeenCalled();

    audible.mockReturnValue(true);
    engine.setLevels({ ...levels, effects: 0 });
    sounds.hear(frame(28), VIEW);
    expect(preload).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    engine.setLevels(levels);
    sounds.hear(frame(32), VIEW);
    sounds.hear(frame(33), VIEW);
    expect(preload).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledOnce();
    expect(play.mock.calls[0]?.[0]).toBe(SOUNDS.nuclearFall);
    expect(play.mock.calls[0]?.[2]?.offsetSeconds).toBeCloseTo(0.6);
    expect(loop.mock.calls[0]?.[0]).toBe(SOUNDS.blackHoleHum);

    sounds.dispose();
  });

  it("opens on resume, holds on pause, and collapses at the original position when the simulation says so", () => {
    const { engine, loop, loops, play } = createTestSoundEngine();
    const sounds = new DisasterSounds(engine);

    sounds.hear(frame(0, [WELL], true), VIEW);
    expect(play).not.toHaveBeenCalled();
    sounds.hear(frame(0), VIEW);
    expect(play).toHaveBeenCalledWith(SOUNDS.blackHoleOpen, POINT, expect.objectContaining({ offsetSeconds: 0 }));
    sounds.hear(frame(12), VIEW);
    expect(loop).toHaveBeenCalledWith(
      SOUNDS.blackHoleHum,
      POINT,
      expect.objectContaining({ offsetSeconds: expect.closeTo(1.2) })
    );
    sounds.hear(frame(12, [], true), VIEW);
    expect(loops[0]?.stop).toHaveBeenCalledOnce();
    expect(play.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    sounds.hear(frame(12, [], true), VIEW);
    expect(loop).toHaveBeenCalledTimes(1);
    sounds.hear(frame(12), VIEW);
    expect(loop).toHaveBeenCalledTimes(2);

    sounds.hear(frame(85), VIEW);
    expect(loops[1]?.stop).not.toHaveBeenCalled();
    sounds.hear(frame(86, [{ kind: "black-hole-collapse", wellId: 7 }]), VIEW);
    expect(loops[1]?.stop).toHaveBeenCalledOnce();
    expect(play).toHaveBeenLastCalledWith(SOUNDS.blackHoleCollapse, POINT, expect.any(Object));
    sounds.dispose();
  });

  it("joins only the nearest sustained hum after a save, unlocks mid-effect, and keeps overlapping wells independent", () => {
    const { engine, loop, loops, play } = createTestSoundEngine();
    const sounds = new DisasterSounds(engine);
    const audible = vi.spyOn(engine, "isAudible", "get").mockReturnValue(false);
    const restored = { ...WELL, elapsedSeconds: 2 };

    sounds.hear(frame(40, [restored, { ...restored, wellId: 8, x: 350 }]), VIEW, true);
    expect(loop).not.toHaveBeenCalled();
    audible.mockReturnValue(true);
    sounds.hear(frame(42), VIEW);
    expect(play).not.toHaveBeenCalled();
    expect(loop).toHaveBeenCalledOnce();
    expect(loop.mock.calls[0]?.[1]).toEqual(POINT);
    expect(loop.mock.calls[0]?.[2].offsetSeconds).toBeCloseTo(2.2);

    sounds.hear(frame(43, [{ kind: "black-hole-collapse", wellId: 7 }]), VIEW);
    expect(loops[0]?.stop).toHaveBeenCalledOnce();
    expect(loop.mock.calls[1]?.[1]).toEqual({ ...POINT, x: 350 });
    sounds.hear(frame(49, [{ kind: "black-hole-collapse", wellId: 7 }]), VIEW);
    expect(play).toHaveBeenCalledTimes(1);
    sounds.dispose();
    expect(loops[1]?.stop).toHaveBeenCalledOnce();
  });
});
