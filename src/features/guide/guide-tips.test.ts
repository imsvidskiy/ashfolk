import { describe, expect, it } from "vitest";
import {
  applyGuideEvent,
  currentTip,
  dismissTip,
  FRESH_GUIDE,
  type GuideEvent,
  type GuideProgress,
  INTRO_TIPS,
  isGuideTipId,
  suggestedPowerId,
} from "./guide-tips.ts";

const FINISHED_INTRO: GuideProgress = { ...FRESH_GUIDE, done: [...INTRO_TIPS] };

function applyAll(progress: GuideProgress, events: readonly GuideEvent[]): GuideProgress {
  return events.reduce(applyGuideEvent, progress);
}

describe("guide tips", () => {
  it("walks the intro in order as the player acts", () => {
    expect(currentTip(FRESH_GUIDE)).toBe("look");

    const looked = applyGuideEvent(FRESH_GUIDE, { kind: "cameraMoved" });

    expect(currentTip(looked)).toBe("pick");
    expect(suggestedPowerId(looked)).toBe("lightning");

    const finished = applyAll(looked, [
      { kind: "powerPicked" },
      { kind: "powerUsed" },
      { kind: "speedChanged", speed: 4 },
      { kind: "selected" },
    ]);

    expect(currentTip(finished)).toBeNull();
  });

  it("counts a step the player takes out of order", () => {
    const progress = applyGuideEvent(FRESH_GUIDE, { kind: "speedChanged", speed: 2 });

    expect(progress.done).toEqual(["speed"]);
    expect(currentTip(progress)).toBe("look");
  });

  it("does not count slowing time as a faster speed", () => {
    expect(applyGuideEvent(FRESH_GUIDE, { kind: "speedChanged", speed: 1 }).done).toEqual([]);
  });

  it("keeps the same progress when an event changes nothing", () => {
    const looked = applyGuideEvent(FRESH_GUIDE, { kind: "cameraMoved" });

    expect(applyGuideEvent(looked, { kind: "cameraMoved" })).toBe(looked);
    expect(applyGuideEvent(FINISHED_INTRO, { kind: "season", name: "Summer" })).toBe(FINISHED_INTRO);
  });

  it("skips the intro tip on dismiss", () => {
    expect(currentTip(dismissTip(FRESH_GUIDE))).toBe("pick");
  });

  it("waits for the intro before tips about moments", () => {
    const progress = applyGuideEvent(FRESH_GUIDE, { category: "fire", kind: "chronicle" });

    expect(progress.shown).toBeNull();
    expect(currentTip(progress)).toBe("look");
  });

  it("shows a moment tip once and points at its power", () => {
    const shown = applyGuideEvent(FINISHED_INTRO, { category: "fire", kind: "chronicle" });

    expect(currentTip(shown)).toBe("fire");
    expect(suggestedPowerId(shown)).toBe("rain");

    const again = applyGuideEvent(dismissTip(shown), { category: "fire", kind: "chronicle" });

    expect(currentTip(again)).toBeNull();
  });

  it("keeps a shown tip until the player acts or dismisses it", () => {
    const shown = applyGuideEvent(FINISHED_INTRO, { kind: "season", name: "Winter" });
    const later = applyGuideEvent(shown, { category: "era", kind: "chronicle" });

    expect(currentTip(later)).toBe("winter");
    expect(currentTip(applyGuideEvent(later, { kind: "powerUsed" }))).toBeNull();
  });

  it("ignores other seasons and quiet chronicle entries", () => {
    const progress = applyAll(FINISHED_INTRO, [
      { kind: "season", name: "Summer" },
      { category: "birth", kind: "chronicle" },
    ]);

    expect(currentTip(progress)).toBeNull();
  });

  it("shows nothing while tips are off", () => {
    expect(currentTip({ ...FRESH_GUIDE, isOff: true })).toBeNull();
  });

  it("recognizes only known tip ids", () => {
    expect(isGuideTipId("fire")).toBe(true);
    expect(isGuideTipId("volcano")).toBe(false);
  });
});
