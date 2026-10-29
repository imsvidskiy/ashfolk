import { z } from "zod";
import type { ChronicleEntry } from "../../simulation/chronicle.ts";
import {
  SAVE_VERSION,
  type SavedWorldState,
  savedWorldStateSchema,
  type WorldSummary,
  worldSummarySchema,
} from "../../simulation/saved-world.ts";
import { ISLAND_SHAPES, type IslandShapeKind } from "../../world/island-shape.ts";
import { ISLAND_SIZES, type IslandSizeKind } from "../../world/island-size.ts";
import { CHRONICLE_ICONS } from "../journal/chronicle-icons.ts";

const DATABASE_NAME = "ashfolk";
const DATABASE_VERSION = 1;
const WORLDS = "worlds";
const STATES = "states";

const listingSchema = z.object({
  id: z.string(),
  isLandChanged: z.boolean().catch(false),
  name: z.string().catch("Unnamed world"),
  savedAt: z.number().catch(0),
  seed: z.number().catch(1),
  shape: z.enum(ISLAND_SHAPES).catch("round"),
  size: z.enum(ISLAND_SIZES).catch("normal"),
  summary: worldSummarySchema.nullable().catch(null),
  version: z.number().catch(0),
});

const recordSchema = z.object({
  generationFingerprint: z.number().int().nullable().default(null),
  id: z.string(),
  isLandChanged: z.boolean().default(false),
  name: z.string(),
  savedAt: z.number(),
  seed: z.number(),
  shape: z.enum(ISLAND_SHAPES),
  size: z.enum(ISLAND_SIZES).default("normal"),
  summary: worldSummarySchema,
  version: z.literal(SAVE_VERSION),
});

const journalEntrySchema = z.looseObject({
  category: z.string().refine((category) => {
    return Object.hasOwn(CHRONICLE_ICONS, category);
  }),
  day: z.number(),
  id: z.number(),
  text: z.string(),
  tribeId: z.number().nullable(),
  x: z.number(),
  z: z.number(),
});

const journalSchema = z.array(journalEntrySchema);

const storedStateSchema = z.object({
  id: z.string(),
  journal: z
    .custom<ChronicleEntry[]>((value) => {
      return journalSchema.safeParse(value).success;
    })
    .catch([]),
  state: savedWorldStateSchema,
});

export interface SavedWorldRecord {
  readonly generationFingerprint: number | null;
  readonly id: string;
  readonly isLandChanged: boolean;
  readonly name: string;
  readonly savedAt: number;
  readonly seed: number;
  readonly shape: IslandShapeKind;
  readonly size: IslandSizeKind;
  readonly summary: WorldSummary;
  readonly version: number;
}

export interface SavedWorldListing {
  readonly hasLandChanged: boolean;
  readonly id: string;
  readonly isLoadable: boolean;
  readonly name: string;
  readonly savedAt: number;
  readonly seed: number;
  readonly shape: IslandShapeKind;
  readonly size: IslandSizeKind;
  readonly summary: WorldSummary | null;
}

interface StoredWorld {
  readonly journal: readonly ChronicleEntry[];
  readonly record: SavedWorldRecord;
  readonly state: SavedWorldState;
}

let opening: Promise<IDBDatabase> | null = null;

function settleRequest<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error);
    });
  });
}

function settleTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => {
      resolve();
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error);
    });
    transaction.addEventListener("abort", () => {
      reject(transaction.error);
    });
  });
}

function createStores(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(WORLDS)) {
    database.createObjectStore(WORLDS, { keyPath: "id" });
  }

  if (!database.objectStoreNames.contains(STATES)) {
    database.createObjectStore(STATES, { keyPath: "id" });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (opening !== null) {
    return opening;
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

  request.addEventListener("upgradeneeded", () => {
    createStores(request.result);
  });

  const opened = settleRequest(request).then((database) => {
    database.addEventListener("versionchange", () => {
      database.close();
      opening = null;
    });

    return database;
  });

  opening = opened;
  opened.catch(() => {
    opening = null;
  });

  return opened;
}

async function attempt<Value>(task: () => Promise<Value>, fallback: Value, failure: string): Promise<Value> {
  try {
    return await task();
  } catch (error) {
    console.warn(failure, error);

    return fallback;
  }
}

function readListing(value: unknown): SavedWorldListing | null {
  const result = listingSchema.safeParse(value);

  if (!result.success) {
    return null;
  }

  const { id, isLandChanged, name, savedAt, seed, shape, size, summary, version } = result.data;

  return {
    hasLandChanged: isLandChanged,
    id,
    isLoadable: version === SAVE_VERSION && summary !== null,
    name,
    savedAt,
    seed,
    shape,
    size,
    summary,
  };
}

export function listSavedWorlds(): Promise<SavedWorldListing[]> {
  return attempt(
    async () => {
      const database = await openDatabase();

      const records = await settleRequest(database.transaction(WORLDS).objectStore(WORLDS).getAll());

      const listings = records.map(readListing).filter((listing) => {
        return listing !== null;
      });

      return listings.toSorted((first, second) => {
        return second.savedAt - first.savedAt;
      });
    },
    [],
    "Saved worlds are not available"
  );
}

export function writeSavedWorld(
  record: SavedWorldRecord,
  state: SavedWorldState,
  journal: readonly ChronicleEntry[]
): Promise<boolean> {
  return attempt(
    async () => {
      const database = await openDatabase();

      const transaction = database.transaction([WORLDS, STATES], "readwrite");

      transaction.objectStore(STATES).put({ id: record.id, journal, state });
      transaction.objectStore(WORLDS).put(record);
      await settleTransaction(transaction);

      return true;
    },
    false,
    "The world could not be saved"
  );
}

export function readSavedWorld(id: string): Promise<StoredWorld | null> {
  return attempt(
    async () => {
      const database = await openDatabase();

      const transaction = database.transaction([WORLDS, STATES]);

      const [recordValue, storedValue] = await Promise.all([
        settleRequest(transaction.objectStore(WORLDS).get(id)),
        settleRequest(transaction.objectStore(STATES).get(id)),
      ]);

      const record = recordSchema.safeParse(recordValue);
      const stored = storedStateSchema.safeParse(storedValue);

      if (!(record.success && stored.success)) {
        return null;
      }

      return { journal: stored.data.journal, record: record.data, state: stored.data.state };
    },
    null,
    "The saved world could not be read"
  );
}

export function markLandChanged(id: string): Promise<boolean> {
  return attempt(
    async () => {
      const database = await openDatabase();

      const transaction = database.transaction(WORLDS, "readwrite");
      const worlds = transaction.objectStore(WORLDS);

      const record = recordSchema.safeParse(await settleRequest(worlds.get(id)));

      if (!record.success) {
        return false;
      }

      worlds.put({ ...record.data, isLandChanged: true });
      await settleTransaction(transaction);

      return true;
    },
    false,
    "The saved world could not be marked"
  );
}

export function deleteSavedWorld(id: string): Promise<boolean> {
  return attempt(
    async () => {
      const database = await openDatabase();

      const transaction = database.transaction([WORLDS, STATES], "readwrite");

      transaction.objectStore(WORLDS).delete(id);
      transaction.objectStore(STATES).delete(id);
      await settleTransaction(transaction);

      return true;
    },
    false,
    "The saved world could not be deleted"
  );
}
