import { describe, expect, it } from "vitest";
import sharpBlockedHand from "./cursors/hand-blocked@2x.png";
import blockedHand from "./cursors/hand-blocked.png";
import sharpClosedHand from "./cursors/hand-closed@2x.png";
import closedHand from "./cursors/hand-closed.png";
import sharpOpenHand from "./cursors/hand-open@2x.png";
import openHand from "./cursors/hand-open.png";
import { handCursorStyles, showHandCursor } from "./hand-cursor.ts";
import type { HandCursor } from "./hand-tool.ts";

const LOOKS: readonly (readonly [HandCursor, string, string, string])[] = [
  ["open", "hand-open", "16 18", "grab"],
  ["closed", "hand-closed", "16 10", "grabbing"],
  ["blocked", "hand-blocked", "16 10", "not-allowed"],
];

const PAINTED_HANDS = [openHand, sharpOpenHand, closedHand, sharpClosedHand, blockedHand, sharpBlockedHand];

function loadedWidth(source: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => {
      resolve(image.naturalWidth);
    });
    image.addEventListener("error", () => {
      reject(new Error(`The cursor ${source} did not load`));
    });
    image.src = source;
  });
}

describe("hand cursor", () => {
  it.each(LOOKS)("paints the %s hand from %s at %s and falls back to %s", (cursor, image, hotspot, fallback) => {
    const element = document.createElement("div");

    document.body.append(element);
    showHandCursor(element, cursor);

    const shown = getComputedStyle(element).cursor;

    element.remove();

    expect(shown).toContain("image-set");
    expect(shown).toContain(`${image}.png`);
    expect(shown).toContain(`${image}@2x.png`);
    expect(shown.endsWith(`${hotspot}, ${fallback}`)).toBe(true);
  });

  it("loads every painted hand at one and two times the size", async () => {
    const sizes = await Promise.all(PAINTED_HANDS.map(loadedWidth));

    expect(sizes).toEqual([32, 64, 32, 64, 32, 64]);
  });

  it("goes back to the page cursor when the hand is put away", () => {
    const element = document.createElement("div");

    showHandCursor(element, "open");
    showHandCursor(element, "none");

    expect(element.style.cursor).toBe("");
    expect(handCursorStyles("none")).toEqual([""]);
  });
});
