import { Matrix4 } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import type { GameSession } from "../game/game-session.ts";
import { createLocalSession } from "../game/testing/local-session.ts";
import { ignore } from "../shared/ignore.ts";
import type { SimulationCommand } from "../simulation/commands.ts";
import { Simulation } from "../simulation/simulation.ts";
import { createVegetatedWorld } from "../simulation/testing/test-world.ts";
import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import { createTestSoundEngine } from "./testing/test-sound-engine.ts";
import { connectWorldSounds } from "./world-sounds.ts";

const TRIBE: SimulationCommand = { parameters: {}, powerId: "tribe", type: "usePower", x: 0, z: 0 };

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
  connectWorldSounds(
    {
      camera: {
        camera: { matrixWorld: new Matrix4() },
        groundFootprint: () => {
          return [];
        },
        isFollowing: false,
        state: { distance: 300, pitch: 0.6, targetX: 0, targetZ: 0, yaw: 0.8 },
      },
      session,
      subscribeToRenders: () => {
        return ignore;
      },
    },
    engine
  );

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
