import { refreshCrossings } from "../../generation/crossings.ts";
import { RESHAPED_LAND_HYDROLOGY } from "../../generation/drainage.ts";
import { computeHydrology } from "../../generation/hydrology.ts";
import { type CellRegion, regionOfCells } from "../../world/change-tracking.ts";
import { hasWater, type Lake, NO_WATER } from "../../world/water.ts";
import { NEIGHBOR_OFFSETS } from "../../world/world-grid.ts";
import { applySparse, type SparseValues, sparseDifference } from "./sparse-values.ts";
import type { WorldState } from "./world-state.ts";

const QUIET_SECONDS_BEFORE_RECOMPUTE = 0.7;
const PATCH_MARGIN_CELLS = 2;
const FILL_SECONDS = 5;
const FILL_STEP_SECONDS = 0.25;
const NOTICEABLE_RISE = 0.5;
const SUNKEN_LAND = 0.5;

interface RisingLake {
  readonly cells: readonly number[];
  readonly floor: number;
  readonly keptLevels: Float32Array;
  readonly level: number;
}

interface Filling {
  elapsedSeconds: number;
  readonly lakes: readonly RisingLake[];
  readonly region: CellRegion;
  secondsSinceStep: number;
}

export interface WaterRecomputationSnapshot {
  observedHeightVersion: number;
  settledHeights: SparseValues;
}

type WaterChange = "features" | "levels" | "none" | "settled";

function easeOut(amount: number): number {
  return 1 - (1 - amount) * (1 - amount);
}

function haveSameValues(first: Float32Array | Uint8Array, second: Float32Array | Uint8Array): boolean {
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) {
      return false;
    }
  }

  return true;
}

function isNewWater(cells: readonly number[], level: number, previousLevels: Float32Array): boolean {
  return cells.some((cell) => {
    return previousLevels[cell] === NO_WATER || previousLevels[cell] < level - NOTICEABLE_RISE;
  });
}

export class WaterRecomputation {
  readonly #world: WorldState;
  #filling: Filling | null = null;
  #observedHeightVersion: number;
  #quietSeconds: number | null = null;
  #settledHeights: Float32Array;

  constructor(world: WorldState) {
    this.#world = world;
    this.#observedHeightVersion = world.heightVersion;
    this.#settledHeights = this.#uncarvedHeights();
  }

  get isPending(): boolean {
    return this.#quietSeconds !== null || this.#filling !== null;
  }

  snapshot(): WaterRecomputationSnapshot {
    if (this.isPending) {
      throw new Error("The water is still settling");
    }

    return {
      observedHeightVersion: this.#observedHeightVersion,
      settledHeights: sparseDifference(this.#settledHeights, this.#uncarvedHeights()),
    };
  }

  restore(snapshot: WaterRecomputationSnapshot): void {
    const settledHeights = this.#uncarvedHeights();

    applySparse(settledHeights, snapshot.settledHeights);
    this.#settledHeights = settledHeights;
    this.#observedHeightVersion = snapshot.observedHeightVersion;
    this.#quietSeconds = null;
    this.#filling = null;
  }

  update(realSeconds: number): WaterChange {
    if (this.#world.heightVersion !== this.#observedHeightVersion) {
      return this.#noticeHeightEdit();
    }

    if (this.#quietSeconds === null) {
      return this.#fill(realSeconds);
    }

    this.#quietSeconds += realSeconds;

    if (this.#quietSeconds < QUIET_SECONDS_BEFORE_RECOMPUTE) {
      return "none";
    }

    return this.recompute();
  }

  recompute(): WaterChange {
    const { grid, terrain } = this.#world;

    const uncarvedHeights = this.#uncarvedHeights();
    const previousLevels = this.#levelsStillHeld(uncarvedHeights);

    const carvedHeights = uncarvedHeights.slice();

    const hydrology = computeHydrology(
      carvedHeights,
      grid,
      terrain.dryness,
      terrain.coastDistance,
      RESHAPED_LAND_HYDROLOGY
    );

    const changedRegion = this.#applyCarving(hydrology.carving, carvedHeights);
    const isSameRaster =
      changedRegion === null &&
      haveSameValues(terrain.waterSurface, hydrology.waterSurface) &&
      haveSameValues(terrain.riverStrength, hydrology.riverStrength);

    terrain.waterSurface.set(hydrology.waterSurface);
    terrain.riverStrength.set(hydrology.riverStrength);
    this.#filling = this.#startFilling(hydrology.lakeIds, hydrology.features.lakes, previousLevels);
    this.#settleWater();

    const crossings = refreshCrossings(
      {
        grid,
        isBlocked: (cell) => {
          return this.#world.isObstructed(cell);
        },
        lakeIds: hydrology.lakeIds,
        terrain,
        water: hydrology.features,
      },
      this.#world.crossings
    );

    const hasNewWater =
      !isSameRaster ||
      this.#filling !== null ||
      this.#world.hasFreeSpringGround() ||
      JSON.stringify([hydrology.features, crossings]) !== JSON.stringify([this.#world.water, this.#world.crossings]);

    this.#world.replaceWater(hydrology.features, crossings);

    if (hasNewWater) {
      this.#world.markWaterChanged();
    }

    if (changedRegion !== null) {
      this.#world.finishHeightEdit(changedRegion);
    }

    this.#world.surfaceChanges.markAll();
    this.#settledHeights = uncarvedHeights;
    this.#observedHeightVersion = this.#world.heightVersion;
    this.#quietSeconds = null;

    return hasNewWater ? "features" : "settled";
  }

  #noticeHeightEdit(): WaterChange {
    this.#observedHeightVersion = this.#world.heightVersion;
    this.#quietSeconds = 0;

    if (!this.#world.takeSuddenHeightEdit()) {
      return "none";
    }

    return this.recompute();
  }

  #uncarvedHeights(): Float32Array {
    const { grid, terrain } = this.#world;

    const heights = new Float32Array(grid.cellCount);

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      heights[cell] = terrain.height[cell] + terrain.carving[cell];
    }

    return heights;
  }

  #levelsStillHeld(uncarvedHeights: Float32Array): Float32Array {
    const levels = Float32Array.from(this.#world.terrain.waterSurface);

    for (let cell = 0; cell < levels.length; cell += 1) {
      if (uncarvedHeights[cell] < this.#settledHeights[cell] - SUNKEN_LAND) {
        levels[cell] = NO_WATER;
      }
    }

    return levels;
  }

  #startFilling(lakeIds: Int32Array, lakes: readonly Lake[], previousLevels: Float32Array): Filling | null {
    const cellsOfLakes = lakes.map((): number[] => {
      return [];
    });

    for (let cell = 0; cell < lakeIds.length; cell += 1) {
      const cells = cellsOfLakes[lakeIds[cell]];

      if (cells !== undefined) {
        cells.push(cell);
      }
    }

    const rising: RisingLake[] = [];

    for (const lake of lakes) {
      const cells = cellsOfLakes[lake.id];

      if (isNewWater(cells, lake.level, previousLevels)) {
        rising.push(this.#risingLake(cells, lake.level, previousLevels));
      }
    }

    if (rising.length === 0) {
      return null;
    }

    const filling: Filling = {
      elapsedSeconds: 0,
      lakes: rising,
      region: this.#regionOf(rising),
      secondsSinceStep: 0,
    };

    this.#applyFill(filling, 0);

    return filling;
  }

  #risingLake(cells: readonly number[], level: number, previousLevels: Float32Array): RisingLake {
    const { height } = this.#world.terrain;

    let floor = level;

    for (const cell of cells) {
      floor = Math.min(floor, height[cell]);
    }

    return {
      cells,
      floor,
      keptLevels: Float32Array.from(cells, (cell) => {
        return previousLevels[cell];
      }),
      level,
    };
  }

  #regionOf(lakes: readonly RisingLake[]): CellRegion {
    return regionOfCells(
      this.#world.grid,
      lakes.flatMap((lake) => {
        return lake.cells;
      }),
      0
    );
  }

  #fill(realSeconds: number): WaterChange {
    const filling = this.#filling;

    if (filling === null) {
      return "none";
    }

    filling.elapsedSeconds += realSeconds;
    filling.secondsSinceStep += realSeconds;

    if (filling.elapsedSeconds >= FILL_SECONDS) {
      this.#applyFill(filling, 1);
      this.#filling = null;
      this.#settleWater();
      this.#world.markWaterChanged();

      return "features";
    }

    if (filling.secondsSinceStep < FILL_STEP_SECONDS) {
      return "none";
    }

    filling.secondsSinceStep = 0;
    this.#applyFill(filling, filling.elapsedSeconds / FILL_SECONDS);
    this.#settleRisingLakes(filling);
    this.#world.markWaterLevelsChanged(filling.region);

    return "levels";
  }

  #applyFill(filling: Filling, progress: number): void {
    const { height, waterSurface } = this.#world.terrain;

    for (const lake of filling.lakes) {
      const rising = lake.floor + (lake.level - lake.floor) * easeOut(progress);

      for (const [position, cell] of lake.cells.entries()) {
        const level = Math.min(lake.level, Math.max(lake.keptLevels[position], rising));

        waterSurface[cell] = hasWater(level, height[cell]) ? level : NO_WATER;
      }
    }
  }

  #applyCarving(carving: Float32Array, carvedHeights: Float32Array): CellRegion | null {
    const world = this.#world;
    const { grid, terrain } = world;

    terrain.carving.set(carving);

    let firstColumn = grid.cellsPerSide;
    let firstRow = grid.cellsPerSide;
    let lastColumn = -1;
    let lastRow = -1;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      const previousHeight = terrain.height[cell];

      world.setHeight(cell, carvedHeights[cell]);

      if (terrain.height[cell] === previousHeight) {
        continue;
      }

      const column = grid.columnOf(cell);
      const row = grid.rowOf(cell);

      firstColumn = Math.min(firstColumn, column);
      firstRow = Math.min(firstRow, row);
      lastColumn = Math.max(lastColumn, column);
      lastRow = Math.max(lastRow, row);
    }

    if (lastRow < 0) {
      return null;
    }

    return {
      firstColumn: Math.max(0, firstColumn - PATCH_MARGIN_CELLS),
      firstRow: Math.max(0, firstRow - PATCH_MARGIN_CELLS),
      lastColumn: Math.min(grid.cellsPerSide - 1, lastColumn + PATCH_MARGIN_CELLS),
      lastRow: Math.min(grid.cellsPerSide - 1, lastRow + PATCH_MARGIN_CELLS),
    };
  }

  #settleWater(): void {
    const world = this.#world;

    for (let cell = 0; cell < world.grid.cellCount; cell += 1) {
      if (world.touchesWater(cell)) {
        world.clearPlants(cell, world.isWater(cell));
      }

      if (world.isWater(cell)) {
        this.#calmCell(cell);
      }
    }
  }

  #settleRisingLakes(filling: Filling): void {
    const world = this.#world;
    const { grid } = world;

    for (const lake of filling.lakes) {
      for (const cell of lake.cells) {
        if (!world.isWater(cell)) {
          continue;
        }

        this.#calmCell(cell);
        world.clearPlants(cell, true);

        const cellColumn = grid.columnOf(cell);
        const cellRow = grid.rowOf(cell);

        for (const offset of NEIGHBOR_OFFSETS) {
          const column = cellColumn + offset.column;
          const row = cellRow + offset.row;

          if (grid.contains(column, row)) {
            world.clearPlants(grid.index(column, row), false);
          }
        }
      }
    }
  }

  #calmCell(cell: number): void {
    const { fields } = this.#world;

    fields.fire[cell] = 0;
    fields.heat[cell] = 0;
    fields.snow[cell] = 0;
    fields.wetness[cell] = 1;
    this.#world.markSurfaceCell(cell);
  }
}
