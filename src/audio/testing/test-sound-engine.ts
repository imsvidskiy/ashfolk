import { type Mock, type MockInstance, vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import { SoundEngine, type SoundPoint } from "../sound-engine.ts";

interface TestLoop {
  readonly setPosition: Mock<(point: SoundPoint) => void>;
  readonly setVolume: Mock<(volume: number, smoothingSeconds: number) => void>;
  readonly stop: Mock<(fadeSeconds: number) => void>;
}

interface TestSoundEngine {
  readonly engine: SoundEngine;
  readonly loop: MockInstance<SoundEngine["loop"]>;
  readonly loops: readonly TestLoop[];
  readonly play: MockInstance<SoundEngine["play"]>;
  readonly unload: MockInstance<SoundEngine["unload"]>;
}

export function flatGroundPoint(x: number, z: number): SoundPoint {
  return { x, y: 0, z };
}

export function createTestSoundEngine(): TestSoundEngine {
  const engine = new SoundEngine();
  const loops: TestLoop[] = [];

  vi.spyOn(engine, "isAudible", "get").mockReturnValue(true);

  const play = vi.spyOn(engine, "play").mockImplementation(ignore);
  const unload = vi.spyOn(engine, "unload");
  const loop = vi.spyOn(engine, "loop").mockImplementation(() => {
    const created = {
      setPosition: vi.fn<(point: SoundPoint) => void>(),
      setVolume: vi.fn<(volume: number, smoothingSeconds: number) => void>(),
      stop: vi.fn<(fadeSeconds: number) => void>(),
    };

    loops.push(created);

    return created;
  });

  return { engine, loop, loops, play, unload };
}
