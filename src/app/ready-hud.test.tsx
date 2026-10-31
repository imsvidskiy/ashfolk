import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { startTestEngine } from "../features/testing/engine-fixtures.ts";
import { showWorld } from "../features/testing/world-fixtures.ts";
import { loadHud } from "./engine-launcher.ts";
import { ReadyHud } from "./ready-hud.tsx";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

describe("ready hud", () => {
  it("waits for the engine", async () => {
    showWorld();

    const screen = await render(<ReadyHud />);

    await loadHud();
    await nextFrame();

    expect(screen.container.childElementCount).toBe(0);
  });

  it("shows the hud in the frame the engine becomes ready", async () => {
    await page.viewport(1440, 900);

    showWorld();

    const screen = await render(<ReadyHud />);

    await loadHud();
    await nextFrame();
    await startTestEngine();
    await nextFrame();

    expect(screen.getByRole("navigation", { name: "Panels" }).query()).not.toBeNull();
  });
});
