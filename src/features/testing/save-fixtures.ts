import { vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import { deleteSavedWorld, listSavedWorlds } from "../saves/save-database.ts";

const DATABASE_NAME = "dawnfolk";

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

export async function blockSavedWorlds(): Promise<void> {
  await deleteDatabase();

  vi.spyOn(console, "warn").mockImplementation(ignore);
  vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new DOMException("The browser blocks storage", "SecurityError");
  });
}
