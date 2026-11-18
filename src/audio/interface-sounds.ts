import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import type { SoundEngine } from "./sound-engine.ts";

export const ACTION_RANK = 2;

const CLICK_RANK = 1;

const CLICKABLE = [
  "a[href]",
  "button",
  "summary",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
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

  if (clicked.matches("summary") && clicked.parentElement instanceof HTMLDetailsElement) {
    return clicked.parentElement.open ? SOUNDS.uiClose : SOUNDS.uiOpen;
  }

  if (clicked.matches('[role="switch"], [role="checkbox"], [role="menuitemcheckbox"]')) {
    return clicked.getAttribute("aria-checked") === "true" ? SOUNDS.uiToggleOff : SOUNDS.uiToggleOn;
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

    root.addEventListener(
      "change",
      (event) => {
        const { target } = event;

        if (target instanceof HTMLSelectElement && !target.disabled) {
          this.request(SOUNDS.uiTab, CLICK_RANK);
        } else if (
          target instanceof HTMLInputElement &&
          target.type === "checkbox" &&
          !target.disabled &&
          target.getAttribute("aria-hidden") !== "true"
        ) {
          this.request(target.checked ? SOUNDS.uiToggleOn : SOUNDS.uiToggleOff, CLICK_RANK);
        }
      },
      { capture: true, signal: abort.signal }
    );

    return () => {
      abort.abort();
      this.#pending = null;
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
