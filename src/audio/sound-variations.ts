import type { SoundDefinition } from "./sound-catalog.ts";

const PAIR_REPEAT_CHANCE = 0.25;

function nextIndex(count: number, last: number | undefined): number {
  if (last === undefined) {
    return Math.floor(Math.random() * count);
  }

  if (count === 2) {
    return Math.random() < PAIR_REPEAT_CHANCE ? last : 1 - last;
  }

  const other = Math.floor(Math.random() * (count - 1));

  return other < last ? other : other + 1;
}

export class SoundVariations {
  readonly #lastIndices = new WeakMap<SoundDefinition, number>();

  pick(sound: SoundDefinition): string {
    const count = sound.files.length;

    if (count === 1) {
      return sound.files[0];
    }

    const index = nextIndex(count, this.#lastIndices.get(sound));

    this.#lastIndices.set(sound, index);

    return sound.files[index];
  }
}
