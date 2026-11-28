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
  readonly isSaving: boolean;
  readonly isWaitingToLeave: boolean;
  readonly lastSavedAt: number | null;
  readonly refresh: () => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly saveNow: () => Promise<SaveOutcome>;
  readonly saveProblem: "busy" | "failed" | null;
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
    isSaving: false,
    isWaitingToLeave: false,
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

      const outcome = await saver.saveSoon().catch((): SaveOutcome => {
        return "failed";
      });

      if (get().saver === saver) {
        set({ saveProblem: outcome === "busy" || outcome === "failed" ? outcome : null });
      }

      return outcome;
    },
    saveProblem: null,
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
  const { isWaitingToLeave, saveNow, saver } = useSavesStore.getState();

  if (isWaitingToLeave) {
    return;
  }

  useSavesStore.setState({ isWaitingToLeave: true, saveProblem: null });
  saveNow().then((outcome) => {
    if (useSavesStore.getState().saver !== saver) {
      return;
    }

    useSavesStore.setState({ isWaitingToLeave: false });

    if (outcome === "saved" || outcome === "unchanged") {
      leave();
    }
  });
}

export function connectAutosave(session: GameSession, identity: SavedWorldIdentity): () => void {
  function updateStatus(status: Partial<Pick<SavesStore, "isSaving" | "lastSavedAt" | "saveProblem">>): void {
    if (useSavesStore.getState().saver === saver) {
      useSavesStore.setState(status);
    }
  }

  const saver = new WorldSaver(session, identity, {
    onSaved: (savedAt) => {
      updateStatus({ lastSavedAt: savedAt, saveProblem: null });
    },
    onSaving: (isSaving) => {
      updateStatus({ isSaving });
    },
  });

  function reportOutcome(outcome: SaveOutcome): void {
    if (outcome === "failed") {
      updateStatus({ saveProblem: "failed" });
    }
  }

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
  useSavesStore.setState({ isSaving: false, isWaitingToLeave: false, lastSavedAt: null, saveProblem: null, saver });

  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", saveWhenHidden);
    window.removeEventListener("pagehide", autosave);

    if (useSavesStore.getState().saver === saver) {
      useSavesStore.setState({ isSaving: false, isWaitingToLeave: false, saver: null });
    }
  };
}
