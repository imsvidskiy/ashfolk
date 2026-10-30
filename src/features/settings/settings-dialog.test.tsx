import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { showWorld } from "../testing/world-fixtures.ts";
import { SettingsDialog } from "./settings-dialog.tsx";

describe("settings dialog", () => {
  it("stays closed until the settings are opened", async () => {
    const screen = await render(<SettingsDialog />);

    expect(screen.getByRole("dialog").elements()).toHaveLength(0);
  });

  it("opens on the section chosen in the interface", async () => {
    showWorld();
    useInterfaceStore.setState({ isSettingsOpen: true, settingsTab: "weather" });

    const screen = await render(<SettingsDialog />);

    await expect.element(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect.element(screen.getByRole("tab", { name: "Weather", selected: true })).toBeVisible();
    await expect.element(screen.getByRole("slider", { name: "Wind from" })).toBeInTheDocument();
  });

  it("offers a tab for each section", async () => {
    showWorld();
    useInterfaceStore.getState().openSettings();

    const screen = await render(<SettingsDialog />);

    const sections = screen.getByRole("tablist", { name: "Settings sections" });

    await expect.element(sections.getByRole("tab", { name: "World" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Weather" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Time" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Island" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Dev" })).toBeVisible();
  });

  it("switches sections from its tabs and remembers the choice", async () => {
    showWorld();
    useInterfaceStore.getState().openSettings();

    const screen = await render(<SettingsDialog />);

    expect(screen.getByRole("slider", { name: "Time of day" }).elements()).toHaveLength(0);

    await screen.getByRole("tab", { name: "Time" }).click();

    await expect.element(screen.getByRole("slider", { name: "Time of day" })).toBeInTheDocument();
    expect(useInterfaceStore.getState().settingsTab).toBe("time");
  });

  it("closes from its close button", async () => {
    useInterfaceStore.getState().openSettings();

    const screen = await render(<SettingsDialog />);

    await screen.getByRole("button", { name: "Close the settings" }).click();

    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(useInterfaceStore.getState().isSettingsOpen).toBe(false);
  });

  it("closes with the Escape key", async () => {
    useInterfaceStore.getState().openSettings();

    const screen = await render(<SettingsDialog />);

    await expect.element(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();

    await userEvent.keyboard("{Escape}");

    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(useInterfaceStore.getState().isSettingsOpen).toBe(false);
  });
});
