import { describe, expect, it, onTestFinished, vi } from "vitest";
import { deleteSavedWorld, readSavedWorld } from "../features/saves/save-database.ts";
import { createTestSession } from "../features/testing/engine-fixtures.ts";
import { saveWorld } from "../features/testing/save-fixtures.ts";
import type { GameSession } from "../game/game-session.ts";
import type { GenerationProgress } from "../generation/generation-options.ts";
import { ignore } from "../shared/ignore.ts";
import { islandSizeOf } from "../world/island-size.ts";
import { EngineLauncher, type EngineStatus, worldSourceFor } from "./engine-launcher.ts";
import { createWorldId, type LaunchOptions } from "./launch-options.ts";

const { openSession, startEngine } = vi.hoisted(() => {
  return { openSession: vi.fn(), startEngine: vi.fn() };
});

vi.mock("../game/open-session.ts", () => {
  return { openSession };
});

vi.mock("../game/game-engine.ts", () => {
  return { GameEngine: { start: startEngine } };
});

vi.mock("./hud.tsx", () => {
  return { Hud: ignore };
});

const LAUNCH: LaunchOptions = {
  camera: {},
  hours: null,
  isPaused: false,
  name: "Mossholm",
  quality: "low",
  seed: 7,
  shape: "round",
  size: "large",
};

function stageOf(status: EngineStatus): string {
  return status.kind === "loading" ? status.stage : status.kind;
}

describe("engine launcher", () => {
  it("grows a new world on the grid of the chosen size", async () => {
    const source = await worldSourceFor(LAUNCH, createWorldId());

    expect(source).toMatchObject({
      kind: "new",
      request: { options: { dimensions: { cellSize: 10, cellsPerSide: 768 }, shape: "round" }, seed: 7 },
    });
  });

  it("restores the saved island name and generation settings when the address gives other values", async () => {
    const id = createWorldId();
    const restoreChoice = vi.fn();

    await saveWorld(id, "Remembered Coast");

    onTestFinished(async () => {
      await deleteSavedWorld(id);
    });

    const saved = await readSavedWorld(id);

    if (saved === null) {
      throw new Error("Expected a saved island");
    }

    const { options, seed } = saved.state.request;
    const source = await worldSourceFor({ ...LAUNCH, name: "Wrong island", seed: seed + 1 }, id, restoreChoice);

    expect(source.kind).toBe("saved");
    expect(restoreChoice).toHaveBeenCalledWith({
      name: "Remembered Coast",
      seed,
      shape: options.shape,
      size: islandSizeOf(options.dimensions),
    });
  });

  it("opens a fresh seed without storage and stops a saved launch on a failed read", async () => {
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new DOMException("The island could not be read", "InvalidStateError");
    });

    expect((await worldSourceFor(LAUNCH, null)).kind).toBe("new");
    expect(transaction).not.toHaveBeenCalled();
    await expect(worldSourceFor(LAUNCH, createWorldId())).rejects.toThrow("could not be read");
  });

  it("fetches the engine once the world starts growing and says it is lit once it has grown", async () => {
    const session = await createTestSession();
    let grow: (progress: GenerationProgress) => void = ignore;
    let open: (opened: GameSession) => void = ignore;
    const statuses: EngineStatus[] = [];
    const engineRequested = new Promise<void>((resolve) => {
      startEngine.mockImplementation(() => {
        resolve();

        return new Promise(ignore);
      });
    });

    openSession.mockImplementation((_world: unknown, onProgress: (progress: GenerationProgress) => void) => {
      grow = onProgress;

      return new Promise((resolve) => {
        open = resolve;
      });
    });

    const launcher = new EngineLauncher(document.body, LAUNCH, createWorldId(), (status) => {
      statuses.push(status);
    });

    onTestFinished(() => {
      launcher.cancel();
      session.close();
    });

    await vi.waitFor(() => {
      expect(openSession).toHaveBeenCalledOnce();
    });
    await vi.dynamicImportSettled();

    expect(startEngine).not.toHaveBeenCalled();

    grow({ island: null, stage: "relief" });

    await engineRequested;
    expect(startEngine).toHaveBeenCalledOnce();

    open(session);

    await vi.waitFor(() => {
      expect(statuses.map(stageOf)).toEqual(["waking", "relief", "lighting"]);
    });
  });

  it("stops opening the world when the launch is canceled", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(ignore);
    let grow: (progress: GenerationProgress) => void = ignore;

    openSession.mockImplementation(
      (_world: unknown, onProgress: (progress: GenerationProgress) => void, signal: AbortSignal) => {
        grow = onProgress;

        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("Opening the world was canceled"));
          });
        });
      }
    );
    startEngine.mockReturnValue(new Promise(ignore));

    const launcher = new EngineLauncher(document.body, LAUNCH, createWorldId(), ignore);

    await vi.waitFor(() => {
      expect(openSession).toHaveBeenCalledOnce();
    });

    launcher.cancel();
    grow({ island: null, stage: "relief" });

    await vi.waitFor(() => {
      expect(logError).toHaveBeenCalledOnce();
    });

    expect(openSession.mock.calls[0]?.[2]).toHaveProperty("aborted", true);
    expect(startEngine).not.toHaveBeenCalled();
  });

  it("closes the opened world when the engine cannot start", async () => {
    const session = await createTestSession();
    const close = vi.spyOn(session, "close");

    vi.spyOn(console, "error").mockImplementation(ignore);
    openSession.mockResolvedValue(session);
    startEngine.mockRejectedValue(new Error("The engine could not load"));

    const launcher = new EngineLauncher(document.body, LAUNCH, createWorldId(), ignore);

    onTestFinished(() => {
      launcher.cancel();
    });

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });
});
