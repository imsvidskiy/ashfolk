import { Matrix4 } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { GameSession } from "../game/game-session.ts";
import { createLocalSession, LocalSimulationConnection } from "../game/testing/local-session.ts";
import { ignore } from "../shared/ignore.ts";
import type { SimulationCommand } from "../simulation/commands.ts";
import { Simulation } from "../simulation/simulation.ts";
import { createVegetatedWorld } from "../simulation/testing/test-world.ts";
import { createSimulationWorkerApi } from "../workers/simulation-worker-api.ts";
import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import { createTestSoundEngine } from "./testing/test-sound-engine.ts";
import { connectWorldSounds } from "./world-sounds.ts";

const TRIBE: SimulationCommand = { parameters: {}, powerId: "tribe", type: "usePower", x: 0, z: 0 };

const CAMERA = {
  camera: { matrixWorld: new Matrix4() },
  groundFootprint: () => {
    return [];
  },
  isFollowing: false,
  state: { distance: 300, pitch: 0.6, targetX: 0, targetZ: 0, yaw: 0.8 },
};

function skipRenders() {
  return ignore;
}

interface HeldSession {
  readonly played: () => SoundDefinition[];
  readonly reply: () => Promise<void>;
  readonly session: GameSession;
  readonly simulation: Simulation;
}

async function startHeldSession(): Promise<HeldSession> {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 64 } }));
  const { connection, session } = await createLocalSession(simulation);
  const { engine, play } = createTestSoundEngine();
  const advance = connection.advance.bind(connection);
  const replies: (() => void)[] = [];

  vi.spyOn(connection, "advance").mockImplementation((seconds) => {
    const frame = advance(seconds);

    return new Promise((resolve) => {
      replies.push(() => {
        resolve(frame);
      });
    });
  });
  connectWorldSounds({ camera: CAMERA, session, subscribeToRenders: skipRenders }, engine);

  function played(): SoundDefinition[] {
    return play.mock.calls.map(([sound]) => {
      return sound;
    });
  }

  async function reply(): Promise<void> {
    for (const release of replies.splice(0)) {
      release();
    }

    await session.whenIdle();
  }

  return { played, reply, session, simulation };
}

describe("world sounds", () => {
  it("restores an airborne bomb and a black hole from the worker's first saved frame", async () => {
    function createWorld(): Simulation {
      return new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 64 } }));
    }
    const simulation = createWorld();
    const { connection, session: original } = await createLocalSession(simulation);

    simulation.usePower("nuclear", 0, 0, { radius: 100 });
    simulation.usePower("black-hole", 40, 40, { duration: 6, radius: 100 });
    simulation.runTicks(22);
    simulation.setPaused(true);

    const saved = await connection.saveWorld();

    if (saved === null) {
      throw new Error("The session could not save the ongoing powers");
    }
    original.close();

    const loading = new LocalSimulationConnection(createSimulationWorkerApi(createWorld, createWorld));
    const session = await GameSession.load(loading, saved);
    const { engine, play, loop, loops } = createTestSoundEngine();
    const leave = connectWorldSounds({ camera: CAMERA, session, subscribeToRenders: skipRenders }, engine);

    expect(session.frame.isPaused).toBe(true);
    expect(play).not.toHaveBeenCalled();
    expect(
      loop.mock.calls.some(([sound]) => {
        return sound === SOUNDS.blackHoleHum;
      })
    ).toBe(false);
    session.send({ isPaused: false, type: "setPaused" });
    session.update(0);
    await session.whenIdle();

    const flight = play.mock.calls.find(([sound]) => {
      return sound === SOUNDS.nuclearFall;
    });
    const hum = loop.mock.calls.findIndex(([sound]) => {
      return sound === SOUNDS.blackHoleHum;
    });

    expect(flight?.[2]?.offsetSeconds).toBeCloseTo(0.6);
    expect(hum).toBeGreaterThanOrEqual(0);
    expect(loop.mock.calls[hum]?.[2].offsetSeconds).toBeCloseTo(2.2);
    expect(
      play.mock.calls.some(([sound]) => {
        return sound === SOUNDS.blackHoleOpen || sound === SOUNDS.nuclearImpact;
      })
    ).toBe(false);
    leave();
    expect(loops[hum]?.stop).toHaveBeenCalledOnce();
    expect(flight?.[2]?.signal?.aborted).toBe(true);
    session.close();
  });

  it("keeps a refused cast silent when an older frame arrives first", async () => {
    const { played, reply, session, simulation } = await startHeldSession();

    simulation.world.terrain.waterSurface.fill(200);
    session.update(1);
    session.send(TRIBE);
    await reply();

    expect(played()).not.toContain(SOUNDS.tribeArrive);

    session.update(0);
    await reply();

    expect(played()).not.toContain(SOUNDS.tribeArrive);
    expect(played()).toContain(SOUNDS.uiRefuse);
  });

  it("plays a cast with the frame that carried it", async () => {
    const { played, reply, session } = await startHeldSession();

    session.update(1);
    session.send(TRIBE);
    await reply();

    expect(played()).not.toContain(SOUNDS.tribeArrive);

    session.update(0);
    await reply();

    expect(played()).toContain(SOUNDS.tribeArrive);
    expect(played()).not.toContain(SOUNDS.uiRefuse);
  });
});
