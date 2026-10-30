import { describe, expect, it } from "vitest";
import { COMPACT_QUERY } from "../../design/use-media-query.ts";
import { useInterfaceStore } from "./interface-store.ts";

describe("interface store", () => {
  it("starts with every panel closed except the map on wide screens", () => {
    const state = useInterfaceStore.getState();

    expect(state.isJournalOpen).toBe(false);
    expect(state.isSettingsOpen).toBe(false);
    expect(state.isMapOpen).toBe(!window.matchMedia(COMPACT_QUERY).matches);
  });

  it("opens the journal on the chosen tab", () => {
    useInterfaceStore.getState().openJournal("chronicle");

    const state = useInterfaceStore.getState();

    expect(state.isJournalOpen).toBe(true);
    expect(state.journalTab).toBe("chronicle");
  });

  it("closes the journal and keeps its tab", () => {
    const { closeJournal, openJournal } = useInterfaceStore.getState();

    openJournal("relations");
    closeJournal();

    const state = useInterfaceStore.getState();

    expect(state.isJournalOpen).toBe(false);
    expect(state.journalTab).toBe("relations");
  });

  it("switches journal tabs without opening the journal", () => {
    useInterfaceStore.getState().setJournalTab("chronicle");

    const state = useInterfaceStore.getState();

    expect(state.journalTab).toBe("chronicle");
    expect(state.isJournalOpen).toBe(false);
  });

  it("shows and hides the map", () => {
    const wasOpen = useInterfaceStore.getState().isMapOpen;

    useInterfaceStore.getState().toggleMap();

    expect(useInterfaceStore.getState().isMapOpen).toBe(!wasOpen);

    useInterfaceStore.getState().toggleMap();

    expect(useInterfaceStore.getState().isMapOpen).toBe(wasOpen);
  });

  it("turns map labels off and remembers the choice", () => {
    useInterfaceStore.getState().setLabelsShown(false);

    expect(useInterfaceStore.getState().areLabelsShown).toBe(false);
    expect(localStorage.getItem("dawnfolk.labels")).toBe("hidden");

    useInterfaceStore.getState().setLabelsShown(true);

    expect(useInterfaceStore.getState().areLabelsShown).toBe(true);
    expect(localStorage.getItem("dawnfolk.labels")).toBe("shown");
  });

  it("opens the settings on the World section", () => {
    const { openSettings, setSettingsTab } = useInterfaceStore.getState();

    setSettingsTab("time");
    openSettings();

    const state = useInterfaceStore.getState();

    expect(state.isSettingsOpen).toBe(true);
    expect(state.settingsTab).toBe("world");
  });

  it("remembers the section after the settings close", () => {
    const { openSettings, setSettingsOpen, setSettingsTab } = useInterfaceStore.getState();

    openSettings();
    setSettingsTab("island");
    setSettingsOpen(false);

    const state = useInterfaceStore.getState();

    expect(state.isSettingsOpen).toBe(false);
    expect(state.settingsTab).toBe("island");
  });
});
