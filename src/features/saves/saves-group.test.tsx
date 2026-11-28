import { describe, expect, it, onTestFinished } from "vitest";
import { render } from "vitest-browser-react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { createTestSession } from "../testing/engine-fixtures.ts";
import { deleteSavedWorld, listSavedWorlds } from "./save-database.ts";
import { SavesGroup } from "./saves-group.tsx";
import { connectAutosave } from "./saves-store.ts";

async function connectWorld(): Promise<string> {
  const session = await createTestSession();
  const { launch, worldId } = useLaunchStore.getState();
  const disconnect = connectAutosave(session, { id: worldId, name: launch.name });

  onTestFinished(async () => {
    disconnect();
    await deleteSavedWorld(worldId);
  });

  return worldId;
}

describe("saves group", () => {
  it("says the world is not saved yet", async () => {
    const screen = await render(<SavesGroup />);

    await expect.element(screen.getByText("Not saved yet. The world saves itself every minute.")).toBeVisible();
  });

  it("saves the world now and says when", async () => {
    const worldId = await connectWorld();
    const screen = await render(<SavesGroup />);

    await screen.getByRole("button", { name: "Save now" }).click();

    await expect.element(screen.getByText("Saved just now. The world saves itself every minute.")).toBeVisible();
    expect(await listSavedWorlds()).toMatchObject([{ id: worldId }]);
  });

  it("saves the world and closes the settings before showing all worlds", async () => {
    const worldId = await connectWorld();

    useLaunchStore.setState({ isChoosingWorld: false });
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
