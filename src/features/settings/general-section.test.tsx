import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { LaunchOptions } from "../../app/launch-options.ts";
import { useLaunchStore } from "../../app/launch-store.ts";
import { useGuideStore } from "../guide/guide-store.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { GeneralSection } from "./general-section.tsx";

const QUALITY_KEY = "ashfolk.quality";
const LABELS_KEY = "ashfolk.labels";
const OUTLINES_KEY = "ashfolk.outlines";

const initialLaunch = useLaunchStore.getState();

function launchWith(changes: Partial<LaunchOptions>): void {
  useLaunchStore.setState({ launch: { ...initialLaunch.launch, ...changes } });
}

describe("general settings", () => {
  it("starts at the quality the island was launched with", async () => {
    launchWith({ quality: "low" });

    const screen = await render(<GeneralSection />);

    await expect.element(screen.getByRole("button", { name: "Light", pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply" }).elements()).toHaveLength(0);
  });

  it("previews a quality choice until it is applied", async () => {
    const screen = await render(<GeneralSection />);

    await screen.getByRole("button", { name: "High" }).click();

    await expect.element(screen.getByRole("button", { name: "High", pressed: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(localStorage.getItem(QUALITY_KEY)).toBeNull();
  });

  it("turns the map labels off and on", async () => {
    const screen = await render(<GeneralSection />);

    const labels = screen.getByRole("switch", { name: "Map labels" });

    await expect.element(labels).toBeChecked();

    await labels.click();

    await expect.element(labels).not.toBeChecked();
    expect(useInterfaceStore.getState().areLabelsShown).toBe(false);
    expect(localStorage.getItem(LABELS_KEY)).toBe("hidden");

    await labels.click();

    await expect.element(labels).toBeChecked();
    expect(useInterfaceStore.getState().areLabelsShown).toBe(true);
  });

  it("turns the outlines off and on", async () => {
    const screen = await render(<GeneralSection />);

    const outlines = screen.getByRole("switch", { name: "Outlines" });

    await expect.element(outlines).toBeChecked();

    await outlines.click();

    await expect.element(outlines).not.toBeChecked();
    expect(useInterfaceStore.getState().areOutlinesShown).toBe(false);
    expect(localStorage.getItem(OUTLINES_KEY)).toBe("hidden");

    await outlines.click();

    await expect.element(outlines).toBeChecked();
    expect(useInterfaceStore.getState().areOutlinesShown).toBe(true);
  });

  it("rebuilds the island with the chosen quality and closes the settings", async () => {
    useInterfaceStore.setState({ isSettingsOpen: true });

    const screen = await render(<GeneralSection />);

    await screen.getByRole("button", { name: "High" }).click();
    await screen.getByRole("button", { name: "Apply" }).click();

    expect(localStorage.getItem(QUALITY_KEY)).toBe("high");
    expect(useLaunchStore.getState().launch.quality).toBe("high");
    expect(useInterfaceStore.getState().isSettingsOpen).toBe(false);
  });

  it("restarts the island guide and returns to play", async () => {
    useGuideStore.getState().setTipsShown(false);
    useInterfaceStore.setState({ isSettingsOpen: true });

    const screen = await render(<GeneralSection />);

    await screen.getByRole("button", { name: "Restart guide" }).click();

    expect(useGuideStore.getState().progress.isOff).toBe(false);
    expect(useGuideStore.getState().progress.done).toEqual([]);
    expect(useInterfaceStore.getState().isSettingsOpen).toBe(false);
  });
});
