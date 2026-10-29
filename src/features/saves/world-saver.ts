import type { GameSession } from "../../game/game-session.ts";
import { SAVE_VERSION } from "../../simulation/saved-world.ts";
import { islandSizeOf } from "../../world/island-size.ts";
import { writeSavedWorld } from "./save-database.ts";

const BUSY_RETRIES = 6;
const BUSY_RETRY_MILLISECONDS = 500;

export type SaveOutcome = "busy" | "failed" | "saved" | "unchanged";

export interface SavedWorldIdentity {
  readonly id: string;
  readonly name: string;
}

interface SaverListener {
  readonly onSaved: (savedAt: number) => void;
  readonly onSaving: (isSaving: boolean) => void;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export class WorldSaver {
  readonly #identity: SavedWorldIdentity;
  readonly #listener: SaverListener;
  readonly #session: GameSession;
  #pending: Promise<SaveOutcome> | null = null;
  #savedChanges = Number.NaN;

  constructor(session: GameSession, identity: SavedWorldIdentity, listener: SaverListener) {
    this.#session = session;
    this.#identity = identity;
    this.#listener = listener;
  }

  save(): Promise<SaveOutcome> {
    if (this.#pending !== null) {
      return this.#pending;
    }

    const pending = this.#write().finally(() => {
      this.#pending = null;
      this.#listener.onSaving(false);
    });

    this.#pending = pending;

    return pending;
  }

  async saveSoon(retries = BUSY_RETRIES): Promise<SaveOutcome> {
    const outcome = await this.save();

    if (outcome !== "busy" || retries <= 0) {
      return outcome;
    }

    await wait(BUSY_RETRY_MILLISECONDS);

    return this.saveSoon(retries - 1);
  }

  async #write(): Promise<SaveOutcome> {
    const session = this.#session;

    const { changes } = session;

    if (changes === this.#savedChanges) {
      return "unchanged";
    }

    this.#listener.onSaving(true);

    const state = await session.saveWorld().catch((error: unknown) => {
      console.warn("The world could not be saved", error);
    });

    if (state === undefined) {
      return "failed";
    }

    if (state === null) {
      return "busy";
    }

    const savedAt = Date.now();

    const record = {
      generationFingerprint: state.generationFingerprint,
      id: this.#identity.id,
      isLandChanged: false,
      name: this.#identity.name,
      savedAt,
      seed: state.request.seed,
      shape: state.request.options.shape,
      size: islandSizeOf(state.request.options.dimensions),
      summary: state.summary,
      version: SAVE_VERSION,
    };

    if (!(await writeSavedWorld(record, state, session.chronicle))) {
      return "failed";
    }

    this.#savedChanges = changes;
    this.#listener.onSaved(savedAt);

    return "saved";
  }
}
