import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { LaunchOptions } from "../../app/launch-options.ts";
import { useLaunchStore } from "../../app/launch-store.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { LARGEST_SEED } from "../new-world/seeds.ts";
import { IslandSection } from "./island-section.tsx";

const QUALITY_KEY = "dawnfolk.quality";
const LABELS_KEY = "dawnfolk.labels";
const WHOLE_NUMBER = /^\d+$/u;

const initialLaunch = useLaunchStore.getState();

function launchWith(changes: Partial<LaunchOptions>): void {
  useLaunchStore.setState({ launch: { ...initialLaunch.launch, ...changes } });
}

describe("island section", () => {
  it("starts at the quality the island was launched with", async () => {
    launchWith({ quality: "low" });

    const screen = await render(<IslandSection />);

    await expect.element(screen.getByRole("button", { name: "Light", pressed: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("remembers a new quality and offers to apply it", async () => {
    const screen = await render(<IslandSection />);

    await screen.getByRole("button", { name: "High" }).click();

    await expect.element(screen.getByRole("button", { name: "High", pressed: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(localStorage.getItem(QUALITY_KEY)).toBe("high");
  });

  it("turns the map labels off and on", async () => {
    const screen = await render(<IslandSection />);

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

  it("starts the seed field at the seed of the current world", async () => {
    launchWith({ seed: 7 });

    const screen = await render(<IslandSection />);

    await expect.element(screen.getByRole("textbox", { name: "Seed" })).toHaveValue("7");
    await expect.element(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("only creates worlds from seeds in the allowed range", async () => {
    launchWith({ seed: 7 });

    const screen = await render(<IslandSection />);

    const seed = screen.getByRole("textbox", { name: "Seed" });
    const create = screen.getByRole("button", { name: "Create" });

    await seed.fill("0");

    await expect.element(create).toBeDisabled();

    await seed.fill("island");

    await expect.element(create).toBeDisabled();

    await seed.fill(String(LARGEST_SEED + 1));

    await expect.element(create).toBeDisabled();

    await seed.fill("42");

    await expect.element(create).toBeEnabled();
  });

  it("rolls a random seed that can grow a world", async () => {
    const screen = await render(<IslandSection />);

    const seed = screen.getByRole("textbox", { name: "Seed" });
    const create = screen.getByRole("button", { name: "Create" });

    await seed.fill("");

    await expect.element(create).toBeDisabled();

    await screen.getByRole("button", { name: "Random seed" }).click();

    await expect.element(seed).toHaveValue(expect.stringMatching(WHOLE_NUMBER));
    await expect.element(create).toBeEnabled();
  });

  it("rebuilds the island with the chosen quality and closes the settings", async () => {
    useInterfaceStore.setState({ isSettingsOpen: true });

    const screen = await render(<IslandSection />);

    await screen.getByRole("button", { name: "High" }).click();
    await screen.getByRole("button", { name: "Apply" }).click();

    expect(useLaunchStore.getState().launch.quality).toBe("high");
    expect(useInterfaceStore.getState().isSettingsOpen).toBe(false);
  });

  it("grows a new world with a new name and shape", async () => {
    launchWith({ seed: 7 });

    const screen = await render(<IslandSection />);

    await screen.getByRole("textbox", { name: "Name" }).fill("Old Ford");
    await screen.getByRole("button", { name: "Square" }).click();
    await screen.getByRole("button", { name: "Create" }).click();

    expect(useLaunchStore.getState().launch).toMatchObject({ name: "Old Ford", seed: 7, shape: "square" });
  });

  it("grows a new world from the chosen seed", async () => {
    launchWith({ seed: 7 });

    const screen = await render(<IslandSection />);

    await screen.getByRole("textbox", { name: "Seed" }).fill("42");
    await screen.getByRole("button", { name: "Create" }).click();

    const { launch } = useLaunchStore.getState();

    expect(launch.seed).toBe(42);
    expect(launch.camera).toEqual({});
    expect(launch.isPaused).toBe(false);
  });
});
