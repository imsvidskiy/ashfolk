import { create } from "zustand";
import type { GameSession } from "../../game/game-session.ts";
import { ignore } from "../../shared/ignore.ts";
import { deleteSavedWorld, listSavedWorlds, type SavedWorldListing } from "./save-database.ts";
import { type SavedWorldIdentity, type SaveOutcome, WorldSaver } from "./world-saver.ts";

const AUTOSAVE_MILLISECONDS = 60_000;

interface SavesStore {
  readonly acceptedLand: GameSession | null;
  readonly acceptLand: (session: GameSession) => void;
  readonly canReadSaves: boolean;
  readonly hasFailed: boolean;
  readonly isSaving: boolean;
  readonly lastSavedAt: number | null;
  readonly refresh: () => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly saveNow: () => Promise<SaveOutcome>;
  readonly saver: WorldSaver | null;
  readonly worlds: readonly SavedWorldListing[];
}

export const useSavesStore = create<SavesStore>()((set, get) => {
  return {
    acceptedLand: null,
    acceptLand: (session) => {
      set({ acceptedLand: session });
    },
    canReadSaves: true,
    hasFailed: false,
    isSaving: false,
    lastSavedAt: null,
    refresh: async () => {
      const worlds = await listSavedWorlds();

      if (worlds === null) {
        set({ canReadSaves: false, worlds: [] });

        return;
      }

      set({ canReadSaves: true, worlds });
    },
    remove: async (id) => {
      await deleteSavedWorld(id);
      await get().refresh();
    },
    saveNow: async () => {
      const { saver } = get();

      if (saver === null) {
        return "unchanged";
      }

      const outcome = await saver.saveSoon();

      set({ hasFailed: outcome === "failed" });

      return outcome;
    },
    saver: null,
    worlds: [],
  };
});

export function useIsLandChangePending(session: GameSession | null): boolean {
  const acceptedLand = useSavesStore((state) => {
    return state.acceptedLand;
  });

  if (session === null) {
    return false;
  }

  return session.hasLandChanged && acceptedLand !== session;
}

export function saveBeforeLeaving(leave: () => void): void {
  const { saveNow, saver } = useSavesStore.getState();

  if (saver === null) {
    leave();

    return;
  }

  saveNow().finally(leave);
}

function reportOutcome(outcome: SaveOutcome): void {
  if (outcome === "failed") {
    useSavesStore.setState({ hasFailed: true });
  }
}

export function connectAutosave(session: GameSession, identity: SavedWorldIdentity): () => void {
  const saver = new WorldSaver(session, identity, {
    onSaved: (savedAt) => {
      useSavesStore.setState({ hasFailed: false, lastSavedAt: savedAt });
    },
    onSaving: (isSaving) => {
      useSavesStore.setState({ isSaving });
    },
  });

  function autosave(): void {
    saver.save().then(reportOutcome, ignore);
  }

  function saveWhenHidden(): void {
    if (document.visibilityState === "hidden") {
      saver.saveSoon().then(reportOutcome, ignore);
    }
  }

  const interval = window.setInterval(autosave, AUTOSAVE_MILLISECONDS);

  document.addEventListener("visibilitychange", saveWhenHidden);
  window.addEventListener("pagehide", autosave);
  useSavesStore.setState({ hasFailed: false, isSaving: false, lastSavedAt: null, saver });

  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", saveWhenHidden);
    window.removeEventListener("pagehide", autosave);

    if (useSavesStore.getState().saver === saver) {
      useSavesStore.setState({ isSaving: false, saver: null });
    }
  };
}
