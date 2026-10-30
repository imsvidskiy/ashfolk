import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import type { SoundEngine } from "./sound-engine.ts";

export const ACTION_RANK = 2;

const CLICK_RANK = 1;

const CLICKABLE = [
  "a[href]",
  "button",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(", ");

interface Request {
  readonly rank: number;
  readonly sound: SoundDefinition;
}

function clickSound(target: EventTarget | null): SoundDefinition | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const clicked = target.closest(CLICKABLE);

  if (clicked === null || clicked.matches(':disabled, [aria-disabled="true"]')) {
    return null;
  }

  return clicked.getAttribute("role") === "tab" ? SOUNDS.uiTab : SOUNDS.uiClick;
}

export class InterfaceSounds {
  readonly #engine: SoundEngine;
  #pending: Request | null = null;

  constructor(engine: SoundEngine) {
    this.#engine = engine;
  }

  attach(root: Document): () => void {
    const abort = new AbortController();

    root.addEventListener(
      "click",
      (event) => {
        const sound = clickSound(event.target);

        if (sound !== null) {
          this.request(sound, CLICK_RANK);
        }
      },
      { capture: true, signal: abort.signal }
    );

    return () => {
      abort.abort();
    };
  }

  request(sound: SoundDefinition, rank: number): void {
    const pending = this.#pending;

    if (pending === null) {
      setTimeout(() => {
        this.#flush();
      }, 0);
    }

    if (pending === null || rank > pending.rank) {
      this.#pending = { rank, sound };
    }
  }

  #flush(): void {
    const pending = this.#pending;

    this.#pending = null;

    if (pending !== null) {
      this.#engine.play(pending.sound, null);
    }
  }
}
