import { uniformFloat64 } from "pure-rand/distribution/uniformFloat64";
import { xoroshiro128plus, xoroshiro128plusFromState } from "pure-rand/generator/xoroshiro128plus";

const WARM_UP_DRAWS = 4;
const SEED_RANGE = 2_147_483_647;
const LABEL_STRIDE = 7919;

export type RandomState = readonly number[];

export interface RandomSource {
  between: (minimum: number, maximum: number) => number;
  chance: (probability: number) => boolean;
  derive: (label: number) => RandomSource;
  integer: (minimum: number, maximumExclusive: number) => number;
  next: () => number;
  pick: <Item>(items: readonly Item[]) => Item;
  restore: (state: RandomState) => void;
  signed: () => number;
  state: () => RandomState;
}

type Generator = ReturnType<typeof xoroshiro128plus>;

class SeededRandom implements RandomSource {
  #generator: Generator;

  constructor(generator: Generator) {
    this.#generator = generator;
  }

  next(): number {
    return uniformFloat64(this.#generator);
  }

  signed(): number {
    return this.next() * 2 - 1;
  }

  between(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }

  integer(minimum: number, maximumExclusive: number): number {
    return Math.floor(this.between(minimum, maximumExclusive));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<Item>(items: readonly Item[]): Item {
    if (items.length === 0) {
      throw new RangeError("Cannot pick from an empty list");
    }

    return items[this.integer(0, items.length)];
  }

  state(): RandomState {
    return [...this.#generator.getState()];
  }

  restore(state: RandomState): void {
    this.#generator = xoroshiro128plusFromState(state);
  }

  derive(label: number): RandomSource {
    return randomFromUnitSeed(this.next(), label * LABEL_STRIDE);
  }
}

export function createRandom(seed: number): RandomSource {
  const generator = xoroshiro128plus(seed);

  for (let draw = 0; draw < WARM_UP_DRAWS; draw += 1) {
    uniformFloat64(generator);
  }

  return new SeededRandom(generator);
}

export function randomFromUnitSeed(seed: number, salt: number): RandomSource {
  return createRandom(Math.floor(seed * SEED_RANGE) + salt);
}

export function shuffle<Items extends { [index: number]: unknown; length: number }>(
  random: RandomSource,
  items: Items
): Items {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = random.integer(0, index + 1);
    const kept = items[index];

    items[index] = items[swap];
    items[swap] = kept;
  }

  return items;
}
