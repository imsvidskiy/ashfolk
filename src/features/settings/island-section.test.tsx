import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { LaunchOptions } from "../../app/launch-options.ts";
import { useLaunchStore } from "../../app/launch-store.ts";
import { LARGEST_SEED } from "../new-world/seeds.ts";
import { IslandSection } from "./island-section.tsx";

const WHOLE_NUMBER = /^\d+$/u;

const initialLaunch = useLaunchStore.getState();

function launchWith(changes: Partial<LaunchOptions>): void {
  useLaunchStore.setState({ launch: { ...initialLaunch.launch, ...changes } });
}

describe("island section", () => {
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

  it("starts the chosen world with a fresh camera and running clock", async () => {
    launchWith({ camera: { distance: 90 }, isPaused: true, seed: 7 });

    const screen = await render(<IslandSection />);

    await screen.getByRole("textbox", { name: "Name" }).fill("Old Ford");
    await screen.getByRole("textbox", { name: "Seed" }).fill("42");
    await screen.getByRole("button", { name: "Square" }).click();
    await screen.getByRole("button", { name: "Small" }).click();
    await screen.getByRole("button", { name: "Create" }).click();

    const { launch } = useLaunchStore.getState();

    expect(launch.camera).toEqual({});
    expect(launch).toMatchObject({
      isPaused: false,
      name: "Old Ford",
      seed: 42,
      shape: "square",
      size: "small",
    });
  });
});
