import { groundDefinition, isPoolGround } from "../../content/grounds.ts";
import { altitudeChill } from "../../generation/climate.ts";
import { generationFingerprint } from "../../generation/generation-fingerprint.ts";
import type { GeneratedWorld } from "../../generation/world-generator.ts";
import { clamp } from "../../shared/math.ts";
import { applySparse, type SparseValues, sparseDifference } from "../../shared/sparse-values.ts";
import { isBrookCell } from "../../world/brooks.ts";
import { type CellRegion, RegionChangeTracker, RowChangeTracker } from "../../world/change-tracking.ts";
import { hasRoomFromCoast, isOnIsland } from "../../world/coast.ts";
import { type Crossing, CrossingIndex, crossingCells, LOG_ROOT_BEHIND } from "../../world/crossings.ts";
import type { Deposit } from "../../world/deposits.ts";
import { canGrowWild, canStandOn, isOpenGround, isWalkableGround, slopeAt } from "../../world/footing.ts";
import type { IslandShapeKind } from "../../world/island-shape.ts";
import { type Monument, type MonumentCondition, MonumentDamage } from "../../world/monuments.ts";
import type { TerrainData } from "../../world/terrain-data.ts";
import {
  isWaterAtPoint,
  isWaterCell,
  sampleHeight,
  sampleSurface,
  touchesWaterCell,
} from "../../world/terrain-sampling.ts";
import {
  NO_PLANT,
  type PlantPlacement,
  type VegetationSnapshot,
  type VegetationStore,
} from "../../world/vegetation-store.ts";
import { NO_WATER, type Spring, type WaterFeatures } from "../../world/water.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { CellSet } from "./cell-set.ts";
import { ObstacleMap } from "./obstacles.ts";

export const NO_BUILDING = -1;
export const MONUMENT_GROUND = -2;
export const SPRING_GROUND = -3;
export const PLOT_GROUND = -4;
export const CROSSING_GROUND = -5;
export const SNOW_CAPACITY = 1.2;

const TRODDEN_GROUND = 0.35;
const MAXIMUM_TERRAIN_HEIGHT = 3200;
const CROSSING_TOLERANCE = 0.01;
const LOWEST_EDIT_BELOW_ORIGINAL = 60;
const TRODDEN_LEVELS = 32;

const SPARSE_FIELDS = ["crop", "fire", "heat", "scorch", "trodden"] as const;
const DENSE_FIELDS = ["snow", "wetness"] as const;
const SAVED_TERRAIN_LAYERS = [
  "baseTemperature",
  "carving",
  "ground",
  "height",
  "riverStrength",
  "waterSurface",
] as const;

export interface SurfaceFields {
  crop: Float32Array;
  fire: Float32Array;
  fuel: Float32Array;
  heat: Float32Array;
  scorch: Float32Array;
  snow: Float32Array;
  trodden: Float32Array;
  wetness: Float32Array;
}

type SparseField = (typeof SPARSE_FIELDS)[number];

type DenseField = (typeof DENSE_FIELDS)[number];

type SavedFields = Record<DenseField, Float32Array> & Record<SparseField | "fuel", SparseValues>;

type SavedTerrainLayer = (typeof SAVED_TERRAIN_LAYERS)[number];

type GeneratedTerrain = Pick<TerrainData, SavedTerrainLayer>;

export interface WorldSnapshot {
  canopyFuel: SparseValues;
  cropCodes: SparseValues;
  crossings: readonly Crossing[];
  disturbedDay: SparseValues;
  fields: SavedFields;
  heightVersion: number;
  initialCanopyFuel: SparseValues;
  monumentConditions: MonumentCondition[];
  occupancy: SparseValues;
  recovering: Int32Array;
  terrain: Record<SavedTerrainLayer, SparseValues>;
  vegetation: VegetationSnapshot;
  water: WaterFeatures;
  waterVersion: number;
}

function copyTerrain(terrain: TerrainData): GeneratedTerrain {
  return {
    baseTemperature: terrain.baseTemperature.slice(),
    carving: terrain.carving.slice(),
    ground: terrain.ground.slice(),
    height: terrain.height.slice(),
    riverStrength: terrain.riverStrength.slice(),
    waterSurface: terrain.waterSurface.slice(),
  };
}

function groundFuel(ground: Uint8Array): Float32Array {
  return Float32Array.from(ground, (kind) => {
    return groundDefinition(kind).fuel;
  });
}

function restoreDense(target: Float32Array, saved: Float32Array): void {
  if (saved.length !== target.length) {
    throw new RangeError("The saved world does not fit this island");
  }

  target.set(saved);
}

function lowestValue(values: Float32Array): number {
  let lowest = Number.POSITIVE_INFINITY;

  for (const value of values) {
    lowest = Math.min(lowest, value);
  }

  return lowest;
}

function createSurfaceFields(cellCount: number, ground: Uint8Array): SurfaceFields {
  return {
    crop: new Float32Array(cellCount),
    fire: new Float32Array(cellCount),
    fuel: groundFuel(ground),
    heat: new Float32Array(cellCount),
    scorch: new Float32Array(cellCount),
    snow: new Float32Array(cellCount),
    trodden: new Float32Array(cellCount),
    wetness: new Float32Array(cellCount),
  };
}

export class WorldState {
  readonly canopyFuel: Float32Array;
  readonly cropCodes: Uint8Array;
  readonly disturbedDay: Float32Array;
  readonly deposits: readonly Deposit[];
  readonly fields: SurfaceFields;
  readonly footingChanges = new RegionChangeTracker();
  readonly generationFingerprint: number;
  readonly grid: WorldGrid;
  readonly groundChanges: RowChangeTracker;
  readonly heightChanges = new RegionChangeTracker();
  readonly initialCanopyFuel: Float32Array;
  readonly monumentConditions: readonly MonumentCondition[];
  readonly monuments: readonly Monument[];
  readonly obstacles: ObstacleMap;
  readonly occupancy: Int32Array;
  readonly recovering: CellSet;
  readonly seed: number;
  readonly shape: IslandShapeKind;
  readonly surfaceChanges: RowChangeTracker;
  readonly surfaceEdits: RowChangeTracker;
  readonly terrain: TerrainData;
  readonly vegetation: VegetationStore;
  readonly waterLevelChanges = new RegionChangeTracker();
  crossings: readonly Crossing[];
  heightVersion = 0;
  water: WaterFeatures;
  waterVersion = 0;
  readonly #generatedTerrain: GeneratedTerrain;
  readonly #lowestHeight: number;
  #crossingIndex: CrossingIndex;
  #hasSuddenHeightEdit = false;

  constructor(generated: GeneratedWorld) {
    this.generationFingerprint = generationFingerprint(generated);
    this.grid = new WorldGrid(generated.dimensions);
    this.seed = generated.seed;
    this.shape = generated.shape;
    this.terrain = generated.terrain;
    this.#generatedTerrain = copyTerrain(generated.terrain);
    this.vegetation = generated.vegetation;
    this.water = generated.water;
    this.monuments = generated.monuments;
    this.monumentConditions = generated.monuments.map(() => {
      return { damage: MonumentDamage.Standing, isDrowned: false };
    });
    this.deposits = generated.deposits;
    this.crossings = generated.crossings;
    this.#crossingIndex = new CrossingIndex(this.grid, this.crossings, CROSSING_TOLERANCE);
    this.fields = createSurfaceFields(this.grid.cellCount, generated.terrain.ground);
    this.cropCodes = new Uint8Array(this.grid.cellCount);
    this.occupancy = new Int32Array(this.grid.cellCount).fill(NO_BUILDING);
    this.obstacles = new ObstacleMap(this.grid, this.vegetation);
    this.canopyFuel = new Float32Array(this.grid.cellCount);
    this.initialCanopyFuel = new Float32Array(this.grid.cellCount);
    this.disturbedDay = new Float32Array(this.grid.cellCount);
    this.recovering = new CellSet(this.grid.cellCount);
    this.surfaceChanges = new RowChangeTracker(this.grid.cellsPerSide);
    this.surfaceEdits = new RowChangeTracker(this.grid.cellsPerSide);
    this.groundChanges = new RowChangeTracker(this.grid.cellsPerSide);
    this.#lowestHeight = lowestValue(generated.terrain.height);

    for (let cell = 0; cell < this.grid.cellCount; cell += 1) {
      this.refreshCanopy(cell);
    }

    for (const monument of this.monuments) {
      for (const cell of monument.cells) {
        this.occupancy[cell] = MONUMENT_GROUND;
      }
    }

    this.#reserveSprings(this.water.springs);
    this.#markCrossingGround();
  }

  snapshot(): WorldSnapshot {
    const { cellCount } = this.grid;

    const empty = new Float32Array(cellCount);
    const generated = this.#generatedTerrain;

    return {
      canopyFuel: sparseDifference(this.canopyFuel, this.#vegetationCanopy()),
      cropCodes: sparseDifference(this.cropCodes, new Uint8Array(cellCount)),
      crossings: structuredClone(this.crossings),
      disturbedDay: sparseDifference(this.disturbedDay, empty),
      fields: {
        crop: sparseDifference(this.fields.crop, empty),
        fire: sparseDifference(this.fields.fire, empty),
        fuel: sparseDifference(this.fields.fuel, groundFuel(this.terrain.ground)),
        heat: sparseDifference(this.fields.heat, empty),
        scorch: sparseDifference(this.fields.scorch, empty),
        snow: this.fields.snow.slice(),
        trodden: sparseDifference(this.fields.trodden, empty),
        wetness: this.fields.wetness.slice(),
      },
      heightVersion: this.heightVersion,
      initialCanopyFuel: sparseDifference(this.initialCanopyFuel, this.canopyFuel),
      monumentConditions: this.monumentConditions.map((condition) => {
        return { ...condition };
      }),
      occupancy: sparseDifference(this.occupancy, new Int32Array(cellCount).fill(NO_BUILDING)),
      recovering: this.recovering.snapshot(),
      terrain: {
        baseTemperature: sparseDifference(this.terrain.baseTemperature, generated.baseTemperature),
        carving: sparseDifference(this.terrain.carving, generated.carving),
        ground: sparseDifference(this.terrain.ground, generated.ground),
        height: sparseDifference(this.terrain.height, generated.height),
        riverStrength: sparseDifference(this.terrain.riverStrength, generated.riverStrength),
        waterSurface: sparseDifference(this.terrain.waterSurface, generated.waterSurface),
      },
      vegetation: this.vegetation.snapshot(),
      water: structuredClone(this.water),
      waterVersion: this.waterVersion,
    };
  }

  restore(snapshot: WorldSnapshot): void {
    for (const layer of SAVED_TERRAIN_LAYERS) {
      applySparse(this.terrain[layer], snapshot.terrain[layer]);
    }

    this.vegetation.restore(snapshot.vegetation);
    this.fields.fuel.set(groundFuel(this.terrain.ground));
    applySparse(this.fields.fuel, snapshot.fields.fuel);

    for (const field of SPARSE_FIELDS) {
      this.fields[field].fill(0);
      applySparse(this.fields[field], snapshot.fields[field]);
    }

    for (const field of DENSE_FIELDS) {
      restoreDense(this.fields[field], snapshot.fields[field]);
    }

    this.canopyFuel.set(this.#vegetationCanopy());
    applySparse(this.canopyFuel, snapshot.canopyFuel);
    this.initialCanopyFuel.set(this.canopyFuel);
    applySparse(this.initialCanopyFuel, snapshot.initialCanopyFuel);
    this.disturbedDay.fill(0);
    applySparse(this.disturbedDay, snapshot.disturbedDay);
    this.cropCodes.fill(0);
    applySparse(this.cropCodes, snapshot.cropCodes);
    this.occupancy.fill(NO_BUILDING);
    applySparse(this.occupancy, snapshot.occupancy);
    this.recovering.restore(snapshot.recovering);

    for (const [position, condition] of this.monumentConditions.entries()) {
      Object.assign(condition, snapshot.monumentConditions[position]);
    }

    this.water = snapshot.water;
    this.crossings = snapshot.crossings;
    this.#crossingIndex = new CrossingIndex(this.grid, this.crossings, CROSSING_TOLERANCE);
    this.heightVersion = snapshot.heightVersion;
    this.waterVersion = snapshot.waterVersion;
    this.#hasSuddenHeightEdit = false;
  }

  heightAt(x: number, z: number): number {
    return sampleHeight(this.terrain.height, this.grid, x, z);
  }

  surfaceAt(x: number, z: number): number {
    return sampleSurface(this.terrain, this.grid, x, z);
  }

  isOnIsland(cell: number): boolean {
    return isOnIsland(this.terrain.coastDistance, cell);
  }

  isWater(cell: number): boolean {
    return isWaterCell(this.terrain, cell);
  }

  touchesWater(cell: number): boolean {
    return touchesWaterCell(this.terrain, this.grid, cell);
  }

  isWaterAt(x: number, z: number): boolean {
    return isWaterAtPoint(this.terrain, this.grid, x, z);
  }

  waterDepth(cell: number): number {
    const waterSurface = this.terrain.waterSurface[cell];

    if (waterSurface === NO_WATER) {
      return 0;
    }

    return Math.max(0, waterSurface - this.terrain.height[cell]);
  }

  slope(cell: number): number {
    return slopeAt(this.terrain.height, this.grid, cell);
  }

  isOpenGround(cell: number): boolean {
    return isOpenGround(this.terrain, this.grid, cell);
  }

  canPlace(cell: number, steepestSlope: number): boolean {
    return canStandOn(this.terrain, this.grid, cell, steepestSlope) && this.occupancy[cell] === NO_BUILDING;
  }

  canGrowWild(cell: number, species: number): boolean {
    if (this.occupancy[cell] !== NO_BUILDING || this.isTrodden(cell)) {
      return false;
    }

    return canGrowWild(this.terrain, this.grid, cell, species);
  }

  isTrodden(cell: number): boolean {
    return this.fields.trodden[cell] > TRODDEN_GROUND;
  }

  temperature(cell: number, airTemperatureOffset: number): number {
    return this.terrain.baseTemperature[cell] + airTemperatureOffset;
  }

  isWalkable(cell: number): boolean {
    return isWalkableGround(this.terrain, this.grid, cell) && !this.isObstructed(cell);
  }

  isPool(cell: number): boolean {
    return isPoolGround(this.terrain.ground[cell]);
  }

  isBrook(cell: number): boolean {
    return isBrookCell(this.terrain, cell);
  }

  isObstructed(cell: number): boolean {
    if (cell < 0) {
      return false;
    }

    return this.occupancy[cell] === MONUMENT_GROUND || this.occupancy[cell] === SPRING_GROUND;
  }

  isObstructedBetween(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const from = this.grid.cellAt(fromX, fromZ);

    if (this.isObstructed(from) || from === this.grid.cellAt(toX, toZ)) {
      return false;
    }

    return this.grid.someCellAlong(fromX, fromZ, toX, toZ, (cell) => {
      return this.isObstructed(cell);
    });
  }

  isWalkableAt(x: number, z: number): boolean {
    return this.isWalkable(this.grid.cellAt(x, z));
  }

  crossingAt(x: number, z: number): Crossing | null {
    return this.#crossingIndex.crossingAt(x, z);
  }

  depositById(id: number): Deposit | null {
    if (id < 0 || id >= this.deposits.length) {
      return null;
    }

    return this.deposits[id];
  }

  isBurning(cell: number): boolean {
    return this.fields.fire[cell] > 0;
  }

  markDisturbed(cell: number, day: number): void {
    if (cell < 0) {
      return;
    }

    this.disturbedDay[cell] = day;
    this.recovering.add(cell);
  }

  markSurfaceCell(cell: number): void {
    this.surfaceChanges.markRow(this.grid.rowOf(cell));
    this.surfaceEdits.markRow(this.grid.rowOf(cell));
  }

  setGround(cell: number, ground: number): void {
    if (this.terrain.ground[cell] === ground) {
      return;
    }

    this.terrain.ground[cell] = ground;
    this.fields.fuel[cell] = groundDefinition(ground).fuel;
    this.groundChanges.markRow(this.grid.rowOf(cell));
    this.surfaceEdits.markRow(this.grid.rowOf(cell));
  }

  setCrop(cell: number, growth: number): void {
    if (Math.abs(this.fields.crop[cell] - growth) < 0.02) {
      return;
    }

    this.fields.crop[cell] = growth;
    this.groundChanges.markRow(this.grid.rowOf(cell));
  }

  setCropCode(cell: number, code: number): void {
    if (this.cropCodes[cell] === code) {
      return;
    }

    this.cropCodes[cell] = code;
    this.groundChanges.markRow(this.grid.rowOf(cell));
  }

  setTrodden(cell: number, trodden: number): void {
    const previous = this.fields.trodden[cell];

    this.fields.trodden[cell] = trodden;

    if (Math.round(previous * TRODDEN_LEVELS) !== Math.round(trodden * TRODDEN_LEVELS)) {
      this.groundChanges.markRow(this.grid.rowOf(cell));
    }
  }

  setHeight(cell: number, height: number): void {
    const previous = this.terrain.height[cell];
    const next = clamp(height, this.#lowestHeight - LOWEST_EDIT_BELOW_ORIGINAL, MAXIMUM_TERRAIN_HEIGHT);

    this.terrain.height[cell] = next;
    this.terrain.baseTemperature[cell] += altitudeChill(previous) - altitudeChill(next);
  }

  finishHeightEdit(region: CellRegion): void {
    this.heightChanges.markRegion(region);
    this.footingChanges.markRegion(region);
    this.heightVersion += 1;
  }

  finishSuddenHeightEdit(region: CellRegion): void {
    this.finishHeightEdit(region);
    this.#hasSuddenHeightEdit = true;
  }

  takeSuddenHeightEdit(): boolean {
    const isSudden = this.#hasSuddenHeightEdit;

    this.#hasSuddenHeightEdit = false;

    return isSudden;
  }

  plant(placement: PlantPlacement): number {
    if (!hasRoomFromCoast(this.terrain.coastDistance, this.grid, placement.x, placement.z)) {
      return NO_PLANT;
    }

    const index = this.vegetation.add(placement);

    if (index >= 0) {
      this.refreshCanopy(this.vegetation.cell[index]);
    }

    return index;
  }

  removePlant(index: number): void {
    const cell = this.vegetation.cell[index];

    this.vegetation.remove(index);

    if (cell >= 0) {
      this.refreshCanopy(cell);
    }
  }

  liftPlant(index: number): void {
    const cell = this.vegetation.cell[index];

    this.vegetation.detach(index);

    if (cell >= 0) {
      this.refreshCanopy(cell);
    }
  }

  setPlantDown(index: number, x: number, z: number): void {
    this.vegetation.attach(index, x, z);

    const cell = this.vegetation.cell[index];

    if (cell >= 0) {
      this.refreshCanopy(cell);
    }
  }

  fellPlant(index: number, day: number, rotation: number): void {
    const cell = this.vegetation.cell[index];

    this.vegetation.fell(index, day, rotation);

    if (cell >= 0) {
      this.refreshCanopy(cell);
    }
  }

  clearPlants(cell: number, includesStones: boolean): void {
    if (!this.vegetation.hasPlantsInCell(cell)) {
      return;
    }

    this.vegetation.clearCell(cell, includesStones);
    this.refreshCanopy(cell);
  }

  refreshCanopy(cell: number): void {
    const fuel = this.vegetation.canopyFuelInCell(cell);

    this.canopyFuel[cell] = fuel;

    if (this.isBurning(cell)) {
      this.initialCanopyFuel[cell] = Math.max(this.initialCanopyFuel[cell], fuel);

      return;
    }

    this.initialCanopyFuel[cell] = fuel;
  }

  replaceWater(water: WaterFeatures, crossings: readonly Crossing[]): void {
    for (const spring of this.water.springs) {
      for (const cell of spring.cells) {
        if (this.occupancy[cell] === SPRING_GROUND) {
          this.occupancy[cell] = NO_BUILDING;
        }
      }
    }

    for (let cell = 0; cell < this.occupancy.length; cell += 1) {
      if (this.occupancy[cell] === CROSSING_GROUND) {
        this.occupancy[cell] = NO_BUILDING;
      }
    }

    this.water = water;
    this.crossings = crossings;
    this.#crossingIndex = new CrossingIndex(this.grid, crossings, CROSSING_TOLERANCE);
    this.#reserveSprings(water.springs);
    this.#markCrossingGround();

    for (const spring of water.springs) {
      for (const cell of spring.cells) {
        this.clearPlants(cell, true);
      }
    }
  }

  hasFreeSpringGround(): boolean {
    return this.water.springs.some((spring) => {
      return spring.cells.some((cell) => {
        return this.occupancy[cell] === NO_BUILDING || this.occupancy[cell] === CROSSING_GROUND;
      });
    });
  }

  markWaterChanged(): void {
    this.waterVersion += 1;
  }

  markWaterLevelsChanged(region: CellRegion): void {
    this.waterLevelChanges.markRegion(region);
    this.markWaterChanged();
  }

  #vegetationCanopy(): Float32Array {
    const canopy = new Float32Array(this.grid.cellCount);

    for (let cell = 0; cell < canopy.length; cell += 1) {
      canopy[cell] = this.vegetation.canopyFuelInCell(cell);
    }

    return canopy;
  }

  #reserveSprings(springs: readonly Spring[]): void {
    for (const spring of springs) {
      for (const cell of spring.cells) {
        if (this.occupancy[cell] === NO_BUILDING) {
          this.occupancy[cell] = SPRING_GROUND;
        }
      }
    }
  }

  #markCrossingGround(): void {
    for (const crossing of this.crossings) {
      for (const cell of crossingCells(this.grid, crossing, LOG_ROOT_BEHIND)) {
        if (this.occupancy[cell] === NO_BUILDING && !this.isWater(cell)) {
          this.occupancy[cell] = CROSSING_GROUND;
        }
      }
    }
  }
}
