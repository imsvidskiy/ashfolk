import { describe, expect, it, vi } from "vitest";
import { readStoredGuide, useGuideStore } from "./guide-store.ts";
import { currentTip, FRESH_GUIDE } from "./guide-tips.ts";

describe("guide store", () => {
  it("reads saved progress and drops tips that no longer exist", () => {
    expect(readStoredGuide({ done: ["follow", "volcano"], isOff: false })).toEqual({
      ...FRESH_GUIDE,
      done: ["follow"],
    });
  });

  it("keeps the guide finished for players who completed the previous tour", () => {
    const progress = readStoredGuide({ done: ["look", "pick", "use", "speed", "follow"] });

    expect(currentTip(progress)).toBeNull();
  });

  it("starts fresh from a broken save", () => {
    expect(readStoredGuide({ done: "look" })).toEqual(FRESH_GUIDE);
  });

  it("saves and notifies only when an event changes the tips", () => {
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const listener = vi.fn<() => void>();
    const unsubscribe = useGuideStore.subscribe(listener);

    useGuideStore.getState().record({ kind: "step", step: "follow" });
    useGuideStore.getState().record({ kind: "step", step: "follow" });
    unsubscribe();

    expect(useGuideStore.getState().progress.done).toEqual(["follow"]);
    expect(listener).toHaveBeenCalledOnce();
    expect(writes).toHaveBeenCalledOnce();
  });

  it("starts the tips again when they are turned back on", () => {
    useGuideStore.getState().record({ kind: "step", step: "follow" });
    useGuideStore.getState().setTipsShown(false);
    useGuideStore.getState().setTipsShown(true);

    expect(useGuideStore.getState().progress).toEqual(FRESH_GUIDE);
  });
});
