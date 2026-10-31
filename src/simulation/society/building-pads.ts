import { BUILDINGS, type BuildingKind, isEnclosure } from "../../content/buildings.ts";
import { pondShoreReach } from "../../generation/ponds.ts";
import { NEIGHBOR_OFFSETS, type WorldGrid } from "../../world/world-grid.ts";
import type { Waypoint } from "../agents/navigation.ts";
import { levelGround } from "../world/terrain-editing.ts";
import { CROSSING_GROUND, MONUMENT_GROUND, SPRING_GROUND, type WorldState } from "../world/world-state.ts";
import type { Building } from "./buildings.ts";
import { cellsNear, distanceToCell } from "./footprints.ts";

export const DEEPEST_LEVELING = 1.5;
const KEPT_RELIEF = 0.04;
const COAST_CLEARANCE = 30;
const POOLING_DEPTH = 0.5;

export interface BuildingPad {
  readonly cells: readonly number[];
  readonly level: number;
  readonly unevenness: number;
}

export function isLeveled(kind: BuildingKind): boolean {
  return kind !== "mine" && !isEnclosure(kind);
}

export function groundUnderFootprint(grid: WorldGrid, spot: Waypoint, footprint: number): number[] {
  return cellsNear(grid, spot.x, spot.z, footprint, grid.cellSize);
}

function canReshape(world: WorldState, cell: number): boolean {
  const occupant = world.occupancy[cell];

  if (occupant === MONUMENT_GROUND || occupant === SPRING_GROUND || occupant === CROSSING_GROUND) {
    return false;
  }

  return world.terrain.coastDistance[cell] > COAST_CLEARANCE && !world.touchesWater(cell) && !isPondShore(world, cell);
}

function isPondShore(world: WorldState, cell: number): boolean {
  const { grid } = world;

  return world.water.springs.some((spring) => {
    return (
      spring.kind === "pond" &&
      Math.hypot(grid.cellCenterX(cell) - spring.x, grid.cellCenterZ(cell) - spring.z) <
        pondShoreReach(spring) + grid.cellSize
    );
  });
}

function isHeldByOther(grid: WorldGrid, cell: number, buildings: readonly Building[]): boolean {
  return buildings.some((building) => {
    return (
      !isEnclosure(building.kind) &&
      distanceToCell(grid, cell, building.x, building.z, grid.cellSize) < BUILDINGS[building.kind].footprint
    );
  });
}

function lowestAround(world: WorldState, cells: readonly number[]): number {
  const { grid } = world;

  const inside = new Set(cells);

  let lowest = Number.POSITIVE_INFINITY;

  for (const cell of cells) {
    const cellColumn = grid.columnOf(cell);
    const cellRow = grid.rowOf(cell);

    for (const offset of NEIGHBOR_OFFSETS) {
      const column = cellColumn + offset.column;
      const row = cellRow + offset.row;

      if (!grid.contains(column, row)) {
        continue;
      }

      const neighbor = grid.index(column, row);

      if (!inside.has(neighbor)) {
        lowest = Math.min(lowest, world.terrain.height[neighbor]);
      }
    }
  }

  return lowest;
}

export function planPad(
  world: WorldState,
  buildings: readonly Building[],
  spot: Waypoint,
  kind: BuildingKind
): BuildingPad | null {
  const cells = groundUnderFootprint(world.grid, spot, BUILDINGS[kind].footprint);

  const canReshapeAll = cells.every((cell) => {
    return canReshape(world, cell);
  });

  if (!canReshapeAll) {
    return null;
  }

  const heights = cells.map((cell) => {
    return world.terrain.height[cell];
  });
  const level =
    heights.reduce((total, height) => {
      return total + height;
    }, 0) / heights.length;

  if (lowestAround(world, cells) > level + POOLING_DEPTH) {
    return null;
  }

  return {
    cells: cells.filter((cell) => {
      return !isHeldByOther(world.grid, cell, buildings);
    }),
    level,
    unevenness: Math.max(
      ...heights.map((height) => {
        return Math.abs(height - level);
      })
    ),
  };
}

export function levelPad(world: WorldState, pad: BuildingPad): void {
  levelGround(world, pad.cells, { keptRelief: KEPT_RELIEF, largestChange: DEEPEST_LEVELING, level: pad.level });
}
