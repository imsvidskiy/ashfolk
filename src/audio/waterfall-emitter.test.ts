import { describe, expect, it } from "vitest";
import { EmitterLoops } from "./emitters.ts";
import { SOUNDS } from "./sound-catalog.ts";
import { createTestSoundEngine, flatGroundPoint } from "./testing/test-sound-engine.ts";
import { waterfallEmitter } from "./waterfall-emitter.ts";

const NEAR = { focusX: 0, focusZ: 0, viewDistance: 240 };
const FALL = { directionX: 0, directionZ: 1, top: 48, width: 36, x: 10, z: 20 };

describe("waterfall ambience", () => {
  it("follows the nearest lip at the actual water height and uses a single voice", () => {
    const { engine, loop, loops } = createTestSoundEngine();
    const emitters = new EmitterLoops(engine, SOUNDS.waterfall, flatGroundPoint);
    const falls = [FALL, { ...FALL, top: 72, x: 180 }];

    emitters.update(waterfallEmitter(falls, NEAR));
    expect(loop).toHaveBeenCalledExactlyOnceWith(
      SOUNDS.waterfall,
      { x: 10, y: 48, z: 20 },
      { seconds: 1.2, volume: 1 }
    );

    emitters.update(waterfallEmitter(falls, { ...NEAR, focusX: 180 }));
    expect(loop).toHaveBeenCalledTimes(1);
    expect(loops[0]?.setPosition).toHaveBeenCalledWith({ x: 180, y: 72, z: 20 });

    emitters.update(waterfallEmitter([], NEAR));
    expect(loops[0]?.stop).toHaveBeenCalledOnce();
  });

  it("fades narrow, distant and zoomed-out falls and stays quiet outside their reach", () => {
    const [narrow] = waterfallEmitter([{ ...FALL, width: 10 }], NEAR);
    const [quiet] = waterfallEmitter([FALL], { focusX: 400, focusZ: 0, viewDistance: 800 });

    expect(narrow?.volume).toBeLessThan(1);
    expect(quiet?.volume).toBeGreaterThan(0);
    expect(quiet?.volume).toBeLessThan(1);
    expect(waterfallEmitter([FALL], { ...NEAR, focusX: 1500 })).toEqual([]);
    expect(waterfallEmitter([FALL], { ...NEAR, viewDistance: 2400 })).toEqual([]);
  });
});
