import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WORLD_REQUEST } from "../../generation/testing/world-request.ts";
import { ignore } from "../../shared/ignore.ts";
import { SAVE_VERSION, type SavedWorldState } from "../../simulation/saved-world.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { createSimulationWorkerApi } from "../../workers/simulation-worker-api.ts";
import { createSavedRecord, deleteAllSavedWorlds } from "../testing/save-fixtures.ts";
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

async function putRawRecord(record: object): Promise<void> {
  const opening = indexedDB.open("ashfolk");

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.addEventListener("success", () => {
      resolve(opening.result);
    });
    opening.addEventListener("error", () => {
      reject(opening.error);
    });
  });

  const transaction = database.transaction("worlds", "readwrite");

  transaction.objectStore("worlds").put(record);

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

    expect(await writeSavedWorld(createSavedRecord("first", state), state, [])).toBe(true);

    expect(await listSavedWorlds()).toMatchObject([{ id: "first", isLoadable: true, name: "Old Ford" }]);

    const stored = await readSavedWorld("first");

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
    expect(await readSavedWorld("old")).toBeNull();
  });

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

  it("leaves worlds saved without a fingerprint unmarked until loading finds the land changed", async () => {
    const state = savedState();

    await writeSavedWorld(createSavedRecord("older", state, { generationFingerprint: null, savedAt: 1000 }), state, []);

    expect(await listSavedWorlds()).toMatchObject([{ hasLandChanged: false, id: "older" }]);

    await markLandChanged("older");

    expect(await listSavedWorlds()).toMatchObject([{ hasLandChanged: true, id: "older" }]);
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

    await putRawRecord(older);

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

    await putRawRecord(older);

    expect((await readSavedWorld("older"))?.record).toMatchObject({
      generationFingerprint: null,
      isLandChanged: false,
    });
    expect(await listSavedWorlds()).toMatchObject([{ hasLandChanged: false, id: "older", isLoadable: true }]);
  });
});
