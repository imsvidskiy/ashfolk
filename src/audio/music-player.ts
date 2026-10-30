import { MUSIC_TRACKS } from "./sound-catalog.ts";
import type { SoundEngine } from "./sound-engine.ts";

const FIRST_TRACK_DELAY_SECONDS = 8;
const SHORTEST_REST_SECONDS = 45;
const LONGEST_REST_SECONDS = 120;
const RETRY_SECONDS = 5;
const FADE_IN_SECONDS = 4;
const FADE_OUT_SECONDS = 3;

export type Mood = "day" | "dusk" | "night";

const MOODS: Readonly<Record<Mood, readonly string[]>> = {
  day: [...MUSIC_TRACKS.cozyDay, ...MUSIC_TRACKS.arcadeDay],
  dusk: [...MUSIC_TRACKS.cozyDusk],
  night: [...MUSIC_TRACKS.cozyNight, ...MUSIC_TRACKS.arcadeNight],
};

interface Output {
  readonly element: HTMLAudioElement;
  readonly gain: GainNode;
}

export function moodAt(hours: number): Mood {
  if (hours >= 7 && hours < 17) {
    return "day";
  }

  if ((hours >= 5 && hours < 7) || (hours >= 17 && hours < 20)) {
    return "dusk";
  }

  return "night";
}

export function nextTrack(mood: Mood, previous: string | null, roll: number): string {
  const choices = MOODS[mood].filter((track) => {
    return track !== previous;
  });

  return choices[Math.min(choices.length - 1, Math.floor(roll * choices.length))];
}

export class MusicPlayer {
  readonly #engine: SoundEngine;
  #output: Output | null = null;
  #previous: string | null = null;
  #startsAt: number | null;

  constructor(engine: SoundEngine, now: number) {
    this.#engine = engine;
    this.#startsAt = now + FIRST_TRACK_DELAY_SECONDS;
  }

  update(now: number, hours: number): void {
    const output = this.#ensureOutput();

    if (output === null) {
      return;
    }

    if (!this.#engine.isAudible || this.#engine.levels.music <= 0) {
      output.element.pause();

      return;
    }

    if (this.#startsAt === null) {
      this.#resume(output, now);

      return;
    }

    if (now >= this.#startsAt) {
      this.#start(output, now, hours);
    }
  }

  dispose(): void {
    const output = this.#output;

    this.#output = null;

    if (output === null) {
      return;
    }

    const { context } = output.gain;

    output.gain.gain.setTargetAtTime(0, context.currentTime, FADE_OUT_SECONDS / 3);
    setTimeout(() => {
      output.element.pause();
      output.element.removeAttribute("src");
      output.gain.disconnect();
    }, FADE_OUT_SECONDS * 1000);
  }

  #ensureOutput(): Output | null {
    if (this.#output !== null) {
      return this.#output;
    }

    const { context } = this.#engine;
    const bus = this.#engine.busOutput("music");

    if (context === null || bus === null) {
      return null;
    }

    const element = new Audio();
    const gain = context.createGain();

    element.preload = "auto";
    gain.gain.value = 0;
    context.createMediaElementSource(element).connect(gain);
    gain.connect(bus);
    element.addEventListener("ended", () => {
      this.#startsAt =
        performance.now() / 1000 +
        SHORTEST_REST_SECONDS +
        Math.random() * (LONGEST_REST_SECONDS - SHORTEST_REST_SECONDS);
    });
    this.#output = { element, gain };

    return this.#output;
  }

  #start(output: Output, now: number, hours: number): void {
    const track = nextTrack(moodAt(hours), this.#previous, Math.random());
    const { context } = output.gain;

    this.#previous = track;
    this.#startsAt = null;
    output.element.src = track;
    output.gain.gain.cancelScheduledValues(context.currentTime);
    output.gain.gain.setValueAtTime(0, context.currentTime);
    output.gain.gain.setTargetAtTime(1, context.currentTime, FADE_IN_SECONDS / 3);
    output.element.play().catch(() => {
      this.#startsAt = now + RETRY_SECONDS;
    });
  }

  #resume(output: Output, now: number): void {
    if (!output.element.paused) {
      return;
    }

    output.element.play().catch(() => {
      this.#startsAt = now + RETRY_SECONDS;
    });
  }
}
