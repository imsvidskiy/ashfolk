import { GROWTH_FACTOR } from "../shared/growth.ts";
import { clamp } from "../shared/math.ts";
import type { InitialWorld, PackedRows, RegionPatch, SimulationFrame, TerrainSnapshot } from "../simulation/frame.ts";
import { GROUND_CHANNELS, GroundChannel } from "../world/agent-buffers.ts";
import { isBrookCell } from "../world/brooks.ts";
import { RegionChangeTracker, RowChangeTracker } from "../world/change-tracking.ts";
import { type Crossing, CrossingIndex } from "../world/crossings.ts";
import type { IslandShapeKind } from "../world/island-shape.ts";
import type { Monument } from "../world/monuments.ts";
import { isWaterAtPoint, sampleHeight, sampleSurface, sampleWaterLevel } from "../world/terrain-sampling.ts";
import {
  createVegetationChannels,
  VEGETATION_CHANNELS,
  type VegetationBuffers,
  type VegetationChannel,
  type VegetationChannels,
  type VegetationPatch,
} from "../world/vegetation-store.ts";
import type { MirroredWater } from "../world/water.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { findLandmarks, type Landmark } from "./landmarks.ts";

const MILLISECONDS_PER_SECOND = 1000;
const LONGEST_EXTRAPOLATION_SECONDS = 0.1;
const CROSSING_LOOKUP_MARGIN = 0.6;

function moveChannel<Channel extends VegetationChannel>(
  channels: VegetationChannels,
  grown: VegetationChannels,
  channel: Channel
): void {
  grown[channel].set(channels[channel]);
  channels[channel] = grown[channel];
}

function applyRows(rows: readonly PackedRows[], target: Uint8Array, changes: RowChangeTracker): void {
  for (const run of rows) {
    const bytesPerRow = run.data.length / run.rowCount;

    target.set(run.data, run.firstRow * bytesPerRow);
    changes.markRows(run.firstRow, run.firstRow + run.rowCount - 1);
  }
}

export class MirroredVegetation implements VegetationChannels {
  bornDay: Float32Array;
  count: number;
  fruit: Float32Array;
  height: Float32Array;
  rotation: Float32Array;
  seed: Float32Array;
  species: Uint8Array;
  state: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  readonly #changedIndices = new Set<number>();

  constructor(buffers: VegetationBuffers) {
    this.count = buffers.count;
    this.bornDay = buffers.bornDay;
    this.fruit = buffers.fruit;
    this.height = buffers.height;
    this.rotation = buffers.rotation;
    this.seed = buffers.seed;
    this.species = buffers.species;
    this.state = buffers.state;
    this.x = buffers.x;
    this.z = buffers.z;
  }

  apply(patch: VegetationPatch): void {
    const highestIndex = patch.indices.reduce((highest, index) => {
      return Math.max(highest, index);
    }, -1);

    this.#ensureCapacity(highestIndex + 1);

    for (const channel of VEGETATION_CHANNELS) {
      const source = patch[channel];
      const target = this[channel];

      for (let position = 0; position < patch.count; position += 1) {
        target[patch.indices[position]] = source[position];
      }
    }

    for (let position = 0; position < patch.count; position += 1) {
      this.#changedIndices.add(patch.indices[position]);
    }

    this.count = Math.max(this.count, highestIndex + 1);
  }

  takeChangedIndices(): number[] {
    const indices = [...this.#changedIndices];

    this.#changedIndices.clear();

    return indices;
  }

  #ensureCapacity(size: number): void {
    if (size <= this.x.length) {
      return;
    }

    const grown = createVegetationChannels(Math.ceil(size * GROWTH_FACTOR));

    for (const channel of VEGETATION_CHANNELS) {
      moveChannel(this, grown, channel);
    }
  }
}

export class WorldMirror {
  readonly ground: Uint8Array;
  readonly groundChanges: RowChangeTracker;
  readonly grid: WorldGrid;
  readonly heightChanges = new RegionChangeTracker();
  readonly monuments: readonly Monument[];
  readonly seed: number;
  readonly shape: IslandShapeKind;
  readonly surface: Uint8Array;
  readonly surfaceChanges: RowChangeTracker;
  readonly terrain: TerrainSnapshot;
  readonly vegetation: MirroredVegetation;
  readonly waterLevelChanges = new RegionChangeTracker();
  crossings: readonly Crossing[];
  frame: SimulationFrame;
  landVersion = 0;
  water: MirroredWater;
  waterVersion = 0;
  #crossingIndex: CrossingIndex;
  #frameReceivedAt: number;
  #heightVersion = 0;
  #landmarks: readonly Landmark[];
  #landmarksVersion = 0;

  constructor(initial: InitialWorld, receivedAt: number) {
    this.grid = new WorldGrid(initial.dimensions);
    this.seed = initial.seed;
    this.shape = initial.shape;
    this.monuments = initial.monuments;
    this.crossings = initial.crossings;
    this.#crossingIndex = new CrossingIndex(this.grid, initial.crossings, CROSSING_LOOKUP_MARGIN);
    this.terrain = initial.terrain;
    this.surface = initial.surface;
    this.ground = initial.ground;
    this.vegetation = new MirroredVegetation(initial.vegetation);
    this.water = initial.water;
    this.frame = initial.frame;
    this.#frameReceivedAt = receivedAt;
    this.surfaceChanges = new RowChangeTracker(this.grid.cellsPerSide);
    this.groundChanges = new RowChangeTracker(this.grid.cellsPerSide);
    this.#landmarks = this.#findLandmarks();
  }

  get landmarks(): readonly Landmark[] {
    const version = this.#heightVersion + this.waterVersion;

    if (version !== this.#landmarksVersion && !this.frame.isBusy) {
      this.#landmarks = this.#findLandmarks();
      this.#landmarksVersion = version;
    }

    return this.#landmarks;
  }

  apply(frame: SimulationFrame, receivedAt: number): void {
    applyRows(frame.surfaceRows, this.surface, this.surfaceChanges);
    applyRows(frame.groundRows, this.ground, this.groundChanges);
    this.#copyGroundIndices(frame.groundRows);
    this.#applyRegion(frame.heightPatch, this.terrain.height, this.heightChanges);
    this.#applyWater(frame);
    this.#applyRegion(frame.waterLevels, this.terrain.waterSurface, this.waterLevelChanges);

    if (frame.vegetation !== null) {
      this.vegetation.apply(frame.vegetation);
    }

    const hasLandChanged =
      frame.groundRows.length > 0 || frame.heightPatch !== null || frame.water !== null || frame.waterLevels !== null;

    if (hasLandChanged) {
      this.landVersion += 1;
    }

    if (frame.heightPatch !== null) {
      this.#heightVersion += 1;
    }

    this.frame = frame;
    this.#frameReceivedAt = receivedAt;
  }

  gameSecondsSinceTick(now: number): number {
    const { frame } = this;

    if (frame.isPaused) {
      return frame.secondsSinceTick;
    }

    const realSeconds = (now - this.#frameReceivedAt) / MILLISECONDS_PER_SECOND;

    return frame.secondsSinceTick + clamp(realSeconds, 0, LONGEST_EXTRAPOLATION_SECONDS) * frame.speed;
  }

  heightAt(x: number, z: number): number {
    return sampleHeight(this.terrain.height, this.grid, x, z);
  }

  surfaceAt(x: number, z: number): number {
    return sampleSurface(this.terrain, this.grid, x, z);
  }

  isWaterAt(x: number, z: number): boolean {
    return isWaterAtPoint(this.terrain, this.grid, x, z);
  }

  isBrookAt(x: number, z: number): boolean {
    const cell = this.grid.cellAt(x, z);

    return cell >= 0 && isBrookCell(this.terrain, cell);
  }

  waterLevelAt(x: number, z: number): number {
    return sampleWaterLevel(this.terrain, this.grid, x, z);
  }

  crossingAt(x: number, z: number): Crossing | null {
    return this.#crossingIndex.crossingAt(x, z);
  }

  #findLandmarks(): Landmark[] {
    return findLandmarks({
      grid: this.grid,
      heights: this.terrain.height,
      lakes: this.water.lakes,
      monuments: this.monuments,
      seed: this.seed,
      springs: this.water.springs,
    });
  }

  #copyGroundIndices(rows: readonly PackedRows[]): void {
    const { cellsPerSide } = this.grid;

    for (const run of rows) {
      const firstCell = run.firstRow * cellsPerSide;

      for (let offset = 0; offset < run.rowCount * cellsPerSide; offset += 1) {
        this.terrain.ground[firstCell + offset] = run.data[offset * GROUND_CHANNELS + GroundChannel.Ground];
      }
    }
  }

  #applyRegion(patch: RegionPatch | null, target: Float32Array, changes: RegionChangeTracker): void {
    if (patch === null) {
      return;
    }

    const { region, values } = patch;

    const width = region.lastColumn - region.firstColumn + 1;

    for (let row = region.firstRow; row <= region.lastRow; row += 1) {
      const start = (row - region.firstRow) * width;

      target.set(values.subarray(start, start + width), this.grid.index(region.firstColumn, row));
    }

    changes.markRegion(region);
  }

  #applyWater(frame: SimulationFrame): void {
    const update = frame.water;

    if (update === null) {
      return;
    }

    this.terrain.waterSurface.set(update.waterSurface);
    this.terrain.riverStrength.set(update.riverStrength);
    this.water = update.features;
    this.crossings = update.crossings;
    this.#crossingIndex = new CrossingIndex(this.grid, update.crossings, CROSSING_LOOKUP_MARGIN);
    this.waterVersion += 1;
  }
}
