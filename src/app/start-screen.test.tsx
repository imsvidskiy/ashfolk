import { describe, expect, it, onTestFinished, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useSavesStore } from "../features/saves/saves-store.ts";
import { blockSavedWorlds, deleteAllSavedWorlds, saveWorld } from "../features/testing/save-fixtures.ts";
import { ignore } from "../shared/ignore.ts";
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

  it("offers the saved world without showing the new-world form first", async () => {
    onTestFinished(deleteAllSavedWorlds);
    await saveWorld("old-ford", "Old Ford");

    const screen = await render(<StartScreen />);

    expect(screen.getByRole("button", { name: "Grow the island" }).query()).toBeNull();
    await expect.element(screen.getByRole("button", { name: "Continue Old Ford" })).toBeVisible();
  });

  it("offers the saved worlds it already knows at once when the player comes back", async () => {
    onTestFinished(deleteAllSavedWorlds);
    await saveWorld("old-ford", "Old Ford");
    await useSavesStore.getState().refresh();

    const screen = await render(<StartScreen />);

    expect(screen.getByRole("button", { name: "Continue Old Ford" }).query()).not.toBeNull();
  });

  it("keeps the title visible while checking saved worlds and avoids flashing the new-world form", async () => {
    let listWorlds = ignore;
    const { refresh } = useSavesStore.getState();

    useSavesStore.setState({
      refresh: vi.fn(() => {
        return new Promise<void>((resolve) => {
          listWorlds = resolve;
        });
      }),
      worlds: [],
    });
    onTestFinished(() => {
      useSavesStore.setState({ refresh });
    });

    const screen = await render(<StartScreen />);

    await expect.element(screen.getByRole("heading", { name: "Ashfolk" })).toBeVisible();
    await expect.element(screen.getByRole("status")).toHaveTextContent("Finding your worlds…");
    expect(screen.getByRole("form", { name: "New world" }).query()).toBeNull();

    listWorlds();
    await expect.element(screen.getByRole("form", { name: "New world" })).toBeVisible();
  });

  it("returns keyboard focus to the world menu and continues the chosen save", async () => {
    onTestFinished(deleteAllSavedWorlds);
    await saveWorld("old-ford", "Old Ford");

    const screen = await render(<StartScreen />);
    const allWorlds = screen.getByRole("button", { name: "All worlds" });

    await allWorlds.click();
    await expect.element(screen.getByRole("heading", { name: "Your worlds" })).toHaveFocus();
    await expect.element(screen.getByRole("list", { name: "Your worlds" })).toBeVisible();
    await screen.getByRole("button", { name: "Back" }).click();
    await expect.element(allWorlds).toHaveFocus();

    await screen.getByRole("button", { name: "New world" }).click();
    await expect.element(screen.getByRole("heading", { name: "New world" })).toHaveFocus();
    await screen.getByRole("button", { name: "Back" }).click();
    await expect.element(screen.getByRole("button", { name: "New world" })).toHaveFocus();

    await screen.getByRole("button", { name: "Continue Old Ford" }).click();
    expect(useLaunchStore.getState().request.savedWorldId).toBe("old-ford");
  });

  it("keeps older worlds discoverable and offers a new island when none can be opened", async () => {
    onTestFinished(deleteAllSavedWorlds);
    await saveWorld("old-ford", "Old Ford");
    const screen = await render(<StartScreen />);

    await expect.element(screen.getByRole("button", { name: "Continue Old Ford" })).toBeVisible();
    const worlds = useSavesStore.getState().worlds.map((world) => {
      return { ...world, isLoadable: false, summary: null };
    });

    useSavesStore.setState({ worlds });
    await expect.element(screen.getByText("These saved worlds can’t be opened in this version.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue Old Ford" }).query()).toBeNull();

    await screen.getByRole("button", { name: "All worlds" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Old Ford Saved by another version of Ashfolk · just now" }))
      .toBeDisabled();
    await screen.getByRole("button", { name: "Back" }).click();
    await screen.getByRole("button", { name: "New world" }).click();
    await expect.element(screen.getByRole("button", { name: "Grow the island" })).toBeEnabled();
  });

  it("says saved worlds are unavailable when the browser blocks them", async () => {
    await blockSavedWorlds();

    const screen = await render(<StartScreen />);

    await expect.element(screen.getByText("Saved worlds are unavailable in this browser.")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Grow the island" })).toBeEnabled();
  });
});
