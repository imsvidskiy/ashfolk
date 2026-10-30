import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CompactMenu } from "../interface/compact-menu.tsx";
import { MenuButtons } from "../interface/menu-buttons.tsx";
import { InstallGuideDialog } from "./install-guide-dialog.tsx";
import { connectInstall, useInstallStore } from "./install-store.ts";

function offerInstall() {
  const prompt = vi.fn(() => {
    return Promise.resolve();
  });
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });

  window.dispatchEvent(event);

  return { event, prompt };
}

describe("install", () => {
  it("keeps the install button hidden until the browser offers it", async () => {
    const screen = await render(<MenuButtons />);

    await expect.element(screen.getByRole("button", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Install the app" }).elements()).toHaveLength(0);
  });

  it("opens the browser's install prompt from the menu", async () => {
    const disconnect = connectInstall(window);
    const screen = await render(<MenuButtons />);

    const { event, prompt } = offerInstall();

    expect(event.defaultPrevented).toBe(true);
    await screen.getByRole("button", { name: "Install the app" }).click();

    expect(prompt).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("button", { name: "Install the app" })).not.toBeInTheDocument();
    disconnect();
  });

  it("forgets the offer once the app is installed", () => {
    const disconnect = connectInstall(window);

    offerInstall();
    window.dispatchEvent(new Event("appinstalled"));

    expect(useInstallStore.getState().prompt).toBeNull();
    disconnect();
  });

  it("explains the home screen where the browser has no prompt", async () => {
    useInstallStore.setState({ isGuideNeeded: true });

    const screen = await render(
      <>
        <CompactMenu />

        <InstallGuideDialog />
      </>
    );

    await screen.getByRole("button", { name: "Menu" }).click();
    await screen.getByRole("menuitem", { name: "Install the app" }).click();

    const guide = screen.getByRole("dialog", { name: "Install Dawnfolk" });

    await expect.element(guide).toBeVisible();
    await expect.element(guide.getByText("then Add to Home Screen", { exact: false })).toBeVisible();

    await screen.getByRole("button", { name: "Got it" }).click();

    await expect.element(guide).not.toBeInTheDocument();
  });
});
