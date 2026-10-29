import sharpBlockedHand from "./cursors/hand-blocked@2x.png";
import blockedHand from "./cursors/hand-blocked.png";
import sharpClosedHand from "./cursors/hand-closed@2x.png";
import closedHand from "./cursors/hand-closed.png";
import sharpOpenHand from "./cursors/hand-open@2x.png";
import openHand from "./cursors/hand-open.png";
import type { HandCursor } from "./hand-tool.ts";

interface CursorLook {
  readonly fallback: string;
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly image: string;
  readonly sharpImage: string;
}

const CURSOR_LOOKS: Readonly<Record<Exclude<HandCursor, "none">, CursorLook>> = {
  blocked: { fallback: "not-allowed", hotspotX: 16, hotspotY: 10, image: blockedHand, sharpImage: sharpBlockedHand },
  closed: { fallback: "grabbing", hotspotX: 16, hotspotY: 10, image: closedHand, sharpImage: sharpClosedHand },
  open: { fallback: "grab", hotspotX: 16, hotspotY: 18, image: openHand, sharpImage: sharpOpenHand },
};

export function handCursorStyles(cursor: HandCursor): readonly string[] {
  if (cursor === "none") {
    return [""];
  }

  const { fallback, hotspotX, hotspotY, image, sharpImage } = CURSOR_LOOKS[cursor];

  const single = `url("${image}")`;
  const sharp = `${single} 1x, url("${sharpImage}") 2x`;
  const hotspot = `${hotspotX} ${hotspotY}`;

  return [
    fallback,
    `${single} ${hotspot}, ${fallback}`,
    `-webkit-image-set(${sharp}) ${hotspot}, ${fallback}`,
    `image-set(${sharp}) ${hotspot}, ${fallback}`,
  ];
}

export function showHandCursor(element: HTMLElement, cursor: HandCursor): void {
  for (const style of handCursorStyles(cursor)) {
    element.style.cursor = style;
  }
}
