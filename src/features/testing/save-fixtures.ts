import { vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import { SAVE_VERSION, type SavedWorldState } from "../../simulation/saved-world.ts";
import { deleteSavedWorld, listSavedWorlds, type SavedWorldRecord } from "../saves/save-database.ts";
import { WorldSaver } from "../saves/world-saver.ts";
import { createTestSession } from "./engine-fixtures.ts";

const DATABASE_NAME = "ashfolk";

function deleteDatabase(): Promise<void> {
  const request = indexedDB.deleteDatabase(DATABASE_NAME);

  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve();
    });
    request.addEventListener("error", () => {
      reject(request.error);
    });
  });
}

export function createSavedRecord(
  id: string,
  state: SavedWorldState,
  changes: Partial<SavedWorldRecord> = {}
): SavedWorldRecord {
  return {
    generationFingerprint: state.generationFingerprint,
    id,
    isLandChanged: false,
    name: "Old Ford",
    savedAt: Date.now(),
    seed: state.request.seed,
    shape: state.request.options.shape,
    size: "normal",
    summary: state.summary,
    version: SAVE_VERSION,
    ...changes,
  };
}

export async function deleteAllSavedWorlds(): Promise<void> {
  const worlds = await listSavedWorlds();

  if (worlds === null) {
    throw new Error("The saved worlds could not be listed");
  }

  await Promise.all(
    worlds.map((world) => {
      return deleteSavedWorld(world.id);
    })
  );
}

export async function saveWorld(id: string, name: string): Promise<void> {
  const session = await createTestSession();

  await new WorldSaver(session, { id, name }, { onSaved: ignore, onSaving: ignore }).save();
}

export async function blockSavedWorlds(): Promise<void> {
  await deleteDatabase();

  vi.spyOn(console, "warn").mockImplementation(ignore);
  vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new DOMException("The browser blocks storage", "SecurityError");
  });
}
