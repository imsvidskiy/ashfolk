import { describe, expect, it, onTestFinished, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CompactMenu } from "../interface/compact-menu.tsx";
import { MenuButtons } from "../interface/menu-buttons.tsx";
import { InstallGuideDialog } from "./install-guide-dialog.tsx";
import { connectInstall, useInstallStore } from "./install-store.ts";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0";

function pretendToBeIphone(userAgent: string): void {
  Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

  onTestFinished(() => {
    Reflect.deleteProperty(navigator, "standalone");
  });
}

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

  it("offers the home screen guide in Safari on iPhone", () => {
    pretendToBeIphone(IPHONE_SAFARI);

    const disconnect = connectInstall(window);

    expect(useInstallStore.getState().isGuideNeeded).toBe(true);
    disconnect();
  });

  it("offers no home screen guide in an app's own browser", () => {
    pretendToBeIphone(IPHONE_INSTAGRAM);

    const disconnect = connectInstall(window);

    expect(useInstallStore.getState().isGuideNeeded).toBe(false);
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
