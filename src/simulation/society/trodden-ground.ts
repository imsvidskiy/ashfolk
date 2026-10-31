import { BUILDINGS, isEnclosure } from "../../content/buildings.ts";
import { smoothstep } from "../../shared/math.ts";
import type { WorldState } from "../world/world-state.ts";
import { type Building, isComplete } from "./buildings.ts";
import type { SocietyContext } from "./society-context.ts";
import type { Tribe } from "./tribe.ts";
import { tribeBuildings } from "./tribe-places.ts";

const UPDATE_DAYS = 0.1;
const REGROWTH_PER_DAY = 0.15;
const BUILDING_MARGIN = 4;
const SOFT_EDGE = 6;
const CAMP_CORE = 9;
const CORE_PER_MEMBER = 0.45;
const LARGEST_CORE = 17;
const PATH_WEAR = 0.55;
const MINE_PATH_WEAR = 0.42;
const SITE_WEAR = 0.6;

interface Patch {
  readonly radius: number;
  readonly wear: number;
  readonly x: number;
  readonly z: number;
}

type Wear = Map<number, number>;

export interface TroddenGroundSnapshot {
  cells: Int32Array;
  elapsedDays: number;
}

function wearOf(wear: Wear, cell: number): number {
  const value = wear.get(cell);

  if (value === undefined) {
    return 0;
  }

  return value;
}

function treadCamp(wear: Wear, tribe: Tribe, context: SocietyContext): void {
  if (tribe.isMigrating) {
    return;
  }

  const { world } = context;

  const core = Math.min(LARGEST_CORE, CAMP_CORE + tribe.memberCount * CORE_PER_MEMBER);

  treadPatch(wear, world, { radius: core, wear: 1, x: tribe.campX, z: tribe.campZ });

  for (const building of tribeBuildings(tribe, context.buildings)) {
    treadAround(wear, world, tribe, building);
  }
}

function treadAround(wear: Wear, world: WorldState, tribe: Tribe, building: Building): void {
  if (isEnclosure(building.kind)) {
    return;
  }

  const radius = BUILDINGS[building.kind].footprint + BUILDING_MARGIN;

  treadPatch(wear, world, { radius, wear: isComplete(building) ? 1 : SITE_WEAR, x: building.x, z: building.z });

  if (building.kind === "campfire") {
    return;
  }

  const pathWear = building.kind === "mine" ? MINE_PATH_WEAR : PATH_WEAR;

  for (const cell of world.grid.cellsAlong(tribe.campX, tribe.campZ, building.x, building.z)) {
    tread(wear, world, cell, pathWear);
  }
}

function treadPatch(wear: Wear, world: WorldState, patch: Patch): void {
  const { grid } = world;

  for (const cell of grid.cellsInRadius(patch.x, patch.z, patch.radius + SOFT_EDGE)) {
    const distance = Math.hypot(grid.cellCenterX(cell) - patch.x, grid.cellCenterZ(cell) - patch.z);

    tread(
      wear,
      world,
      cell,
      patch.wear * (1 - smoothstep(patch.radius - SOFT_EDGE, patch.radius + SOFT_EDGE, distance))
    );
  }
}

function tread(wear: Wear, world: WorldState, cell: number, amount: number): void {
  if (amount <= 0 || world.isWater(cell) || world.isObstructed(cell) || wearOf(wear, cell) >= amount) {
    return;
  }

  wear.set(cell, amount);
}

export class TroddenGround {
  readonly #cells = new Set<number>();
  #elapsedDays = 0;

  snapshot(): TroddenGroundSnapshot {
    return { cells: Int32Array.from(this.#cells), elapsedDays: this.#elapsedDays };
  }

  restore(snapshot: TroddenGroundSnapshot): void {
    this.#cells.clear();

    for (const cell of snapshot.cells) {
      this.#cells.add(cell);
    }

    this.#elapsedDays = snapshot.elapsedDays;
  }

  update(days: number, context: SocietyContext, tribes: readonly Tribe[]): void {
    this.#elapsedDays += days;

    if (this.#elapsedDays < UPDATE_DAYS) {
      return;
    }

    const elapsed = this.#elapsedDays;
    const wear: Wear = new Map();

    this.#elapsedDays = 0;

    for (const tribe of tribes) {
      treadCamp(wear, tribe, context);
    }

    this.#apply(context.world, wear, elapsed);
  }

  #apply(world: WorldState, wear: Wear, days: number): void {
    const cells = new Set([...this.#cells, ...wear.keys()]);

    for (const cell of cells) {
      const target = wearOf(wear, cell);
      const current = world.fields.trodden[cell];

      const next = current < target ? target : Math.max(target, current - REGROWTH_PER_DAY * days);

      world.setTrodden(cell, next);

      if (next > 0) {
        this.#cells.add(cell);
      } else {
        this.#cells.delete(cell);
      }
    }
  }
}
