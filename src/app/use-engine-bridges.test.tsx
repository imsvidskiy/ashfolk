import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useSavesStore } from "../features/saves/saves-store.ts";
import { CHANGED_HEIGHT, startLoadedWorld, UNCHANGED_HEIGHT } from "../features/testing/land-change-fixtures.ts";
import { useEngineBridges } from "./use-engine-bridges.ts";

const initialSaves = useSavesStore.getState();

afterEach(() => {
  useSavesStore.setState(initialSaves, true);
});

describe("engine bridges", () => {
  it("autosaves a world whose land grows as it did", async () => {
    await startLoadedWorld({ regrownHeight: UNCHANGED_HEIGHT });
    await renderHook(useEngineBridges);

    expect(useSavesStore.getState().saver).not.toBeNull();
  });

  it("holds autosave while the land change waits for an answer", async () => {
    const { session } = await startLoadedWorld({ regrownHeight: CHANGED_HEIGHT });
    const { act } = await renderHook(useEngineBridges);

    expect(useSavesStore.getState().saver).toBeNull();

    await act(() => {
      useSavesStore.getState().acceptLand(session);
    });

    expect(useSavesStore.getState().saver).not.toBeNull();
  });

  it("forgets the accepted land when the world is left", async () => {
    const { session } = await startLoadedWorld({ regrownHeight: CHANGED_HEIGHT });
    const { unmount } = await renderHook(useEngineBridges);

    useSavesStore.getState().acceptLand(session);
    await unmount();

    expect(useSavesStore.getState().acceptedLand).toBeNull();
  });
});
