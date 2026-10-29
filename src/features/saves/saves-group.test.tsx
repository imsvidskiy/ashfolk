import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { ignore } from "../../shared/ignore.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { createTestSession } from "../testing/engine-fixtures.ts";
import { deleteSavedWorld, listSavedWorlds } from "./save-database.ts";
import { SavesGroup } from "./saves-group.tsx";
import { connectAutosave, useSavesStore } from "./saves-store.ts";

const initialSaves = useSavesStore.getState();
const disconnects: (() => void)[] = [];

async function connectWorld() {
  const session = await createTestSession();
  const { launch, worldId } = useLaunchStore.getState();

  disconnects.push(connectAutosave(session, { id: worldId, name: launch.name }));

  return { session, worldId };
}

afterEach(async () => {
  for (const disconnect of disconnects.splice(0)) {
    disconnect();
  }

  useSavesStore.setState(initialSaves, true);
  await deleteSavedWorld(useLaunchStore.getState().worldId);
});

describe("saves group", () => {
  it("says the world is not saved yet", async () => {
    const screen = await render(<SavesGroup />);

    await expect.element(screen.getByText("Not saved yet. The world saves itself every minute.")).toBeVisible();
  });

  it("saves the world now and says when", async () => {
    const { worldId } = await connectWorld();
    const screen = await render(<SavesGroup />);

    await screen.getByRole("button", { name: "Save now" }).click();

    await expect.element(screen.getByText("Saved just now. The world saves itself every minute.")).toBeVisible();
    expect(await listSavedWorlds()).toMatchObject([{ id: worldId }]);
  });

  it("says when the save failed", async () => {
    const { session } = await connectWorld();

    vi.spyOn(console, "warn").mockImplementation(ignore);
    vi.spyOn(session, "saveWorld").mockRejectedValue(new Error("Saving is blocked"));

    const screen = await render(<SavesGroup />);

    await screen.getByRole("button", { name: "Save now" }).click();

    await expect
      .element(
        screen.getByText("The last save failed. This browser may block saving, for example in a private window.")
      )
      .toBeVisible();
  });

  it("saves the world and closes the settings before showing all worlds", async () => {
    const { worldId } = await connectWorld();

    useInterfaceStore.setState({ isSettingsOpen: true });

    const screen = await render(<SavesGroup />);

    await screen.getByRole("button", { name: "All worlds" }).click();

    await expect
      .poll(() => {
        return useLaunchStore.getState().isChoosingWorld;
      })
      .toBe(true);
    expect(useInterfaceStore.getState().isSettingsOpen).toBe(false);
    expect(await listSavedWorlds()).toMatchObject([{ id: worldId }]);
  });
});
