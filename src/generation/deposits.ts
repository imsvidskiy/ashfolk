import { DEPOSIT_KINDS, DEPOSITS, type DepositKind } from "../content/deposits.ts";
import { Ground } from "../content/grounds.ts";
import { FULL_TURN } from "../shared/math.ts";
import { createRandom, type RandomSource } from "../shared/random.ts";
import type { Deposit } from "../world/deposits.ts";
import { slopeAt } from "../world/footing.ts";
import type { TerrainData } from "../world/terrain-data.ts";
import { isWaterCell, touchesWaterCell } from "../world/terrain-sampling.ts";
import type { VegetationStore } from "../world/vegetation-store.ts";
import type { WorldGrid } from "../world/world-grid.ts";

const RIM_MARGIN = 140;
const HILL_SHARE = 0.25;
const GENTLEST_VEIN_SLOPE = 0.1;
const STEEPEST_VEIN_SLOPE = 0.72;
const STEEPEST_CLAY_SLOPE = 0.25;
const CLAY_WATER_REACH = 3;
const ORE_SPACING = 140;
const CLAY_SPACING = 110;
const ATTEMPTS_PER_DEPOSIT = 60;
const SMALLEST_VEIN = 4;
const VEIN_WIDTH = 0.375;
const VEIN_WAVINESS = 0.16;
const CLAY_BANK_REACH = 0.65;
const FOREST_VEIN_CELLS = 6;
const SMALLEST_OPEN_SHARE = 0.15;
const BARREN_GROUNDS: ReadonlySet<number> = new Set([Ground.Snow, Ground.Sand]);

interface DepositPlanner {
  readonly grid: WorldGrid;
  readonly placed: Deposit[];
  readonly random: RandomSource;
  readonly reserved: Uint8Array;
  readonly terrain: TerrainData;
}

function isLand(planner: DepositPlanner, cell: number): boolean {
  const { grid, reserved, terrain } = planner;

  if (terrain.coastDistance[cell] < RIM_MARGIN || grid.isOnEdge(cell)) {
    return false;
  }

  return reserved[cell] === 0 && !isWaterCell(terrain, cell) && !BARREN_GROUNDS.has(terrain.ground[cell]);
}

function hillHeight(planner: DepositPlanner): number {
  const heights: number[] = [];

  for (let cell = 0; cell < planner.grid.cellCount; cell += 1) {
    if (isLand(planner, cell)) {
      heights.push(planner.terrain.height[cell]);
    }
  }

  const sorted = Float32Array.from(heights).sort();

  if (sorted.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return sorted[Math.floor(sorted.length * HILL_SHARE)];
}

function isVeinGround(planner: DepositPlanner, cell: number): boolean {
  if (!isLand(planner, cell) || touchesWaterCell(planner.terrain, planner.grid, cell)) {
    return false;
  }

  const slope = slopeAt(planner.terrain.height, planner.grid, cell);

  return slope >= GENTLEST_VEIN_SLOPE && slope <= STEEPEST_VEIN_SLOPE;
}

function isForested(planner: DepositPlanner, cell: number): boolean {
  return planner.terrain.ground[cell] === Ground.Forest;
}

function preferOpenGround(planner: DepositPlanner, cells: readonly number[]): readonly number[] {
  const open = cells.filter((cell) => {
    return !isForested(planner, cell);
  });

  return open.length >= cells.length * SMALLEST_OPEN_SHARE ? open : cells;
}

function isNearWater(planner: DepositPlanner, cell: number): boolean {
  const { grid, terrain } = planner;

  const reach = grid.cellSize * CLAY_WATER_REACH;

  return grid.cellsInRadius(grid.cellCenterX(cell), grid.cellCenterZ(cell), reach).some((other) => {
    return isWaterCell(terrain, other);
  });
}

function isClayGround(planner: DepositPlanner, cell: number): boolean {
  return (
    isLand(planner, cell) &&
    slopeAt(planner.terrain.height, planner.grid, cell) <= STEEPEST_CLAY_SLOPE &&
    isNearWater(planner, cell)
  );
}

function cellsWhere(planner: DepositPlanner, isCandidate: (cell: number) => boolean): number[] {
  const candidates: number[] = [];

  for (let cell = 0; cell < planner.grid.cellCount; cell += 1) {
    if (isCandidate(cell)) {
      candidates.push(cell);
    }
  }

  return candidates;
}

function isFarFromOthers(planner: DepositPlanner, kind: DepositKind, x: number, z: number): boolean {
  return planner.placed.every((deposit) => {
    const spacing = deposit.kind === "clay" || kind === "clay" ? CLAY_SPACING : ORE_SPACING;

    return Math.hypot(deposit.x - x, deposit.z - z) >= spacing;
  });
}

function isInVein(planner: DepositPlanner, center: number, cell: number, angle: number, radius: number): boolean {
  const { grid } = planner;

  const offsetX = (grid.cellCenterX(cell) - grid.cellCenterX(center)) / radius;
  const offsetZ = (grid.cellCenterZ(cell) - grid.cellCenterZ(center)) / radius;

  const along = offsetX * Math.cos(angle) + offsetZ * Math.sin(angle);
  const across = -offsetX * Math.sin(angle) + offsetZ * Math.cos(angle);

  const wave = Math.sin(along * Math.PI * 1.6) * VEIN_WAVINESS;

  return Math.abs(across - wave) < VEIN_WIDTH && Math.abs(along) <= 1;
}

function isInClayBank(planner: DepositPlanner, center: number, cell: number, radius: number): boolean {
  const { grid } = planner;

  return grid.distanceBetween(center, cell) < CLAY_BANK_REACH * radius;
}

function veinCells(planner: DepositPlanner, kind: DepositKind, center: number): number[] {
  const { grid, random } = planner;
  const { radius } = DEPOSITS[kind];

  const angle = random.next() * FULL_TURN;
  const nearby = grid.cellsInRadius(grid.cellCenterX(center), grid.cellCenterZ(center), radius);

  if (kind === "clay") {
    return nearby.filter((cell) => {
      return isClayGround(planner, cell) && isInClayBank(planner, center, cell, radius);
    });
  }

  const vein = nearby.filter((cell) => {
    return isVeinGround(planner, cell) && isInVein(planner, center, cell, angle, radius);
  });
  const forested = vein
    .filter((cell) => {
      return isForested(planner, cell);
    })
    .sort((first, second) => {
      return grid.distanceBetween(center, first) - grid.distanceBetween(center, second);
    });
  const kept = new Set(forested.slice(0, FOREST_VEIN_CELLS));

  return vein.filter((cell) => {
    return !isForested(planner, cell) || kept.has(cell);
  });
}

function placeDeposit(planner: DepositPlanner, kind: DepositKind, candidates: readonly number[]): void {
  const { grid, random } = planner;

  for (let attempt = 0; attempt < ATTEMPTS_PER_DEPOSIT; attempt += 1) {
    const center = random.pick(candidates);

    const x = grid.cellCenterX(center);
    const z = grid.cellCenterZ(center);

    if (!isFarFromOthers(planner, kind, x, z)) {
      continue;
    }

    const cells = veinCells(planner, kind, center);

    if (cells.length >= SMALLEST_VEIN) {
      planner.placed.push({ cells, id: planner.placed.length, kind, x, z });

      return;
    }
  }
}

export function planDeposits(grid: WorldGrid, terrain: TerrainData, seed: number, reserved: Uint8Array): Deposit[] {
  const planner: DepositPlanner = { grid, placed: [], random: createRandom(seed * 13 + 29), reserved, terrain };

  const hill = hillHeight(planner);
  const ores = preferOpenGround(
    planner,
    cellsWhere(planner, (cell) => {
      return planner.terrain.height[cell] >= hill && isVeinGround(planner, cell);
    })
  );
  const clay = cellsWhere(planner, (cell) => {
    return isClayGround(planner, cell);
  });
  const candidates = DEPOSIT_KINDS.map((kind) => {
    return { cells: kind === "clay" ? clay : ores, kind };
  });
  const counts = DEPOSIT_KINDS.map((kind) => {
    return Math.round(DEPOSITS[kind].perSquareKilometer * grid.squareKilometers);
  });
  const rounds = Math.max(...counts);

  for (let round = 0; round < rounds; round += 1) {
    for (const [index, { cells, kind }] of candidates.entries()) {
      if (cells.length > 0 && round < counts[index]) {
        placeDeposit(planner, kind, cells);
      }
    }
  }

  return planner.placed;
}

export function exposeDeposits(terrain: TerrainData, vegetation: VegetationStore, deposits: readonly Deposit[]): void {
  for (const deposit of deposits) {
    const { ground } = DEPOSITS[deposit.kind];

    for (const cell of deposit.cells) {
      terrain.ground[cell] = ground;
      vegetation.clearCell(cell, false);
    }
  }
}
