import type { EffectLog } from "../effects.ts";
import { TICK_SECONDS } from "../tick.ts";
import { explode } from "./catastrophes.ts";
import type { PowerServices } from "./power-handler.ts";

export const BOMB_FALL_TICKS = 44;
export const ORIGINAL_BOMB_FALL_TICKS = 28;

export interface FallingBomb {
  dropId: number;
  durationTicks?: number;
  radius: number;
  remainingTicks: number;
  surfaceY: number;
  x: number;
  z: number;
}

function showFall(effects: EffectLog, bomb: FallingBomb): void {
  const { dropId, durationTicks = ORIGINAL_BOMB_FALL_TICKS, radius, remainingTicks, surfaceY, x, z } = bomb;

  effects.add({
    dropId,
    durationSeconds: durationTicks * TICK_SECONDS,
    elapsedSeconds: (durationTicks - remainingTicks) * TICK_SECONDS,
    kind: "nuclear-fall",
    radius,
    surfaceY,
    x,
    z,
  });
}

export class FallingBombs {
  #bombs: FallingBomb[] = [];

  get isActive(): boolean {
    return this.#bombs.length > 0;
  }

  snapshot(): FallingBomb[] {
    return structuredClone(this.#bombs);
  }

  restore(bombs: readonly FallingBomb[], effects: EffectLog): void {
    this.#bombs = bombs.map((bomb) => {
      showFall(effects, bomb);

      return { ...bomb };
    });
  }

  drop(services: PowerServices, x: number, z: number, radius: number): void {
    const bomb = {
      dropId: services.identifiers.next(),
      durationTicks: BOMB_FALL_TICKS,
      radius,
      remainingTicks: BOMB_FALL_TICKS,
      surfaceY: services.world.surfaceAt(x, z),
      x,
      z,
    };

    this.#bombs.push(bomb);
    showFall(services.effects, bomb);
  }

  update(services: PowerServices): void {
    let airborne = 0;

    for (const bomb of this.#bombs) {
      bomb.remainingTicks -= 1;

      if (bomb.remainingTicks === 0) {
        const { dropId, radius, x, z } = bomb;

        explode({ catastrophe: "nuclear", dropId, hasBurningDebris: true, power: 3, radius, x, z }, services);
        continue;
      }

      this.#bombs[airborne] = bomb;
      airborne += 1;
    }

    this.#bombs.length = airborne;
  }
}
