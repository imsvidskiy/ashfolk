import { describe, expect, it } from "vitest";
import type { TornadoEffect } from "../simulation/effects.ts";
import { tornadoDuration } from "../simulation/powers/tornadoes.ts";
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
