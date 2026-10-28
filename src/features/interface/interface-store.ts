import { create } from "zustand";
import { storedLabelsShown, storeLabelsShown } from "../../app/preferences.ts";
import { COMPACT_QUERY } from "../../design/use-media-query.ts";

export type JournalTab = "chronicle" | "relations" | "tribes";

export type SettingsTab = "island" | "time" | "weather" | "world";

interface InterfaceStore {
  readonly areLabelsShown: boolean;
  readonly closeJournal: () => void;
  readonly isJournalOpen: boolean;
  readonly isMapOpen: boolean;
  readonly isSettingsOpen: boolean;
  readonly journalTab: JournalTab;
  readonly openJournal: (tab: JournalTab) => void;
  readonly openSettings: () => void;
  readonly setJournalTab: (tab: JournalTab) => void;
  readonly setLabelsShown: (areShown: boolean) => void;
  readonly setSettingsOpen: (isOpen: boolean) => void;
  readonly setSettingsTab: (tab: SettingsTab) => void;
  readonly settingsTab: SettingsTab;
  readonly toggleMap: () => void;
}

export const useInterfaceStore = create<InterfaceStore>()((set) => ({
  areLabelsShown: storedLabelsShown(),
  closeJournal: () => set({ isJournalOpen: false }),
  isJournalOpen: false,
  isMapOpen: !window.matchMedia(COMPACT_QUERY).matches,
  isSettingsOpen: false,
  journalTab: "tribes",
  openJournal: (tab) => set({ isJournalOpen: true, journalTab: tab }),
  openSettings: () => set({ isSettingsOpen: true, settingsTab: "world" }),
  setJournalTab: (tab) => set({ journalTab: tab }),
  setLabelsShown: (areShown) => {
    storeLabelsShown(areShown);
    set({ areLabelsShown: areShown });
  },
  setSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  settingsTab: "world",
  toggleMap: () => set((state) => ({ isMapOpen: !state.isMapOpen })),
}));
