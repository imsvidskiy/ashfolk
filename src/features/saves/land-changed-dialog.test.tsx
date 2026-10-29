import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { SAVE_VERSION } from "../../simulation/saved-world.ts";
import { CHANGED_HEIGHT, startLoadedWorld, UNCHANGED_HEIGHT } from "../testing/land-change-fixtures.ts";
import { LandChangedDialog } from "./land-changed-dialog.tsx";
import { deleteSavedWorld, listSavedWorlds, writeSavedWorld } from "./save-database.ts";
import { useSavesStore } from "./saves-store.ts";

const initialSaves = useSavesStore.getState();
const initialLaunch = useLaunchStore.getState();

interface ShownWorldOptions {
  readonly isSavedPaused?: boolean;
}

async function showLoadedWorld(regrownHeight: number, { isSavedPaused = false }: ShownWorldOptions = {}) {
  const { saved, session } = await startLoadedWorld({ isSavedPaused, regrownHeight });
  const send = vi.spyOn(session, "send");

  await render(<LandChangedDialog />);

  return { saved, send, session };
}

afterEach(async () => {
  useSavesStore.setState(initialSaves, true);
  useLaunchStore.setState(initialLaunch, true);

  const worlds = await listSavedWorlds();

  await Promise.all(
    worlds.map((world) => {
      return deleteSavedWorld(world.id);
    })
  );
});

describe("the land changed dialog", () => {
  it("stays away when the land grows as it did", async () => {
    const { send } = await showLoadedWorld(UNCHANGED_HEIGHT);

    expect(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("pauses a world whose land changed and plays on when asked", async () => {
    const { send, session } = await showLoadedWorld(CHANGED_HEIGHT);

    await expect.element(page.getByRole("alertdialog", { name: "The land has changed" })).toBeVisible();
    expect(send).toHaveBeenCalledWith({ isPaused: true, type: "setPaused" });

    await page.getByRole("button", { name: "Play on" }).click();

    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(send).toHaveBeenLastCalledWith({ isPaused: false, type: "setPaused" });
    expect(useSavesStore.getState().acceptedLand).toBe(session);
  });

  it("keeps a world paused on Play on when it was saved paused", async () => {
    const { send, session } = await showLoadedWorld(CHANGED_HEIGHT, { isSavedPaused: true });

    expect(session.frame.isPaused).toBe(true);

    await page.getByRole("button", { name: "Play on" }).click();

    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalledWith({ isPaused: false, type: "setPaused" });
  });

  it("keeps a world paused on Play on when the launch asked for a pause", async () => {
    useLaunchStore.setState({ launch: { ...initialLaunch.launch, isPaused: true } });

    const { send, session } = await showLoadedWorld(CHANGED_HEIGHT);

    expect(session.frame.isPaused).toBe(false);

    await page.getByRole("button", { name: "Play on" }).click();

    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalledWith({ isPaused: false, type: "setPaused" });
  });

  it("marks the saved world as changed", async () => {
    const { worldId } = useLaunchStore.getState();
    const { saved } = await startLoadedWorld({ regrownHeight: CHANGED_HEIGHT });

    await writeSavedWorld(
      {
        generationFingerprint: saved.generationFingerprint,
        id: worldId,
        isLandChanged: false,
        name: "Old Ford",
        savedAt: Date.now(),
        seed: saved.request.seed,
        shape: saved.request.options.shape,
        summary: saved.summary,
        version: SAVE_VERSION,
      },
      saved,
      []
    );
    await render(<LandChangedDialog />);

    await expect
      .poll(async () => {
        return await listSavedWorlds();
      })
      .toMatchObject([{ hasLandChanged: true, id: worldId }]);
  });

  it("grows the same seed anew as another world", async () => {
    const { launch, worldId } = useLaunchStore.getState();

    await showLoadedWorld(CHANGED_HEIGHT);
    await page.getByRole("button", { name: "Grow anew" }).click();

    expect(useLaunchStore.getState().worldId).not.toBe(worldId);
    expect(useLaunchStore.getState().launch).toMatchObject({
      name: launch.name,
      seed: launch.seed,
      shape: launch.shape,
    });
  });
});
