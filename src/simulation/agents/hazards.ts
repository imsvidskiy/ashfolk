import { FULL_TURN } from "../../shared/math.ts";
import type { FireSystem } from "../nature/fire.ts";
import type { WorldState } from "../world/world-state.ts";
import type { Waypoint } from "./navigation.ts";

const VISIBLE_FIRE = 0.08;
const FIRE_NEAR_CAMP = 0.2;
const CAMP_WATCH_DIRECTIONS = 24;
const CAMP_WATCH_NEAREST = 60;
const CAMP_WATCH_SPACING = 90;
const CAMP_WATCH_RINGS = 3;

export interface DangerZone {
  radius: number;
  remainingSeconds: number;
  x: number;
  z: number;
}

export class HazardMap {
  readonly #fire: FireSystem;
  readonly #world: WorldState;
  #zones: DangerZone[] = [];

  constructor(world: WorldState, fire: FireSystem) {
    this.#world = world;
    this.#fire = fire;
  }

  snapshot(): DangerZone[] {
    return this.#zones.map((zone) => {
      return { ...zone };
    });
  }

  restore(zones: readonly DangerZone[]): void {
    this.#zones = zones.map((zone) => {
      return { ...zone };
    });
  }

  addZone(zone: DangerZone): void {
    this.#zones.push({ ...zone });
  }

  update(seconds: number): void {
    for (const zone of this.#zones) {
      zone.remainingSeconds -= seconds;
    }

    this.#zones = this.#zones.filter((zone) => {
      return zone.remainingSeconds > 0;
    });
  }

  dangerNear(x: number, z: number, radius: number): Waypoint | null {
    for (const zone of this.#zones) {
      if (Math.hypot(zone.x - x, zone.z - z) < zone.radius) {
        return { x: zone.x, z: zone.z };
      }
    }

    return this.#fireNear(x, z, radius);
  }

  isFireAround(x: number, z: number): boolean {
    for (let direction = 0; direction < CAMP_WATCH_DIRECTIONS; direction += 1) {
      const angle = (direction / CAMP_WATCH_DIRECTIONS) * FULL_TURN;
      const distance = CAMP_WATCH_NEAREST + (direction % CAMP_WATCH_RINGS) * CAMP_WATCH_SPACING;

      if (this.#isBurningAt(x + Math.cos(angle) * distance, z + Math.sin(angle) * distance)) {
        return true;
      }
    }

    return false;
  }

  #fireNear(x: number, z: number, radius: number): Waypoint | null {
    if (this.#fire.burningCount === 0) {
      return null;
    }

    const { grid } = this.#world;
    const { fire } = this.#world.fields;

    const centerColumn = grid.columnAt(x);
    const centerRow = grid.rowAt(z);
    const reach = Math.ceil(radius / grid.cellSize);

    let weightedColumn = 0;
    let weightedRow = 0;
    let totalWeight = 0;

    for (let rowOffset = -reach; rowOffset <= reach; rowOffset += 1) {
      for (let columnOffset = -reach; columnOffset <= reach; columnOffset += 1) {
        const distanceSquared = columnOffset * columnOffset + rowOffset * rowOffset;
        const column = centerColumn + columnOffset;
        const row = centerRow + rowOffset;

        if (distanceSquared > reach * reach || !grid.contains(column, row)) {
          continue;
        }

        if (fire[grid.index(column, row)] > VISIBLE_FIRE) {
          const weight = 1 / (1 + distanceSquared);

          weightedColumn += columnOffset * weight;
          weightedRow += rowOffset * weight;
          totalWeight += weight;
        }
      }
    }

    if (totalWeight === 0) {
      return null;
    }

    return {
      x: grid.centerX(centerColumn) + (weightedColumn / totalWeight) * grid.cellSize,
      z: grid.centerZ(centerRow) + (weightedRow / totalWeight) * grid.cellSize,
    };
  }

  #isBurningAt(x: number, z: number): boolean {
    const cell = this.#world.grid.cellAt(x, z);

    if (cell < 0) {
      return false;
    }

    return this.#world.fields.fire[cell] > FIRE_NEAR_CAMP;
  }
}
