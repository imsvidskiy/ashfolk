import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { blockSavedWorlds } from "../features/testing/save-fixtures.ts";
import { useLaunchStore } from "./launch-store.ts";
import { StartScreen } from "./start-screen.tsx";

const initialLaunch = useLaunchStore.getState();

describe("start screen", () => {
  it("offers a named round world from a random seed", async () => {
    const screen = await render(<StartScreen />);

    await expect.element(screen.getByRole("textbox", { name: "Name" })).toHaveValue(initialLaunch.launch.name);
    await expect.element(screen.getByRole("button", { name: "Round", pressed: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Normal", pressed: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Grow the island" })).toBeEnabled();
  });

  it("needs a name before the island can grow", async () => {
    const screen = await render(<StartScreen />);

    await screen.getByRole("textbox", { name: "Name" }).fill("  ");

    await expect.element(screen.getByRole("button", { name: "Grow the island" })).toBeDisabled();

    await screen.getByRole("button", { name: "Random name" }).click();

    await expect.element(screen.getByRole("button", { name: "Grow the island" })).toBeEnabled();
  });

  it("grows the world at the chosen size", async () => {
    const screen = await render(<StartScreen />);

    await screen.getByRole("button", { name: "Large" }).click();
    await screen.getByRole("button", { name: "Grow the island" }).click();

    expect(useLaunchStore.getState().launch.size).toBe("large");
    expect(new URLSearchParams(window.location.search).get("size")).toBe("large");
  });

  it("grows the named world in the chosen shape", async () => {
    useLaunchStore.setState({ isChoosingWorld: true });

    const screen = await render(<StartScreen />);

    await screen.getByRole("textbox", { name: "Name" }).fill("Old Ford");
    await screen.getByRole("button", { name: "Square" }).click();
    await screen.getByRole("textbox", { name: "Seed" }).fill("42");
    await screen.getByRole("button", { name: "Grow the island" }).click();

    const { isChoosingWorld, launch } = useLaunchStore.getState();

    expect(isChoosingWorld).toBe(false);
    expect(launch).toMatchObject({ name: "Old Ford", seed: 42, shape: "square" });
  });

  it("says saved worlds are unavailable when the browser blocks them", async () => {
    await blockSavedWorlds();

    const screen = await render(<StartScreen />);

    await expect.element(screen.getByText("Saved worlds are unavailable in this browser.")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Grow the island" })).toBeEnabled();
  });
});
