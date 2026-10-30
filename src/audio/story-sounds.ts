import type { ChronicleCategory, ChronicleEntry } from "../simulation/chronicle.ts";
import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import type { SoundEngine } from "./sound-engine.ts";

const JINGLE_GAP_SECONDS = 4;
const NEARBY_REACH = 150;
const NEARBY_VIEW_SHARE = 1.5;

const CUES: ReadonlyMap<ChronicleCategory, StoryCue> = new Map([
  ["arrival", { isNearbyOnly: false, isPlaced: false, rank: 1, sound: SOUNDS.uiNotice }],
  ["beast", { isNearbyOnly: false, isPlaced: false, rank: 1, sound: SOUNDS.uiNotice }],
  ["birth", { isNearbyOnly: true, isPlaced: false, rank: 2, sound: SOUNDS.eventBirth }],
  ["building", { isNearbyOnly: true, isPlaced: true, rank: 0, sound: SOUNDS.buildingDone }],
  ["death", { isNearbyOnly: true, isPlaced: false, rank: 2, sound: SOUNDS.eventDeath }],
  ["discovery", { isNearbyOnly: false, isPlaced: false, rank: 3, sound: SOUNDS.eventDiscovery }],
  ["era", { isNearbyOnly: false, isPlaced: false, rank: 5, sound: SOUNDS.eventEra }],
  ["feud", { isNearbyOnly: false, isPlaced: false, rank: 4, sound: SOUNDS.eventRaid }],
  ["peace", { isNearbyOnly: false, isPlaced: false, rank: 1, sound: SOUNDS.uiNotice }],
  ["raid", { isNearbyOnly: false, isPlaced: false, rank: 4, sound: SOUNDS.eventRaid }],
  ["split", { isNearbyOnly: false, isPlaced: false, rank: 1, sound: SOUNDS.uiNotice }],
  ["warning", { isNearbyOnly: false, isPlaced: false, rank: 1, sound: SOUNDS.uiNotice }],
]);

interface StoryCue {
  readonly isNearbyOnly: boolean;
  readonly isPlaced: boolean;
  readonly rank: number;
  readonly sound: SoundDefinition;
}

export interface StoryView {
  readonly focusX: number;
  readonly focusZ: number;
  readonly viewDistance: number;
}

interface Heard {
  readonly cue: StoryCue;
  readonly entry: ChronicleEntry;
}

function isNearby(entry: ChronicleEntry, view: StoryView): boolean {
  const reach = NEARBY_REACH + view.viewDistance * NEARBY_VIEW_SHARE;

  return Math.hypot(entry.x - view.focusX, entry.z - view.focusZ) < reach;
}

export function loudestStory(entries: readonly ChronicleEntry[], view: StoryView): Heard | null {
  let loudest: Heard | null = null;

  for (const entry of entries) {
    const cue = CUES.get(entry.category);

    if (cue === undefined || (cue.isNearbyOnly && !isNearby(entry, view))) {
      continue;
    }

    if (loudest === null || cue.rank > loudest.cue.rank) {
      loudest = { cue, entry };
    }
  }

  return loudest;
}

export class StorySounds {
  readonly #engine: SoundEngine;
  readonly #heightAt: (x: number, z: number) => number;
  #quietUntil = Number.NEGATIVE_INFINITY;

  constructor(engine: SoundEngine, heightAt: (x: number, z: number) => number) {
    this.#engine = engine;
    this.#heightAt = heightAt;
  }

  hear(entries: readonly ChronicleEntry[], view: StoryView, now: number): void {
    const heard = loudestStory(entries, view);

    if (heard === null) {
      return;
    }

    const { cue, entry } = heard;

    if (cue.isPlaced) {
      this.#engine.play(cue.sound, { x: entry.x, y: this.#heightAt(entry.x, entry.z), z: entry.z });

      return;
    }

    if (now < this.#quietUntil) {
      return;
    }

    this.#quietUntil = now + JINGLE_GAP_SECONDS;
    this.#engine.play(cue.sound, null);
  }
}
