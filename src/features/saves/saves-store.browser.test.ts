import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import { createTestSession } from "../testing/engine-fixtures.ts";
import { deleteSavedWorld, listSavedWorlds } from "./save-database.ts";
import { connectAutosave, saveBeforeLeaving, useSavesStore } from "./saves-store.ts";

const AUTOSAVE_MILLISECONDS = 60_000;
const IDENTITY = { id: "old-ford", name: "Old Ford" };

async function connectWorld() {
  const session = await createTestSession();
  const disconnect = connectAutosave(session, IDENTITY);

  onTestFinished(disconnect);

  return { disconnect, session };
}

function savedIds(): Promise<string[] | undefined> {
  return listSavedWorlds().then((worlds) => {
    return worlds?.map((world) => {
      return world.id;
    });
  });
}

afterEach(async () => {
  await deleteSavedWorld(IDENTITY.id);
});

describe("autosave", () => {
  it("saves the world every minute", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    await connectWorld();

    expect(await savedIds()).toEqual([]);

    vi.advanceTimersByTime(AUTOSAVE_MILLISECONDS);

    await expect.poll(savedIds).toEqual([IDENTITY.id]);
    expect(useSavesStore.getState().lastSavedAt).not.toBeNull();
  });

  it("saves the world when the page is hidden", async () => {
    const { session } = await connectWorld();
    const saveWorld = vi.spyOn(session, "saveWorld");

    document.dispatchEvent(new Event("visibilitychange"));

    expect(saveWorld).not.toHaveBeenCalled();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    await expect.poll(savedIds).toEqual([IDENTITY.id]);
  });

  it("saves the world when the page is left", async () => {
    await connectWorld();

    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    await expect.poll(savedIds).toEqual([IDENTITY.id]);
  });

  it("says when an autosave failed", async () => {
    const { session } = await connectWorld();

    vi.spyOn(console, "warn").mockImplementation(ignore);
    vi.spyOn(session, "saveWorld").mockRejectedValue(new Error("Saving is blocked"));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    await expect
      .poll(() => {
        return useSavesStore.getState().hasFailed;
      })
      .toBe(true);
  });

  it("lets go of its saver only while it is the current one", async () => {
    const first = await connectWorld();
    const second = await connectWorld();

    const { saver } = useSavesStore.getState();

    first.disconnect();

    expect(useSavesStore.getState().saver).toBe(saver);

    second.disconnect();

    expect(useSavesStore.getState().saver).toBeNull();
  });

  it("stops saving after disconnecting", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const { disconnect, session } = await connectWorld();
    const saveWorld = vi.spyOn(session, "saveWorld");

    disconnect();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(AUTOSAVE_MILLISECONDS);

    expect(saveWorld).not.toHaveBeenCalled();
    expect(await savedIds()).toEqual([]);
  });
});

describe("saving before leaving", () => {
  it("leaves while no world is open", async () => {
    const leave = vi.fn<() => void>();

    saveBeforeLeaving(leave);

    await vi.waitFor(() => {
      expect(leave).toHaveBeenCalledOnce();
    });
  });

  it("saves the open world before it leaves", async () => {
    await connectWorld();

    const leave = vi.fn<() => void>();

    saveBeforeLeaving(leave);

    expect(leave).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(leave).toHaveBeenCalledOnce();
    });
    expect(await savedIds()).toEqual([IDENTITY.id]);
  });
});
