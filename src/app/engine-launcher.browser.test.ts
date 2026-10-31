import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createTestSession } from "../features/testing/engine-fixtures.ts";
import type { GameSession } from "../game/game-session.ts";
import type { GenerationProgress } from "../generation/generation-options.ts";
import { ignore } from "../shared/ignore.ts";
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

  it("says the island is being lit once the world has grown", async () => {
    const session = await createTestSession();
    let grow: (progress: GenerationProgress) => void = ignore;
    let open: (opened: GameSession) => void = ignore;
    const statuses: EngineStatus[] = [];

    openSession.mockImplementation((_world: unknown, onProgress: (progress: GenerationProgress) => void) => {
      grow = onProgress;

      return new Promise((resolve) => {
        open = resolve;
      });
    });
    startEngine.mockReturnValue(new Promise(ignore));

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

    grow({ island: null, stage: "relief" });
    open(session);

    await vi.waitFor(() => {
      expect(statuses.map(stageOf)).toEqual(["waking", "relief", "lighting"]);
    });
    await vi.waitFor(() => {
      expect(startEngine).toHaveBeenCalledOnce();
    });
  });
});
