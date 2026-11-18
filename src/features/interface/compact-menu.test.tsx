import { describe, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { connectInstall } from "../install/install-store.ts";
import { offerInstall } from "../testing/install-fixtures.ts";
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

  it("separates both groups and restores keyboard focus to the compact trigger", async () => {
    const screen = await render(<CompactMenu />);
    const trigger = screen.getByRole("button", { name: "Menu" });

    await trigger.click();

    const views = screen.getByRole("group", { name: "World views" });
    const controls = screen.getByRole("group", { name: "Game controls" });

    await expect.element(views.getByRole("menuitem", { name: "Journal" })).toBeVisible();
    await expect.element(controls.getByRole("menuitem", { name: "Settings" })).toBeVisible();

    await userEvent.keyboard("{Escape}");

    await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  it("adds installation as its own final menu section when the browser offers it", async () => {
    onTestFinished(connectInstall(window));

    const screen = await render(<CompactMenu />);

    await screen.getByRole("button", { name: "Menu" }).click();

    const installer = screen.getByRole("group", { name: "App installation" });

    await expect.element(installer).not.toBeInTheDocument();

    const { prompt } = offerInstall();
    const entry = installer.getByRole("menuitem", { name: "Install the app" });

    await expect.element(entry).toBeVisible();

    await userEvent.keyboard("{End}");
    await expect.element(entry).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(prompt).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
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
    await screen.getByRole("menuitemcheckbox", { checked: false, name: "Map" }).click();

    expect(useInterfaceStore.getState().isMapOpen).toBe(true);

    await screen.getByRole("button", { name: "Menu" }).click();

    await expect.element(screen.getByRole("menuitemcheckbox", { checked: true, name: "Map" })).toBeVisible();
  });

  it("reopens the last settings section", async () => {
    useInterfaceStore.setState({ settingsTab: "island" });

    const screen = await render(<CompactMenu />);

    await screen.getByRole("button", { name: "Menu" }).click();
    await screen.getByRole("menuitem", { name: "Settings" }).click();

    const state = useInterfaceStore.getState();

    expect(state.isSettingsOpen).toBe(true);
    expect(state.settingsTab).toBe("island");
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
