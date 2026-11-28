import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD_REQUEST } from "../../generation/testing/world-request.ts";
import { ignore } from "../../shared/ignore.ts";
import { SAVE_VERSION, type SavedWorldState } from "../../simulation/saved-world.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { createSimulationWorkerApi } from "../../workers/simulation-worker-api.ts";
import { createSavedRecord, deleteAllSavedWorlds } from "../testing/save-fixtures.ts";
import { createChronicleEntry } from "../testing/world-fixtures.ts";
import {
  deleteSavedWorld,
  listSavedWorlds,
  markLandChanged,
  readSavedWorld,
  writeSavedWorld,
} from "./save-database.ts";

const TEST_WORLD = { dimensions: { cellSize: 10, cellsPerSide: 64 } };

function savedState(): SavedWorldState {
  const api = createSimulationWorkerApi(() => {
    return new Simulation(createVegetatedWorld(TEST_WORLD));
  });

  api.createWorld(DEFAULT_WORLD_REQUEST, ignore);
  api.advance(0.5, [{ parameters: {}, powerId: "tribe", type: "usePower", x: 0, z: 0 }]);

  const state = api.saveWorld();

  if (state === null) {
    throw new Error("The test world was busy");
  }

  return state;
}

async function putRawRecord(store: "states" | "worlds", record: object): Promise<void> {
  const opening = indexedDB.open("ashfolk");

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.addEventListener("success", () => {
      resolve(opening.result);
    });
    opening.addEventListener("error", () => {
      reject(opening.error);
    });
  });

  const transaction = database.transaction(store, "readwrite");

  transaction.objectStore(store).put(record);

  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => {
      resolve();
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error);
    });
  });

  database.close();
}

afterEach(async () => {
  await deleteAllSavedWorlds();
});

describe("saved worlds", () => {
  it("saves, lists and reads back a world", async () => {
    const state = savedState();
    const journal = [createChronicleEntry()];

    expect(await writeSavedWorld(createSavedRecord("first", state), state, journal)).toBe(true);

    expect(await listSavedWorlds()).toMatchObject([{ id: "first", isLoadable: true, name: "Old Ford" }]);

    const stored = await readSavedWorld("first");

    expect(stored?.journal).toEqual(journal);
    expect(stored?.record.name).toBe("Old Ford");
    expect(stored?.state.simulation.tick).toBe(state.simulation.tick);
    expect(stored?.state.simulation.world.fields.snow).toBeInstanceOf(Float32Array);
  });

  it("lists the most recent save first", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("older", state, { savedAt: 1000 }), state, []);
    await writeSavedWorld(createSavedRecord("newer", state, { savedAt: 2000 }), state, []);

    expect(await listSavedWorlds()).toMatchObject([{ id: "newer" }, { id: "older" }]);
  });

  it("deletes a world with its state", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("gone", state), state, []);

    expect(await deleteSavedWorld("gone")).toBe(true);
    expect(await listSavedWorlds()).toEqual([]);
    expect(await readSavedWorld("gone")).toBeNull();
  });

  it("lists a save from another version without loading it", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("old", state, { version: SAVE_VERSION + 1 }), state, []);

    expect(await listSavedWorlds()).toMatchObject([{ id: "old", isLoadable: false }]);
    await expect(readSavedWorld("old")).rejects.toThrow("saved island");
  });

  it("lists a world whose record cannot be read without loading it", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("broken", state), state, []);
    await putRawRecord("worlds", { ...createSavedRecord("broken", state), shape: "triangle" });

    expect(await listSavedWorlds()).toMatchObject([{ id: "broken", isLoadable: false, shape: "round" }]);
    await expect(readSavedWorld("broken")).rejects.toThrow("saved island");
  });

  it("retains an island when a read fails and loads it on retry", async () => {
    const state = savedState();
    const record = createSavedRecord("retry", state);

    await writeSavedWorld(record, state, []);
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(() => {
      throw new DOMException("Storage is temporarily unavailable", "InvalidStateError");
    });

    await expect(readSavedWorld("retry")).rejects.toThrow("temporarily unavailable");
    expect((await readSavedWorld("retry"))?.state.simulation.tick).toBe(state.simulation.tick);
  });

  it.each(["states", "worlds"] as const)(
    "retains an incomplete island when only its %s entry survives",
    async (store) => {
      const state = savedState();
      const record = createSavedRecord("orphan", state);
      const entries = { states: { id: record.id, journal: [], state }, worlds: record };
      const missing = store === "worlds" ? "states" : "worlds";

      expect(await readSavedWorld(record.id)).toBeNull();
      await putRawRecord(store, entries[store]);

      await expect(readSavedWorld(record.id)).rejects.toThrow("saved island");

      await putRawRecord(missing, entries[missing]);

      expect((await readSavedWorld(record.id))?.state.simulation.tick).toBe(state.simulation.tick);
    }
  );

  it("loads a saved world back into a simulation", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("again", state), state, []);

    const stored = await readSavedWorld("again");

    if (stored === null) {
      throw new Error("The world was not stored");
    }

    const api = createSimulationWorkerApi(
      () => {
        return new Simulation(createVegetatedWorld(TEST_WORLD));
      },
      () => {
        return new Simulation(createVegetatedWorld(TEST_WORLD));
      }
    );

    const { hasLandChanged, world } = api.loadWorld(stored.state, ignore);

    expect(world.frame.tick).toBe(state.simulation.tick);
    expect(world.frame.personCount).toBe(state.simulation.society.people.length);
    expect(world.frame.personCount).toBeGreaterThan(0);
    expect(hasLandChanged).toBe(false);
  });

  it("marks a world whose land has changed until it is saved again", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("moved", state), state, []);

    expect(await markLandChanged("moved")).toBe(true);
    expect(await listSavedWorlds()).toMatchObject([{ hasLandChanged: true, id: "moved" }]);

    await writeSavedWorld(createSavedRecord("moved", state), state, []);

    expect(await listSavedWorlds()).toMatchObject([{ hasLandChanged: false, id: "moved" }]);
  });

  it("lists and reads back the island size", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("large", state, { size: "large" }), state, []);

    expect(await listSavedWorlds()).toMatchObject([{ id: "large", size: "large" }]);
    expect((await readSavedWorld("large"))?.record.size).toBe("large");
  });

  it("reads and lists records saved before island sizes as normal", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("older", state), state, []);

    const { size: _, ...older } = createSavedRecord("older", state, { size: "large" });

    await putRawRecord("worlds", older);

    expect((await readSavedWorld("older"))?.record.size).toBe("normal");
    expect(await listSavedWorlds()).toMatchObject([{ id: "older", isLoadable: true, size: "normal" }]);
  });

  it("reads and lists records saved before fingerprints", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("older", state), state, []);

    const {
      generationFingerprint: _,
      isLandChanged: __,
      ...older
    } = createSavedRecord("older", state, { savedAt: 1000 });

    await putRawRecord("worlds", older);

    expect((await readSavedWorld("older"))?.record).toMatchObject({
      generationFingerprint: null,
      isLandChanged: false,
    });
    expect(await listSavedWorlds()).toMatchObject([{ hasLandChanged: false, id: "older", isLoadable: true }]);
  });
});
