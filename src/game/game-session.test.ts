import { describe, expect, it, vi } from "vitest";
import type { GenerationProgress } from "../generation/generation-options.ts";
import { ignore } from "../shared/ignore.ts";
import type { ChronicleEntry } from "../simulation/chronicle.ts";
import { Simulation } from "../simulation/simulation.ts";
import { createVegetatedWorld } from "../simulation/testing/test-world.ts";
import { createSimulationWorkerApi } from "../workers/simulation-worker-api.ts";
import { CHRONICLE_HISTORY_LIMIT, GameSession, type SessionStatus } from "./game-session.ts";
import { createLocalSession, LocalSimulationConnection } from "./testing/local-session.ts";

const SAVED_ENTRY: ChronicleEntry = { category: "weather", day: 3, id: 9, text: "Saved", tribeId: null, x: 0, z: 0 };

interface SessionSetup {
  connection: LocalSimulationConnection;
  session: GameSession;
  simulation: Simulation;
}

function createTestSimulation(): Simulation {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 64 } }));

  simulation.weather.setKind("clear");

  return simulation;
}

async function createSession(): Promise<SessionSetup> {
  const simulation = createTestSimulation();
  const { connection, session } = await createLocalSession(simulation);

  return { connection, session, simulation };
}

async function advanceSession(session: GameSession, seconds: number): Promise<void> {
  session.update(seconds);

  await session.whenIdle();
}

describe("creating a session", () => {
  it("generates the world and reports the progress", async () => {
    const stages = new Set<string>();
    const connection = new LocalSimulationConnection(createSimulationWorkerApi());

    const session = await GameSession.create(
      connection,
      { options: { dimensions: { cellSize: 10, cellsPerSide: 96 }, erosionStrength: 1, shape: "round" }, seed: 3 },
      {
        onProgress: (progress: GenerationProgress) => {
          stages.add(progress.stage);
        },
      }
    );

    expect(stages).toEqual(new Set(["climate", "erosion", "relief", "vegetation", "water"]));
    expect(session.status).toEqual({ kind: "running" });
    expect(session.frame.personCount).toBeGreaterThan(0);
    expect(session.mirror.grid.cellsPerSide).toBe(96);
  });
});

describe("loading a session", () => {
  it("starts the chronicle from the saved journal", async () => {
    const { connection } = await createSession();

    const saved = await connection.saveWorld();

    if (saved === null) {
      throw new Error("The test world was busy");
    }

    const loading = new LocalSimulationConnection(
      createSimulationWorkerApi(createTestSimulation, createTestSimulation)
    );
    const session = await GameSession.load(loading, saved, { journal: [SAVED_ENTRY] });

    expect(session.chronicle[0]).toEqual(SAVED_ENTRY);
    expect(session.hasLandChanged).toBe(false);
  });
});

describe("advancing", () => {
  it("keeps one request in flight and carries the waiting time into the next one", async () => {
    const { connection, session } = await createSession();

    const advance = vi.spyOn(connection, "advance");

    session.update(0.1);
    session.update(0.05);
    session.update(0.05);

    expect(session.isAdvancing).toBe(true);

    await session.whenIdle();
    session.update(0.05);
    await session.whenIdle();

    expect(session.isAdvancing).toBe(false);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(advance).toHaveBeenNthCalledWith(1, expect.closeTo(0.1));
    expect(advance).toHaveBeenNthCalledWith(2, expect.closeTo(0.15));
  });

  it("waits for a whole tick before asking the worker for a frame", async () => {
    const { connection, session } = await createSession();

    const advance = vi.spyOn(connection, "advance");

    session.update(0.04);
    session.update(0.04);

    expect(advance).not.toHaveBeenCalled();

    session.update(0.04);
    await session.whenIdle();

    expect(advance).toHaveBeenCalledWith(expect.closeTo(0.12));
  });

  it("stays quiet while paused until a command arrives", async () => {
    const { connection, session } = await createSession();

    session.send({ isPaused: true, type: "setPaused" });
    session.update(0.02);
    await session.whenIdle();

    const advance = vi.spyOn(connection, "advance");

    session.update(0.3);
    session.update(0.3);

    expect(advance).not.toHaveBeenCalled();

    session.send({ isPaused: false, type: "setPaused" });
    session.update(0.02);
    await session.whenIdle();

    expect(advance).toHaveBeenCalledOnce();
  });

  it("sends the view focus with the next regular request instead of asking for a frame", async () => {
    const { connection, session, simulation } = await createSession();

    session.send({ isPaused: true, type: "setPaused" });
    session.update(0.02);
    await session.whenIdle();

    const advance = vi.spyOn(connection, "advance");
    const execute = vi.spyOn(simulation, "execute");

    session.send({ type: "setViewFocus", x: 120, z: -80 });
    session.update(0.1);

    expect(advance).not.toHaveBeenCalled();

    session.update(0.9);
    await session.whenIdle();

    expect(advance).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ type: "setViewFocus", x: 120, z: -80 });
  });

  it("applies every frame to the mirror and tells the subscribers", async () => {
    const { session } = await createSession();

    const listener = vi.fn();

    session.subscribe(listener);
    vi.spyOn(performance, "now").mockReturnValue(900);
    await advanceSession(session, 0.2);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(session.frame);
    expect(session.frame.tick).toBe(2);
    expect(session.mirror.gameSecondsSinceTick(950)).toBeCloseTo(session.frame.secondsSinceTick + 0.05);
  });

  it("stops telling a subscriber that left", async () => {
    const { session } = await createSession();

    const listener = vi.fn();

    const unsubscribe = session.subscribe(listener);

    unsubscribe();
    await advanceSession(session, 0.1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("delivers commands with the next request", async () => {
    const { session } = await createSession();

    session.send({ isPaused: true, type: "setPaused" });
    await advanceSession(session, 0.1);

    expect(session.frame.isPaused).toBe(true);
  });

  it("tells command listeners about every command until they leave", async () => {
    const { session } = await createSession();

    const listener = vi.fn();

    const unsubscribe = session.subscribeToCommands(listener);

    session.send({ speed: 4, type: "setSpeed" });
    unsubscribe();
    session.send({ isPaused: true, type: "setPaused" });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ speed: 4, type: "setSpeed" });
  });

  it("counts the commands and ticks worth saving, but not the view", async () => {
    const { session } = await createSession();

    session.send({ selection: null, type: "setSelection" });
    session.send({ type: "setViewFocus", x: 120, z: -80 });
    await advanceSession(session, 0.02);

    expect(session.changes).toBe(0);

    session.send({ speed: 2, type: "setSpeed" });
    await advanceSession(session, 0.1);

    expect(session.changes).toBe(2);
  });
});

describe("history", () => {
  it("hands every effect out once", async () => {
    const { session, simulation } = await createSession();

    simulation.effects.add({ isNatural: false, kind: "lightning", x: 10, z: 20 });
    await advanceSession(session, 0.1);

    expect(session.takeEffects()).toEqual([{ isNatural: false, kind: "lightning", x: 10, z: 20 }]);
    expect(session.takeEffects()).toEqual([]);
  });

  it("keeps only the latest chronicle entries", async () => {
    const { session, simulation } = await createSession();

    for (let entry = 0; entry < CHRONICLE_HISTORY_LIMIT + 20; entry += 1) {
      simulation.chronicle.record({ category: "weather", text: `Entry ${entry}`, tribeId: null, x: 0, z: 0 });
    }

    await advanceSession(session, 0.1);

    expect(session.chronicle).toHaveLength(CHRONICLE_HISTORY_LIMIT);
    expect(session.chronicle.at(-1)?.text).toBe(`Entry ${CHRONICLE_HISTORY_LIMIT + 19}`);
    expect(session.chronicle.at(0)?.text).toBe("Entry 20");
  });
});

describe("failures and closing", () => {
  it("stops, reports and lets go of the simulation when it fails", async () => {
    const { connection, session } = await createSession();

    const statuses: SessionStatus[] = [];
    const failure = new Error("The worker crashed");
    const logError = vi.spyOn(console, "error").mockImplementation(ignore);

    const advance = vi.spyOn(connection, "advance").mockRejectedValueOnce(failure);
    const dispose = vi.spyOn(connection, "dispose");

    session.subscribeToStatus((status) => {
      statuses.push(status);
    });
    await advanceSession(session, 0.1);
    await advanceSession(session, 0.1);

    expect(statuses).toEqual([{ error: failure, kind: "failed" }]);
    expect(session.status).toEqual({ error: failure, kind: "failed" });
    expect(logError).toHaveBeenCalledWith("The simulation stopped", failure);
    expect(advance).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("lets go of the simulation once when it closes", async () => {
    const { connection, session } = await createSession();

    const dispose = vi.spyOn(connection, "dispose");

    session.close();
    session.close();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("stays closed when the request in flight fails after closing", async () => {
    const { connection, session } = await createSession();

    const logError = vi.spyOn(console, "error").mockImplementation(ignore);

    vi.spyOn(connection, "advance").mockRejectedValueOnce(new Error("The worker was stopped"));
    session.update(0.1);
    session.close();
    await session.whenIdle();

    expect(session.status).toEqual({ kind: "closed" });
    expect(logError).not.toHaveBeenCalled();
  });

  it("ignores the frame that arrives after closing", async () => {
    const { connection, session } = await createSession();

    const listener = vi.fn();
    const send = vi.spyOn(connection, "send");
    const initialFrame = session.frame;

    session.subscribe(listener);
    session.update(0.1);
    session.close();
    await session.whenIdle();
    session.send({ isPaused: true, type: "setPaused" });

    expect(session.status).toEqual({ kind: "closed" });
    expect(session.frame).toBe(initialFrame);
    expect(listener).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
