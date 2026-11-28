import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { blockSavedWorlds, createSavedListing, deleteAllSavedWorlds, saveWorld } from "../testing/save-fixtures.ts";
import { listSavedWorlds } from "./save-database.ts";
import { SavedWorldList } from "./saved-world-list.tsx";
import { useSavesStore } from "./saves-store.ts";

afterEach(async () => {
  vi.restoreAllMocks();

  await deleteAllSavedWorlds();
});

describe("saved world list", () => {
  it("lists each world with its people and when it was saved", async () => {
    useSavesStore.setState({
      worlds: [
        createSavedListing(),
        createSavedListing({ hasLandChanged: true, id: "ashvale", name: "Ashvale" }),
        createSavedListing({ id: "mossholm", isLoadable: false, name: "Mossholm", summary: null }),
      ],
    });

    const screen = await render(<SavedWorldList />);

    await expect.element(screen.getByRole("button", { name: "Old Ford 12 people · just now" })).toBeEnabled();
    await expect.element(screen.getByRole("button", { name: "Ashvale The land has changed · just now" })).toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Mossholm Saved by another version of Ashfolk · just now" }))
      .toBeDisabled();
  });

  it("opens a world with its name, seed, shape and size", async () => {
    useSavesStore.setState({ worlds: [createSavedListing()] });

    const screen = await render(<SavedWorldList />);

    await screen.getByRole("button", { name: "Old Ford 12 people · just now" }).click();

    const { isChoosingWorld, launch, worldId } = useLaunchStore.getState();

    expect(isChoosingWorld).toBe(false);
    expect(worldId).toBe("old-ford");
    expect(launch).toMatchObject({ name: "Old Ford", seed: 42, shape: "square", size: "small" });
  });

  it("asks before deleting a world and keeps it on second thought", async () => {
    await saveWorld("old-ford", "Old Ford");
    await useSavesStore.getState().refresh();

    const screen = await render(<SavedWorldList />);

    await screen.getByRole("button", { name: "Delete Old Ford" }).click();

    await expect.element(screen.getByText("Delete Old Ford?")).toBeVisible();

    await screen.getByRole("button", { name: "Keep" }).click();

    await expect.element(screen.getByRole("button", { name: "Delete Old Ford" })).toBeVisible();
    expect(await listSavedWorlds()).toMatchObject([{ id: "old-ford" }]);
  });

  it("deletes a world once the deletion is confirmed", async () => {
    await saveWorld("old-ford", "Old Ford");
    await saveWorld("ashvale", "Ashvale");
    await useSavesStore.getState().refresh();

    const screen = await render(<SavedWorldList />);

    await screen.getByRole("button", { name: "Delete Old Ford" }).click();
    await screen.getByRole("button", { exact: true, name: "Delete" }).click();

    await expect.element(screen.getByRole("button", { name: "Delete Old Ford" })).not.toBeInTheDocument();
    expect(await listSavedWorlds()).toMatchObject([{ id: "ashvale" }]);
  });

  it("says saved worlds are unavailable when the browser blocks them", async () => {
    await blockSavedWorlds();
    await useSavesStore.getState().refresh();

    const screen = await render(<SavedWorldList />);

    await expect.element(screen.getByText("Saved worlds are unavailable in this browser.")).toBeVisible();
    expect(screen.getByRole("list")).not.toBeInTheDocument();
  });
});
