import { describe, expect, it } from "vitest";
import { FINISHED_INTRO } from "../testing/guide-fixtures.ts";
import { applyGuideEvent, currentTip, FRESH_GUIDE, INTRO_TIPS, isGuideTipId, suggestedPowerId } from "./guide-tips.ts";

describe("guide steps", () => {
  it("leads from a camp to the chronicle and remembers each task", () => {
    let progress = FRESH_GUIDE;

    for (const step of INTRO_TIPS) {
      expect(currentTip(progress)).toBe(step);

      const event = { kind: "step", step } as const;

      progress = applyGuideEvent(progress, event);
      expect(applyGuideEvent(progress, event)).toBe(progress);
    }

    expect(currentTip(progress)).toBeNull();
  });

  it("credits something the player discovered ahead of time", () => {
    const progress = applyGuideEvent(FRESH_GUIDE, { kind: "step", step: "speed" });

    expect(progress.done).toEqual(["speed"]);
    expect(currentTip(progress)).toBe("follow");
    expect(suggestedPowerId(applyGuideEvent(progress, { kind: "step", step: "follow" }))).toBe("abundance");
  });

  it("keeps the current lesson when a fire starts", () => {
    const progress = applyGuideEvent(FRESH_GUIDE, { category: "fire", kind: "chronicle" });

    expect(progress).toBe(FRESH_GUIDE);
  });

  it("shows a moment once and closes it when the suggested power is used", () => {
    const event = { category: "fire", kind: "chronicle" } as const;
    const shown = applyGuideEvent(FINISHED_INTRO, event);

    expect(currentTip(shown)).toBe("fire");
    expect(suggestedPowerId(shown)).toBe("rain");
    expect(applyGuideEvent(shown, { kind: "cast", powerId: "lightning" })).toBe(shown);

    const cleared = applyGuideEvent(shown, { kind: "cast", powerId: "rain" });

    expect(currentTip(cleared)).toBeNull();
    expect(applyGuideEvent(cleared, event)).toBe(cleared);
  });

  it("stops tracking progress after skipping", () => {
    const skipped = { ...FRESH_GUIDE, isOff: true };

    expect(currentTip(skipped)).toBeNull();
    expect(applyGuideEvent(skipped, { kind: "step", step: "use" })).toBe(skipped);
  });

  it("recognizes only known tip ids", () => {
    expect(isGuideTipId("fire")).toBe(true);
    expect(isGuideTipId("volcano")).toBe(false);
  });
});
