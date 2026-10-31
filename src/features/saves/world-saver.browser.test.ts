import { afterEach, describe, expect, it, vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import { createTestSession } from "../testing/engine-fixtures.ts";
import { deleteSavedWorld, listSavedWorlds, readSavedWorld } from "./save-database.ts";
import { WorldSaver } from "./world-saver.ts";

const IDENTITY = { id: "old-ford", name: "Old Ford" };

async function createSaver() {
  const session = await createTestSession();
  const onSaved = vi.fn<(savedAt: number) => void>();
  const onSaving = vi.fn<(isSaving: boolean) => void>();

  return { onSaved, onSaving, saver: new WorldSaver(session, IDENTITY, { onSaved, onSaving }), session };
}

afterEach(async () => {
  await deleteSavedWorld(IDENTITY.id);
});

describe("world saver", () => {
  it("saves the world under its name and reports the time", async () => {
    const { onSaved, onSaving, saver } = await createSaver();

    expect(await saver.save()).toBe("saved");

    const stored = await readSavedWorld(IDENTITY.id);

    expect(stored?.record).toMatchObject({ id: IDENTITY.id, isLandChanged: false, name: IDENTITY.name });
    expect(onSaved).toHaveBeenCalledWith(stored?.record.savedAt);
    expect(onSaving.mock.calls).toEqual([[true], [false]]);
  });

  it("skips a save while nothing has changed since the last one", async () => {
    const { onSaved, saver, session } = await createSaver();

    await saver.save();

    expect(await saver.save()).toBe("unchanged");

    session.send({ isPaused: true, type: "setPaused" });

    expect(await saver.save()).toBe("saved");
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("shares one save between callers that ask at once", async () => {
    const { saver, session } = await createSaver();
    const saveWorld = vi.spyOn(session, "saveWorld");

    const [first, second] = await Promise.all([saver.save(), saver.save()]);

    expect([first, second]).toEqual(["saved", "saved"]);
    expect(saveWorld).toHaveBeenCalledOnce();
  });

  it("tries again while the simulation is busy", async () => {
    const { saver, session } = await createSaver();

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.spyOn(session, "saveWorld").mockResolvedValueOnce(null);

    const outcome = saver.saveSoon(1);

    await vi.runAllTimersAsync();

    expect(await outcome).toBe("saved");
    expect(await listSavedWorlds()).toMatchObject([{ id: IDENTITY.id }]);
  });

  it("gives up on a busy simulation after its retries", async () => {
    const { saver, session } = await createSaver();

    vi.spyOn(session, "saveWorld").mockResolvedValue(null);

    expect(await saver.saveSoon(0)).toBe("busy");
  });

  it("reports a failed save and saves the same changes again later", async () => {
    const { onSaved, saver, session } = await createSaver();

    vi.spyOn(console, "warn").mockImplementation(ignore);
    vi.spyOn(session, "saveWorld").mockRejectedValueOnce(new Error("The worker stopped"));

    expect(await saver.save()).toBe("failed");
    expect(onSaved).not.toHaveBeenCalled();
    expect(await saver.save()).toBe("saved");
  });
});
