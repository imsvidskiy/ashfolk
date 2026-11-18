import { describe, expect, it, onTestFinished } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useSavesStore } from "../features/saves/saves-store.ts";
import { nextFrame, startTestEngine } from "../features/testing/engine-fixtures.ts";
import { showWorld } from "../features/testing/world-fixtures.ts";
import { loadHud } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import { useLaunchStore } from "./launch-store.ts";
import { ReadyHud } from "./ready-hud.tsx";

describe("ready hud", () => {
  it("shows the hud in the frame the engine becomes ready", async () => {
    await page.viewport(1440, 900);

    showWorld();
    useEngineStore.setState({ status: { island: null, kind: "loading", stage: "relief" } });

    const screen = await render(<ReadyHud />);

    await loadHud();
    await nextFrame();

    expect(screen.container.childElementCount).toBe(0);

    await startTestEngine();
    await nextFrame();

    expect(screen.getByRole("navigation", { name: "Panels" }).query()).not.toBeNull();
  });

  it("detaches the ready HUD before the next island can use its saver", async () => {
    await page.viewport(1440, 900);
    await loadHud();
    await startTestEngine();

    const screen = await render(<ReadyHud />);

    await expect.element(screen.getByRole("navigation", { name: "Panels" })).toBeVisible();

    const initialSaver = useSavesStore.getState().saver;
    const attached: string[] = [];
    const unsubscribe = useSavesStore.subscribe((state) => {
      if (state.saver !== null && state.saver !== initialSaver) {
        attached.push(useLaunchStore.getState().worldId);
      }
    });

    onTestFinished(unsubscribe);
    expect(initialSaver).not.toBeNull();

    useLaunchStore.getState().createWorld(useLaunchStore.getState().launch);

    await expect.element(screen.getByRole("navigation", { name: "Panels" })).not.toBeInTheDocument();
    expect(useSavesStore.getState().saver).toBeNull();
    expect(attached).toEqual([]);
  });

  it("waits for the engine", async () => {
    showWorld();

    const screen = await render(<ReadyHud />);

    await loadHud();
    await nextFrame();

    expect(screen.container.childElementCount).toBe(0);
  });
});
