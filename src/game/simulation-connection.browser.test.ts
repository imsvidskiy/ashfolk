import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { GenerationStage } from "../generation/generation-options.ts";
import { ignore } from "../shared/ignore.ts";
import { WorkerSimulationConnection } from "./simulation-connection.ts";

const SMALL_WORLD = {
  options: { dimensions: { cellSize: 10, cellsPerSide: 96 }, erosionStrength: 1, shape: "round" },
  seed: 3,
} as const;

function connectToStalledWorker() {
  const createWorker = vi.fn(StalledWorker);

  vi.stubGlobal("Worker", createWorker);

  const connection = new WorkerSimulationConnection();
  const [worker] = createWorker.mock.instances;

  onTestFinished(() => {
    connection.dispose();
  });

  if (worker === undefined) {
    throw new Error("The connection should have started a worker");
  }

  return { connection, worker };
}

class StalledWorker extends EventTarget {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

describe("worker simulation connection", () => {
  it("creates the world in a worker and advances it with the queued commands", async () => {
    const connection = new WorkerSimulationConnection();
    const stages = new Set<GenerationStage>();

    onTestFinished(() => {
      connection.dispose();
    });

    const world = await connection.createWorld(SMALL_WORLD, (progress) => {
      stages.add(progress.stage);
    });

    connection.send({ isPaused: true, type: "setPaused" });

    const frame = await connection.advance(0.2);

    expect(stages).toContain("vegetation");
    expect(world.terrain.height).toHaveLength(96 * 96);
    expect(world.frame.personCount).toBeGreaterThan(0);
    expect(frame.isPaused).toBe(true);
    expect(frame.people.length).toBeGreaterThan(0);
  });

  it("drops commands queued for the previous world", async () => {
    const connection = new WorkerSimulationConnection();

    onTestFinished(() => {
      connection.dispose();
    });

    await connection.createWorld(SMALL_WORLD, ignore);
    connection.send({ isPaused: true, type: "setPaused" });
    await connection.createWorld(SMALL_WORLD, ignore);

    const frame = await connection.advance(0.2);

    expect(frame.isPaused).toBe(false);
  });

  it("rejects the requests in flight when the worker fails", async () => {
    const { connection, worker } = connectToStalledWorker();

    const requests = [connection.createWorld(SMALL_WORLD, ignore), connection.advance(0.2), connection.saveWorld()];

    worker.dispatchEvent(new ErrorEvent("error", { message: "boom" }));

    await Promise.all(
      requests.map((request) => {
        return expect(request).rejects.toThrow("boom");
      })
    );
  });

  it("settles pending calls when disposed and sends no more requests", async () => {
    const { connection, worker } = connectToStalledWorker();

    const advancing = connection.advance(0.2);
    const saving = connection.saveWorld();

    connection.dispose();

    await expect(advancing).rejects.toThrow("closed");
    await expect(saving).rejects.toThrow("closed");

    worker.postMessage.mockClear();
    connection.dispose();

    await expect(connection.advance(0)).rejects.toThrow("closed");
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("keeps the original worker error for future requests", async () => {
    const { connection, worker } = connectToStalledWorker();

    worker.dispatchEvent(new ErrorEvent("error", { message: "worker crashed" }));
    worker.postMessage.mockClear();

    await expect(connection.saveWorld()).rejects.toThrow("worker crashed");
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("rejects with a message of its own when the worker cannot load", async () => {
    const { connection, worker } = connectToStalledWorker();

    const request = connection.advance(0.2);

    worker.dispatchEvent(new Event("error"));

    await expect(request).rejects.toThrow("The simulation worker could not load");
  });
});
