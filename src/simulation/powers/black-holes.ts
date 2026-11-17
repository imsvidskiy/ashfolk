import type { Mover } from "../agents/movement.ts";
import type { BlackHoleEffect, EffectLog } from "../effects.ts";
import type { PowerServices } from "./power-handler.ts";

const PULL_PER_SECOND = 0.65;
const CORE_RADIUS = 0.14;

export interface BlackHole {
  effect: BlackHoleEffect;
  remaining: number;
}

function pull(mover: Mover, hole: BlackHoleEffect, seconds: number, services: PowerServices): void {
  const deltaX = hole.x - mover.x;
  const deltaZ = hole.z - mover.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const travel = (hole.radius - distance) * PULL_PER_SECOND * seconds;
  const share = Math.min(1, travel / Math.max(0.01, distance));
  const x = mover.x + deltaX * share;
  const z = mover.z + deltaZ * share;

  const { world } = services;
  const start = world.grid.cellAt(mover.x, mover.z);
  const canReach = world.grid.traceAlong(mover.x, mover.z, x, z, (cell) => {
    return cell === start || world.isWalkable(cell);
  });

  if (canReach && world.isWalkableAt(x, z)) {
    mover.x = x;
    mover.z = z;
  }
}

function attract(hole: BlackHoleEffect, seconds: number, services: PowerServices): void {
  const { buildings, fauna, people } = services;
  const { radius, x, z } = hole;
  const coreRadius = radius * CORE_RADIUS;

  for (const person of people.livingWithin(x, z, radius)) {
    pull(person.mover, hole, seconds, services);
  }

  for (const animal of fauna.livingWithin(x, z, radius)) {
    pull(animal.mover, hole, seconds, services);
  }

  people.damageArea(x, z, coreRadius, seconds * 2, "gravity");
  fauna.damageArea(x, z, coreRadius, seconds * 3, "gravity");
  buildings.damageArea(x, z, coreRadius, seconds * 55, false);
}

export class BlackHoleSystem {
  readonly #holes: BlackHole[] = [];

  get isActive(): boolean {
    return this.#holes.length > 0;
  }

  snapshot(): BlackHole[] {
    return structuredClone(this.#holes);
  }

  restore(holes: readonly BlackHole[], effects: EffectLog): void {
    this.#holes.length = 0;

    for (const hole of holes) {
      this.#holes.push(structuredClone(hole));
      effects.add({ ...hole.effect, elapsedSeconds: hole.effect.durationSeconds - hole.remaining });
    }
  }

  open(effect: BlackHoleEffect, services: PowerServices): void {
    this.#holes.push({ effect, remaining: effect.durationSeconds });
    services.effects.add(effect);
  }

  update(seconds: number, services: PowerServices): void {
    for (let index = this.#holes.length - 1; index >= 0; index -= 1) {
      const hole = this.#holes[index];

      attract(hole.effect, Math.min(seconds, hole.remaining), services);
      hole.remaining -= seconds;

      if (hole.remaining <= 0) {
        this.#holes.splice(index, 1);
      }
    }
  }
}
