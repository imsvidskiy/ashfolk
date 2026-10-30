import { smoothstep } from "../../shared/math.ts";
import { NO_PLANT, type PlantPlacement } from "../../world/vegetation-store.ts";
import type { WorldState } from "../world/world-state.ts";

const SEEDLING_SHARE = 0.2;
const GROWTH_STEP_DAYS = 0.1;
const VISIBLE_GROWTH = 0.03;

export interface NurserySnapshot {
  pendingDays: number;
  seedlings: Seedling[];
}

interface Seedling {
  readonly bornDay: number;
  readonly growingDays: number;
  readonly index: number;
  progress: number;
  readonly species: number;
  readonly targetHeight: number;
}

export class Nursery {
  readonly #world: WorldState;
  #pendingDays = 0;
  #seedlings: Seedling[] = [];

  constructor(world: WorldState) {
    this.#world = world;
  }

  snapshot(): NurserySnapshot {
    return {
      pendingDays: this.#pendingDays,
      seedlings: this.#seedlings.map((seedling) => {
        return { ...seedling };
      }),
    };
  }

  restore(snapshot: NurserySnapshot): void {
    this.#pendingDays = snapshot.pendingDays;
    this.#seedlings = snapshot.seedlings.map((seedling) => {
      return { ...seedling };
    });
  }

  plant(placement: PlantPlacement, growingDays: number): void {
    const world = this.#world;

    const index = world.plant({ ...placement, height: placement.height * SEEDLING_SHARE });

    if (index === NO_PLANT) {
      return;
    }

    this.#seedlings.push({
      bornDay: world.vegetation.bornDay[index],
      growingDays,
      index,
      progress: 0,
      species: placement.species,
      targetHeight: placement.height,
    });
  }

  grow(days: number): void {
    this.#pendingDays += days;

    if (this.#pendingDays < GROWTH_STEP_DAYS) {
      return;
    }

    const step = this.#pendingDays;

    this.#pendingDays = 0;
    this.#seedlings = this.#seedlings.filter((seedling) => {
      return this.#growSeedling(seedling, step);
    });
  }

  #growSeedling(seedling: Seedling, days: number): boolean {
    const { vegetation } = this.#world;

    if (!this.#isStillGrowing(seedling)) {
      return false;
    }

    seedling.progress = Math.min(1, seedling.progress + days / seedling.growingDays);

    const height =
      seedling.targetHeight * (SEEDLING_SHARE + (1 - SEEDLING_SHARE) * smoothstep(0, 1, seedling.progress));

    const isVisible = height - vegetation.height[seedling.index] >= seedling.targetHeight * VISIBLE_GROWTH;

    if (isVisible || seedling.progress >= 1) {
      vegetation.setHeight(seedling.index, height);
    }

    return seedling.progress < 1;
  }

  #isStillGrowing(seedling: Seedling): boolean {
    const { vegetation } = this.#world;
    const { index } = seedling;

    return (
      vegetation.isAlive(index) &&
      vegetation.species[index] === seedling.species &&
      vegetation.bornDay[index] === seedling.bornDay
    );
  }
}
