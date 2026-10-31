import { clamp, lerp, smoothstep } from "../shared/math.ts";
import { NO_WATER } from "./water.ts";
import type { WorldGrid } from "./world-grid.ts";

export const STONE_RISE = 0.18;
export const STEPPING_STONE_VARIANTS = 4;
export const LOG_ROOT_BEHIND = 1.5;
export const LOG_TIP_BEYOND = 0.9;
export const LOG_TAPER = 0.72;

const CROSSING_HALF_WIDTH: Readonly<Record<CrossingKind, number>> = { ford: 0.85, log: 0.55 };
const LOG_STEP_OFF = 0.6;
const LOG_THINNEST = 0.3;
const LOG_THICKEST = 0.46;
const LOG_THICKNESS_PER_METER = 0.012;
const LOG_SHORTEST = 9;
const CELL_SAMPLE_SPACING = 0.5;
const CELL_SAMPLES_ACROSS = 5;
const SHORTEST_SPAN = 1e-6;

interface CrossingSpan {
  readonly endX: number;
  readonly endZ: number;
  readonly id: number;
  readonly seed: number;
  readonly startX: number;
  readonly startZ: number;
}

export interface Ford extends CrossingSpan {
  readonly kind: "ford";
}

export interface LogBridge extends CrossingSpan {
  readonly endDeck: number;
  readonly kind: "log";
  readonly startDeck: number;
}

export type Crossing = Ford | LogBridge;

export type CrossingKind = Crossing["kind"];

interface CrossingPoint {
  readonly across: number;
  readonly along: number;
}

export interface Point {
  readonly x: number;
  readonly z: number;
}

interface FallenLog {
  readonly rootBottom: number;
  readonly rootRadius: number;
  readonly rootX: number;
  readonly rootZ: number;
  readonly tipBottom: number;
  readonly tipX: number;
  readonly tipZ: number;
}

export function crossingLength(crossing: CrossingSpan): number {
  return Math.hypot(crossing.endX - crossing.startX, crossing.endZ - crossing.startZ);
}

function spanLength(crossing: CrossingSpan): number {
  return Math.max(SHORTEST_SPAN, crossingLength(crossing));
}

export function crossingMiddle(crossing: CrossingSpan): Point {
  return { x: (crossing.startX + crossing.endX) / 2, z: (crossing.startZ + crossing.endZ) / 2 };
}

export function crossingDirection(crossing: CrossingSpan): Point {
  const length = spanLength(crossing);

  return { x: (crossing.endX - crossing.startX) / length, z: (crossing.endZ - crossing.startZ) / length };
}

export function crossingPointOf(crossing: CrossingSpan, x: number, z: number): CrossingPoint {
  const direction = crossingDirection(crossing);

  const offsetX = x - crossing.startX;
  const offsetZ = z - crossing.startZ;

  return {
    across: offsetZ * direction.x - offsetX * direction.z,
    along: offsetX * direction.x + offsetZ * direction.z,
  };
}

export function pointOnCrossing(crossing: CrossingSpan, along: number, across: number): Point {
  const direction = crossingDirection(crossing);

  return {
    x: crossing.startX + direction.x * along - direction.z * across,
    z: crossing.startZ + direction.z * along + direction.x * across,
  };
}

export function isOnCrossing(crossing: Crossing, x: number, z: number, margin = 0): boolean {
  const { across, along } = crossingPointOf(crossing, x, z);

  if (along < -margin || along > crossingLength(crossing) + margin) {
    return false;
  }

  return Math.abs(across) <= CROSSING_HALF_WIDTH[crossing.kind] + margin;
}

export function logDeckAt(log: LogBridge, along: number): number {
  const amount = clamp(along / spanLength(log), 0, 1);

  return lerp(log.startDeck, log.endDeck, amount);
}

export function footingOn(crossing: Crossing, x: number, z: number, ground: number, waterLevel: number): number {
  if (crossing.kind === "ford") {
    return waterLevel === NO_WATER ? ground : Math.max(ground, waterLevel + STONE_RISE);
  }

  const { across, along } = crossingPointOf(crossing, x, z);

  const deck = Math.max(ground, logDeckAt(crossing, along));
  const beside = Math.abs(across) - CROSSING_HALF_WIDTH.log;
  const beyond = Math.max(-along, along - crossingLength(crossing));

  return lerp(deck, ground, smoothstep(0, LOG_STEP_OFF, Math.max(beside, beyond)));
}

function logRootRadius(length: number, seed: number): number {
  const radius = clamp(LOG_THINNEST + (length - LOG_SHORTEST) * LOG_THICKNESS_PER_METER, LOG_THINNEST, LOG_THICKEST);

  return radius * (0.94 + 0.12 * seed);
}

function isRootAtStart(crossing: CrossingSpan): boolean {
  return crossing.seed < 0.5;
}

export function logRadiusAt(crossing: CrossingSpan, along: number): number {
  const length = crossingLength(crossing);
  const rootRadius = logRootRadius(length, crossing.seed);
  const trunkLength = length + LOG_ROOT_BEHIND + LOG_TIP_BEYOND;

  const fromRoot = isRootAtStart(crossing) ? along + LOG_ROOT_BEHIND : length - along + LOG_ROOT_BEHIND;

  return lerp(rootRadius, rootRadius * LOG_TAPER, clamp(fromRoot / trunkLength, 0, 1));
}

export function fallenLog(log: LogBridge): FallenLog {
  const length = spanLength(log);
  const hasRootAtStart = isRootAtStart(log);
  const direction = crossingDirection(log);

  const startBottom = log.startDeck - 2 * logRadiusAt(log, 0);
  const endBottom = log.endDeck - 2 * logRadiusAt(log, length);
  const startReach = hasRootAtStart ? LOG_ROOT_BEHIND : LOG_TIP_BEYOND;
  const endReach = hasRootAtStart ? LOG_TIP_BEYOND : LOG_ROOT_BEHIND;

  const rise = (endBottom - startBottom) / length;
  const rootRadius = logRootRadius(length, log.seed);

  const startEnd = {
    bottom: startBottom - rise * startReach,
    x: log.startX - direction.x * startReach,
    z: log.startZ - direction.z * startReach,
  };
  const endEnd = {
    bottom: endBottom + rise * endReach,
    x: log.endX + direction.x * endReach,
    z: log.endZ + direction.z * endReach,
  };

  const root = hasRootAtStart ? startEnd : endEnd;
  const tip = hasRootAtStart ? endEnd : startEnd;

  return {
    rootBottom: root.bottom,
    rootRadius,
    rootX: root.x,
    rootZ: root.z,
    tipBottom: tip.bottom,
    tipX: tip.x,
    tipZ: tip.z,
  };
}

export function crossingCells(grid: WorldGrid, crossing: Crossing, margin = 0): number[] {
  const length = crossingLength(crossing);
  const reach = CROSSING_HALF_WIDTH[crossing.kind] + margin;
  const cells = new Set<number>();

  for (let along = -margin; along <= length + margin; along += CELL_SAMPLE_SPACING) {
    for (let sample = 0; sample < CELL_SAMPLES_ACROSS; sample += 1) {
      const point = pointOnCrossing(crossing, along, lerp(-reach, reach, sample / (CELL_SAMPLES_ACROSS - 1)));
      const cell = grid.cellAt(point.x, point.z);

      if (cell >= 0) {
        cells.add(cell);
      }
    }
  }

  return [...cells].sort((first, second) => {
    return first - second;
  });
}

export class CrossingIndex {
  readonly #byCell = new Map<number, Crossing[]>();
  readonly #grid: WorldGrid;
  readonly #margin: number;

  constructor(grid: WorldGrid, crossings: readonly Crossing[], margin = 0) {
    this.#grid = grid;
    this.#margin = margin;

    for (const crossing of crossings) {
      for (const cell of crossingCells(grid, crossing, margin)) {
        const listed = this.#byCell.get(cell);

        if (listed === undefined) {
          this.#byCell.set(cell, [crossing]);

          continue;
        }

        listed.push(crossing);
      }
    }
  }

  crossingAt(x: number, z: number): Crossing | null {
    const listed = this.#byCell.get(this.#grid.cellAt(x, z));

    if (listed === undefined) {
      return null;
    }

    for (const crossing of listed) {
      if (isOnCrossing(crossing, x, z, this.#margin)) {
        return crossing;
      }
    }

    return null;
  }
}
