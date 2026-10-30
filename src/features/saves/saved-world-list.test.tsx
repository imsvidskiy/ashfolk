import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { ignore } from "../../shared/ignore.ts";
import { createTestSession } from "../testing/engine-fixtures.ts";
import { blockSavedWorlds, deleteAllSavedWorlds } from "../testing/save-fixtures.ts";
import { listSavedWorlds, type SavedWorldListing } from "./save-database.ts";
import { SavedWorldList } from "./saved-world-list.tsx";
import { useSavesStore } from "./saves-store.ts";
import { WorldSaver } from "./world-saver.ts";

const initialSaves = useSavesStore.getState();

const SUMMARY = {
  day: 3,
  eraIndex: 0,
  eraName: "Stone Age",
  population: 12,
  seasonName: "Spring",
  tribeCount: 1,
  year: 1,
};

function listing(changes: Partial<SavedWorldListing>): SavedWorldListing {
  return {
    hasLandChanged: false,
    id: "old-ford",
    isLoadable: true,
    name: "Old Ford",
    savedAt: Date.now(),
    seed: 42,
    shape: "square",
    size: "small",
    summary: SUMMARY,
    ...changes,
  };
}

async function saveWorld(id: string, name: string): Promise<void> {
  const session = await createTestSession();

  await new WorldSaver(session, { id, name }, { onSaved: ignore, onSaving: ignore }).save();
  await useSavesStore.getState().refresh();
}

afterEach(async () => {
  vi.restoreAllMocks();
  useSavesStore.setState(initialSaves, true);

  await deleteAllSavedWorlds();
});

describe("saved world list", () => {
  it("lists each world with its people and when it was saved", async () => {
    useSavesStore.setState({
      worlds: [
        listing({}),
        listing({ hasLandChanged: true, id: "ashvale", name: "Ashvale" }),
        listing({ id: "mossholm", isLoadable: false, name: "Mossholm", summary: null }),
      ],
    });

    const screen = await render(<SavedWorldList />);

    await expect.element(screen.getByRole("button", { name: "Old Ford 12 people · just now" })).toBeEnabled();
    await expect.element(screen.getByRole("button", { name: "Ashvale The land has changed · just now" })).toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Mossholm Saved by another version of Dawnfolk · just now" }))
      .toBeDisabled();
  });

  it("opens a world with its name, seed, shape and size", async () => {
    useSavesStore.setState({ worlds: [listing({})] });

    const screen = await render(<SavedWorldList />);

    await screen.getByRole("button", { name: "Old Ford 12 people · just now" }).click();

    const { isChoosingWorld, launch, worldId } = useLaunchStore.getState();

    expect(isChoosingWorld).toBe(false);
    expect(worldId).toBe("old-ford");
    expect(launch).toMatchObject({ name: "Old Ford", seed: 42, shape: "square", size: "small" });
  });

  it("asks before deleting a world and keeps it on second thought", async () => {
    await saveWorld("old-ford", "Old Ford");

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
