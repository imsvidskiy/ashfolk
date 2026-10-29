import { type CellRegion, grownRegion } from "../../world/change-tracking.ts";
import { NEIGHBOR_OFFSETS } from "../../world/world-grid.ts";
import type { WorldState } from "../world/world-state.ts";
import { LandAreas, NO_REGION } from "./land-areas.ts";
import { nearestWalkableSpot, pointInsideCell } from "./walkable-ground.ts";

const LANDING_SEARCH_RADIUS = 120;
const NO_SHORE = 65_535;
const DETOUR_FACTOR = 1.5;
const DETOUR_SLACK = 80;

export interface Waypoint {
  x: number;
  z: number;
}

export function aroundPoint(center: Waypoint, distance: number, angle: number): Waypoint {
  return { x: center.x + Math.cos(angle) * distance, z: center.z + Math.sin(angle) * distance };
}

function isDryLand(world: WorldState, cell: number): boolean {
  return world.isOnIsland(cell) && !world.isWater(cell);
}

export class NavigationGrid {
  readonly #areas: LandAreas;
  readonly #shoreQueue: Int32Array;
  readonly #shoreSteps: Uint16Array;
  readonly #leadsToSteepShore: Uint8Array;
  readonly #world: WorldState;
  #builtHeightVersion = -1;
  #builtWaterVersion = -1;

  constructor(world: WorldState) {
    this.#world = world;
    this.#areas = new LandAreas(world);
    this.#shoreQueue = new Int32Array(world.grid.cellCount);
    this.#shoreSteps = new Uint16Array(world.grid.cellCount);
    this.#leadsToSteepShore = new Uint8Array(world.grid.cellCount);
    this.rebuild();
  }

  rebuild(): void {
    this.#areas.rebuild();
    this.#measureShores();
    this.#world.footingChanges.takeRegion();

    this.#builtHeightVersion = this.#world.heightVersion;
    this.#builtWaterVersion = this.#world.waterVersion;
  }

  rebuildIfChanged(): boolean {
    const world = this.#world;

    if (world.heightVersion === this.#builtHeightVersion && world.waterVersion === this.#builtWaterVersion) {
      return false;
    }

    const region = world.footingChanges.takeRegion();

    if (world.waterVersion === this.#builtWaterVersion && region !== null && this.#keepsFooting(region)) {
      this.#builtHeightVersion = world.heightVersion;

      return false;
    }

    this.rebuild();

    return true;
  }

  landingSpot(point: Waypoint): Waypoint {
    const world = this.#world;

    const cell = world.grid.cellAt(point.x, point.z);

    if (cell < 0 || !world.isWater(cell)) {
      return point;
    }

    return nearestWalkableSpot(world, point, LANDING_SEARCH_RADIUS);
  }

  walkLength(from: Waypoint, to: Waypoint): number {
    return this.#areas.walkLength(from, to);
  }

  isWithinWalk(from: Waypoint, to: Waypoint): boolean {
    const straight = Math.hypot(to.x - from.x, to.z - from.z);

    return this.#areas.walkLength(from, to) <= straight * DETOUR_FACTOR + DETOUR_SLACK;
  }

  reachableSpot(from: Waypoint, to: Waypoint): Waypoint {
    const region = this.#areas.regionNear(from);

    if (region === NO_REGION || region === this.#areas.regionNear(to)) {
      return to;
    }

    return this.#areas.nearestInRegion(to, region, from);
  }

  stepAshore(x: number, z: number): Waypoint | null {
    const world = this.#world;

    const cell = world.grid.cellAt(x, z);

    if (cell < 0 || !world.isWater(cell)) {
      return null;
    }

    const steps = this.#shoreSteps[cell];

    if (steps === 0) {
      return this.#nearestDryLand(x, z);
    }

    if (steps === NO_SHORE) {
      return null;
    }

    return this.#nearestStepAshore(cell, x, z);
  }

  isClear(from: Waypoint, to: Waypoint): boolean {
    return this.#areas.isClear(from, to);
  }

  findPath(from: Waypoint, to: Waypoint): Waypoint[] | null {
    if (this.#areas.isClear(from, to)) {
      return [{ x: to.x, z: to.z }];
    }

    return this.#areas.route(from, to);
  }

  #keepsFooting(region: CellRegion): boolean {
    const { grid } = this.#world;

    const { firstColumn, firstRow, lastColumn, lastRow } = grownRegion(region, 1, grid.cellsPerSide);

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const cell = grid.index(column, row);

        if (!this.#areas.keepsFooting(cell) || this.#world.isWater(cell) !== (this.#shoreSteps[cell] !== 0)) {
          return false;
        }
      }
    }

    return true;
  }

  #measureShores(): void {
    const world = this.#world;

    for (let cell = 0; cell < world.grid.cellCount; cell += 1) {
      this.#shoreSteps[cell] = world.isWater(cell) ? NO_SHORE : 0;
      this.#leadsToSteepShore[cell] = 0;
    }

    this.#spreadFromShore((cell) => {
      return world.isWalkable(cell);
    }, 0);
    this.#spreadFromShore((cell) => {
      return isDryLand(world, cell);
    }, 1);
  }

  #spreadFromShore(isShore: (cell: number) => boolean, leadsToSteepShore: number): void {
    const { grid } = this.#world;

    const steps = this.#shoreSteps;
    const queue = this.#shoreQueue;

    let length = 0;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (steps[cell] === NO_SHORE && this.#bordersOn(cell, isShore)) {
        steps[cell] = 1;
        this.#leadsToSteepShore[cell] = leadsToSteepShore;
        queue[length] = cell;
        length += 1;
      }
    }

    for (let next = 0; next < length; next += 1) {
      const cell = queue[next];
      const column = grid.columnOf(cell);
      const row = grid.rowOf(cell);

      for (const offset of NEIGHBOR_OFFSETS) {
        const neighbor = grid.neighborIndex(column, row, offset);

        if (neighbor >= 0 && steps[neighbor] === NO_SHORE) {
          steps[neighbor] = steps[cell] + 1;
          this.#leadsToSteepShore[neighbor] = leadsToSteepShore;
          queue[length] = neighbor;
          length += 1;
        }
      }
    }
  }

  #bordersOn(cell: number, isShore: (cell: number) => boolean): boolean {
    const { grid } = this.#world;

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor >= 0 && isShore(neighbor)) {
        return true;
      }
    }

    return false;
  }

  #nearestStepAshore(cell: number, x: number, z: number): Waypoint | null {
    const world = this.#world;
    const { grid } = world;

    const closer = this.#shoreSteps[cell] - 1;
    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);

    let nearest: Waypoint | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = grid.neighborIndex(column, row, offset);

      if (neighbor < 0 || !this.#isStepAshore(neighbor, closer, this.#leadsToSteepShore[cell] === 1)) {
        continue;
      }

      const spot = pointInsideCell(world, neighbor, x, z);

      const distance = Math.hypot(spot.x - x, spot.z - z);

      if (distance < nearestDistance) {
        nearest = spot;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  #isStepAshore(cell: number, steps: number, isSteepShore: boolean): boolean {
    const world = this.#world;

    if (steps > 0) {
      return world.isWater(cell) && this.#shoreSteps[cell] === steps;
    }

    if (isSteepShore) {
      return isDryLand(world, cell);
    }

    return world.isWalkable(cell);
  }

  #nearestDryLand(x: number, z: number): Waypoint | null {
    const landing = nearestWalkableSpot(this.#world, { x, z }, LANDING_SEARCH_RADIUS);

    if (landing.x === x && landing.z === z) {
      return null;
    }

    return landing;
  }
}
