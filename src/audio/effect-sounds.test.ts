import { describe, expect, it, vi } from "vitest";
import type { TornadoEffect } from "../simulation/effects.ts";
import { tornadoDuration } from "../simulation/powers/tornado-path.ts";
import { createPowerSimulation } from "../simulation/testing/test-powers.ts";
import { EffectSounds } from "./effect-sounds.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { createTestSoundEngine, flatGroundPoint } from "./testing/test-sound-engine.ts";

const VIEW = { focusX: 0, focusZ: 0, viewDistance: 300 };
const TORNADO: TornadoEffect = { kind: "tornado", path: [0, 0, 10, 0, 20, 0, 30, 0, 40, 0], radius: 20 };
const PAUSED_RENDERS = 120;

describe("effect sounds", () => {
  it("carries the tornado roar along its path in game time and stops it at the end", () => {
    const { engine, loop, loops } = createTestSoundEngine();
    const effects = new EffectSounds(engine, flatGroundPoint);
    const duration = tornadoDuration(TORNADO.path);

    effects.hear(TORNADO, VIEW);
    effects.update(duration / 2);

    expect(loop).toHaveBeenCalledWith(SOUNDS.tornado, { x: 0, y: 0, z: 0 }, expect.any(Object));
    expect(loops[0]?.setPosition).toHaveBeenLastCalledWith({ x: 20, y: 0, z: 0 });
    expect(loops[0]?.stop).not.toHaveBeenCalled();

    effects.update(duration / 2);

    expect(loops[0]?.stop).toHaveBeenCalledOnce();
  });

  it("hears far natural lightning as thunder once the sound has traveled, waiting a few seconds at most", () => {
    const { engine, play } = createTestSoundEngine();
    const effects = new EffectSounds(engine, flatGroundPoint);
    const place = { x: 686, y: 0, z: 0 };

    effects.hear({ isNatural: true, kind: "lightning", x: place.x, z: place.z }, VIEW);
    effects.hear({ isNatural: true, kind: "lightning", x: 3000, z: 0 }, VIEW);
    effects.hear({ isNatural: true, kind: "lightning", x: 100, z: 0 }, VIEW);
    effects.hear({ isNatural: false, kind: "lightning", x: place.x, z: place.z }, VIEW);

    const signal = play.mock.calls[0]?.[2]?.signal;

    expect(signal?.aborted).toBe(false);
    expect(play.mock.calls).toEqual([
      [SOUNDS.thunderFar, place, { delaySeconds: 2, signal }],
      [SOUNDS.thunderFar, { x: 3000, y: 0, z: 0 }, { delaySeconds: 4, signal }],
      [SOUNDS.lightning, { x: 100, y: 0, z: 0 }, { signal }],
      [SOUNDS.lightning, place, { signal }],
    ]);

    effects.dispose();

    expect(signal?.aborted).toBe(true);
  });

  it("keeps a dense series of player bolts to one nearby thunder voice at a time", () => {
    const { engine, play } = createTestSoundEngine();
    const effects = new EffectSounds(engine, flatGroundPoint);
    const clock = vi.spyOn(performance, "now").mockReturnValue(2000);
    const bolt = { isNatural: false, kind: "lightning", x: 5, z: 7 } as const;

    effects.hear(bolt, VIEW);
    effects.hear(bolt, VIEW);
    clock.mockReturnValue(2420);
    effects.hear(bolt, VIEW);
    clock.mockReturnValue(2840);
    effects.hear(bolt, VIEW);

    expect(
      play.mock.calls.map(([sound]) => {
        return sound;
      })
    ).toEqual([SOUNDS.lightning, SOUNDS.lightning]);
    clock.mockRestore();
  });

  it("plays the end of a short meteor approach and one impact at contact", () => {
    const { engine, play } = createTestSoundEngine();
    const effects = new EffectSounds(engine, flatGroundPoint);

    effects.hear(
      { durationSeconds: 0.6, fromX: 10, fromY: 3000, fromZ: 25, kind: "meteor", radius: 50, toX: 90, toZ: 15 },
      VIEW
    );

    expect(play.mock.calls[0]?.[0]).toBe(SOUNDS.meteorFall);
    expect(play.mock.calls[0]?.[2]?.offsetSeconds).toBeCloseTo(1.8);
    expect(play).toHaveBeenCalledOnce();

    const blast = { isInWater: false, kind: "explosion", power: 1, radius: 50, surfaceY: 0, x: 90, z: 15 } as const;

    effects.hear(blast, VIEW);
    expect(play.mock.calls[1]?.[0]).toBe(SOUNDS.explosion);
    effects.hear({ ...blast, isMeteor: true }, VIEW);
    effects.hear({ ...blast, isInWater: true, isMeteor: true }, VIEW);
    expect(
      play.mock.calls.slice(2).map(([sound]) => {
        return sound;
      })
    ).toEqual([SOUNDS.meteorImpact, SOUNDS.explosionWater]);
    effects.dispose();
    expect(play.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
  });

  it.each([true, false])("plays each shower hit on the worker frame that lands it at 16×, paused=%s", (isPaused) => {
    const simulation = createPowerSimulation();
    const { engine, play } = createTestSoundEngine();
    const effects = new EffectSounds(engine, flatGroundPoint);

    simulation.setSpeed(16);
    simulation.setPaused(isPaused);
    simulation.usePower("meteor-shower", 0, 0, { count: 3, radius: 80 });

    let hits = 0;
    let flights = 0;

    for (let index = 0; index < 34; index += 1) {
      const next = simulation.advance(0.1);

      play.mockClear();

      for (const event of next.effects) {
        effects.hear(event, VIEW);
      }

      const landed = next.effects.filter((event) => {
        return event.kind === "explosion" && event.isMeteor;
      });
      const approaches = next.effects.filter((event) => {
        return event.kind === "meteor";
      });

      hits += landed.length;
      flights += approaches.length;
      expect(
        play.mock.calls.filter(([sound]) => {
          return sound === SOUNDS.meteorImpact;
        })
      ).toHaveLength(landed.length);
      expect(
        play.mock.calls.filter(([sound]) => {
          return sound === SOUNDS.meteorFall;
        })
      ).toHaveLength(approaches.length);
    }

    expect(hits).toBe(3);
    expect(flights).toBe(3);
    effects.dispose();
  });

  it("holds the tornado roar in place while the game is paused", () => {
    const { engine, loops } = createTestSoundEngine();
    const effects = new EffectSounds(engine, flatGroundPoint);

    effects.hear(TORNADO, VIEW);
    effects.update(0.5);

    for (let render = 0; render < PAUSED_RENDERS; render += 1) {
      effects.update(0);
    }

    expect(loops[0]?.setPosition).toHaveBeenLastCalledWith({ x: 10, y: 0, z: 0 });
    expect(loops[0]?.stop).not.toHaveBeenCalled();
  });
});
