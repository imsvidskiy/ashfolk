import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CompactMenu } from "./compact-menu.tsx";
import { useInterfaceStore } from "./interface-store.ts";

function allowFullscreen(element: Element | null): void {
  vi.spyOn(document, "fullscreenEnabled", "get").mockReturnValue(true);
  vi.spyOn(document, "fullscreenElement", "get").mockReturnValue(element);
}

describe("compact menu", () => {
  it("keeps its entries hidden until it is opened", async () => {
    const screen = await render(<CompactMenu />);

    await expect.element(screen.getByRole("button", { name: "Menu" })).toBeVisible();
    expect(screen.getByRole("menu").elements()).toHaveLength(0);
  });

  it("opens the journal on the tribes", async () => {
    useInterfaceStore.setState({ journalTab: "chronicle" });

    const screen = await render(<CompactMenu />);

    await screen.getByRole("button", { name: "Menu" }).click();
    await screen.getByRole("menuitem", { name: "Journal" }).click();

    const state = useInterfaceStore.getState();

    expect(state.isJournalOpen).toBe(true);
    expect(state.journalTab).toBe("tribes");
  });

  it("shows the map and then offers to hide it", async () => {
    useInterfaceStore.setState({ isMapOpen: false });

    const screen = await render(<CompactMenu />);

    await screen.getByRole("button", { name: "Menu" }).click();
    await screen.getByRole("menuitem", { name: "Show the map" }).click();

    expect(useInterfaceStore.getState().isMapOpen).toBe(true);

    await screen.getByRole("button", { name: "Menu" }).click();

    await expect.element(screen.getByRole("menuitem", { name: "Hide the map" })).toBeVisible();
  });

  it("opens the world settings", async () => {
    const screen = await render(<CompactMenu />);

    await screen.getByRole("button", { name: "Menu" }).click();
    await screen.getByRole("menuitem", { name: "Settings" }).click();

    const state = useInterfaceStore.getState();

    expect(state.isSettingsOpen).toBe(true);
    expect(state.settingsTab).toBe("world");
  });

  it("offers full screen when the page is not in full screen", async () => {
    allowFullscreen(null);

    const screen = await render(<CompactMenu />);

    await screen.getByRole("button", { name: "Menu" }).click();

    await expect.element(screen.getByRole("menuitem", { name: "Full screen" })).toBeVisible();
  });

  it("offers to leave full screen while the page is in full screen", async () => {
    allowFullscreen(document.documentElement);

    const screen = await render(<CompactMenu />);

    await screen.getByRole("button", { name: "Menu" }).click();

    await expect.element(screen.getByRole("menuitem", { name: "Leave full screen" })).toBeVisible();
  });
});
