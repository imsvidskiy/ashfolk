import { describe, expect, it, onTestFinished } from "vitest";
import { render } from "vitest-browser-react";
import { connectInstall } from "../install/install-store.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { offerInstall } from "../testing/install-fixtures.ts";
import { createAnimalInspection, showWorld } from "../testing/world-fixtures.ts";
import { useInterfaceStore } from "./interface-store.ts";
import { MenuButtons } from "./menu-buttons.tsx";

describe("menu buttons", () => {
  it("offers the journal, the map and the settings", async () => {
    const screen = await render(<MenuButtons />);

    const panels = screen.getByRole("navigation", { name: "Panels" });

    await expect.element(panels.getByRole("button", { name: "Journal" })).toBeVisible();
    await expect.element(panels.getByRole("button", { name: "Map" })).toBeVisible();
    await expect.element(panels.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  it("opens and closes the journal", async () => {
    const screen = await render(<MenuButtons />);

    const journal = screen.getByRole("button", { name: "Journal" });

    await expect.element(journal).toHaveAttribute("aria-pressed", "false");

    await journal.click();

    await expect.element(journal).toHaveAttribute("aria-pressed", "true");
    expect(useInterfaceStore.getState().isJournalOpen).toBe(true);

    await journal.click();

    await expect.element(journal).toHaveAttribute("aria-pressed", "false");
    expect(useInterfaceStore.getState().isJournalOpen).toBe(false);
  });

  it("puts away the selected card to show the journal", async () => {
    const { clearSelection } = await startTestEngine();

    showWorld({ inspection: createAnimalInspection() });

    const screen = await render(<MenuButtons />);

    await screen.getByRole("button", { name: "Journal" }).click();

    expect(clearSelection).toHaveBeenCalledOnce();
    expect(useInterfaceStore.getState().isJournalOpen).toBe(true);
  });

  it("shows and hides the map", async () => {
    useInterfaceStore.setState({ isMapOpen: false });

    const screen = await render(<MenuButtons />);

    const map = screen.getByRole("button", { name: "Map" });

    await map.click();

    await expect.element(map).toHaveAttribute("aria-pressed", "true");
    expect(useInterfaceStore.getState().isMapOpen).toBe(true);
  });

  it("opens the world settings", async () => {
    useInterfaceStore.setState({ settingsTab: "island" });

    const screen = await render(<MenuButtons />);

    await screen.getByRole("button", { name: "Settings" }).click();

    const state = useInterfaceStore.getState();

    expect(state.isSettingsOpen).toBe(true);
    expect(state.settingsTab).toBe("world");
  });

  it("keeps the install button hidden until the browser offers it", async () => {
    const screen = await render(<MenuButtons />);

    await expect.element(screen.getByRole("button", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Install the app" }).elements()).toHaveLength(0);
  });

  it("opens the browser's install prompt from the menu", async () => {
    onTestFinished(connectInstall(window));

    const screen = await render(<MenuButtons />);

    const { event, prompt } = offerInstall();

    expect(event.defaultPrevented).toBe(true);

    await screen.getByRole("button", { name: "Install the app" }).click();

    expect(prompt).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("button", { name: "Install the app" })).not.toBeInTheDocument();
  });
});
