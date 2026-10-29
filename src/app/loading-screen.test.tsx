import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { GameSession } from "../game/game-session.ts";
import { createLocalSession } from "../game/testing/local-session.ts";
import { ignore } from "../shared/ignore.ts";
import { Simulation } from "../simulation/simulation.ts";
import { createVegetatedWorld } from "../simulation/testing/test-world.ts";
import { reportStop } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import { useLaunchStore } from "./launch-store.ts";
import { LoadingScreen } from "./loading-screen.tsx";
import { reloadPage } from "./reload-page.ts";

vi.mock("./reload-page.ts", () => {
  return { reloadPage: vi.fn() };
});

async function startFailingSession(failure: Error): Promise<GameSession> {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 64 } }));
  const { session } = await createLocalSession(simulation);

  vi.spyOn(simulation, "advance").mockImplementation(() => {
    throw failure;
  });

  return session;
}

describe("loading screen", () => {
  it("says why the island could not rise", async () => {
    useEngineStore.setState({ status: { kind: "failed", message: "WebGPU is not available" } });

    const screen = await render(<LoadingScreen />);

    await expect.element(screen.getByRole("alert").getByText("The island could not rise")).toBeVisible();
    await expect.element(screen.getByText("WebGPU is not available")).toBeVisible();
  });

  it.each([
    ["saves", true],
    ["fails to save", false],
  ])("asks for a reload when the graphics are lost and reloads once the game %s", async (_, isSaved) => {
    const reload = vi.mocked(reloadPage);
    let settle = ignore;
    const saved = new Promise<unknown>((resolve, reject) => {
      settle = () => {
        if (isSaved) {
          resolve("saved");
        } else {
          reject(new Error("The save failed"));
        }
      };
    });

    reload.mockClear();
    useEngineStore.setState({ status: { kind: "graphicsLost", saved } });

    const screen = await render(<LoadingScreen />);

    await expect.element(screen.getByRole("alert").getByText("The island went dark")).toBeVisible();

    const button = screen.getByRole("button", { name: "Reload" });

    await button.click();

    await expect.element(button).toBeDisabled();
    expect(reload).not.toHaveBeenCalled();

    settle();

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
  });

  it("tells the player when the simulation stops and starts the world again", async () => {
    vi.spyOn(console, "error").mockImplementation(ignore);

    const session = await startFailingSession(new Error("The worker crashed"));

    const { launch } = useLaunchStore.getState();

    reportStop(session, useEngineStore.getState().setStatus);
    session.update(1);
    await session.whenIdle();

    const screen = await render(<LoadingScreen />);

    await expect.element(screen.getByRole("alert").getByText("The simulation stopped")).toBeVisible();
    await expect.element(screen.getByText("The worker crashed")).toBeVisible();

    await screen.getByRole("button", { name: "Start again" }).click();

    expect(useLaunchStore.getState().launch).not.toBe(launch);
    expect(useLaunchStore.getState().launch.seed).toBe(launch.seed);
  });
});
