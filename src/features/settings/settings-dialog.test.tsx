import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { version } from "../../../package.json";
import { FilmingHint } from "../filming/filming-hint.tsx";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { connectPowers } from "../powers/connect-powers.ts";
import { usePowerStore } from "../powers/power-store.ts";
import { useSavesStore } from "../saves/saves-store.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { showWorld } from "../testing/world-fixtures.ts";
import { SettingsDialog } from "./settings-dialog.tsx";

describe("settings dialog", () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it("keeps project links and the installed version visible when a long section scrolls", async () => {
    showWorld();
    await startTestEngine();
    useInterfaceStore.setState({ isSettingsOpen: true, settingsTab: "photo" });
    const screen = await render(<SettingsDialog />);

    const project = screen.getByRole("navigation", { name: "Project" }).element();
    const panel = screen.getByRole("tabpanel").element();
    const { top } = project.getBoundingClientRect();

    panel.scrollTop = panel.scrollHeight;
    expect(panel.scrollTop).toBeGreaterThan(0);
    expect(project.getBoundingClientRect().top).toBe(top);
    await expect.element(screen.getByText(`v${version}`)).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Privacy" })).toBeVisible();
  });

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

    await expect.element(sections.getByRole("tab", { name: "General", selected: true })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "World rules" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Weather" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Time & seasons" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Island & saves" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Sound" })).toBeVisible();
    await expect.element(sections.getByRole("tab", { name: "Photo mode" })).toBeVisible();
  });

  it("switches sections from its tabs and remembers the choice", async () => {
    showWorld();
    useInterfaceStore.getState().openSettings();

    const screen = await render(<SettingsDialog />);

    expect(screen.getByRole("slider", { name: "Time of day" }).elements()).toHaveLength(0);

    await screen.getByRole("tab", { name: "Time & seasons" }).click();

    await expect.element(screen.getByRole("slider", { name: "Time of day" })).toBeInTheDocument();
    expect(useInterfaceStore.getState().settingsTab).toBe("time");
  });

  it("switches sections on a narrow screen", async () => {
    await page.viewport(390, 844);
    showWorld();
    useInterfaceStore.getState().openSettings();

    const screen = await render(<SettingsDialog />);
    const sections = screen.getByRole("combobox", { name: "Settings section" });

    await sections.selectOptions("weather");

    await expect.element(screen.getByRole("slider", { name: "Wind from" })).toBeInTheDocument();
    expect(useInterfaceStore.getState().settingsTab).toBe("weather");
  });

  it("keeps a pending quality change when saving fails and explains how to retry", async () => {
    useInterfaceStore.getState().openSettings();
    useSavesStore.setState({
      saveNow: () => {
        useSavesStore.setState({ saveProblem: "busy" });
        return Promise.resolve("busy");
      },
    });

    const screen = await render(<SettingsDialog />);

    await screen.getByRole("button", { name: "High" }).click();
    await screen.getByRole("button", { name: "Apply" }).click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(
        "The island is still changing. Return to play, resume time and try again when the effect ends."
      );
    await expect.element(screen.getByRole("button", { name: "High", pressed: true })).toBeVisible();
    expect(localStorage.getItem("ashfolk.quality")).toBeNull();
    expect(useInterfaceStore.getState().isSettingsOpen).toBe(true);

    useSavesStore.setState({ saveProblem: "failed" });

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Your changes could not be saved. Check browser storage and try again.");
  });

  it("keeps the newly opened rule heading in view on a phone after a taller group closes", async () => {
    await page.viewport(320, 700);
    showWorld();
    useInterfaceStore.setState({ isSettingsOpen: true, settingsTab: "world" });

    const screen = await render(<SettingsDialog />);
    const section = screen.getByRole("region", { name: "World rules" }).element();
    const people = screen.getByRole("group", { name: "People" });
    const heading = people.getByText("People", { exact: true });

    await screen.getByText("Fire", { exact: true }).click();
    heading.element().scrollIntoView({ block: "center" });
    await heading.click();

    await expect.element(people).toHaveAttribute("open");
    await expect
      .poll(() => {
        return heading.element().getBoundingClientRect().top;
      })
      .toBeGreaterThanOrEqual(section.getBoundingClientRect().top);
  });

  it("closes from its close button", async () => {
    useInterfaceStore.getState().openSettings();

    const screen = await render(<SettingsDialog />);

    await screen.getByRole("button", { name: "Close the settings" }).click();

    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(useInterfaceStore.getState().isSettingsOpen).toBe(false);
  });

  it("keeps game shortcuts out of the open dialog", async () => {
    const { engine } = await startTestEngine();

    onTestFinished(connectPowers(engine));
    usePowerStore.getState().selectPower("meteor");
    useInterfaceStore.getState().openSettings();

    const screen = await render(
      <>
        <SettingsDialog />
        <FilmingHint />
      </>
    );

    await screen.getByRole("tab", { name: "General" }).click();
    await userEvent.keyboard("h{Escape}");

    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(engine.filming.settings.isInterfaceHidden).toBe(false);
    expect(usePowerStore.getState().selectedPowerId).toBe("meteor");
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
