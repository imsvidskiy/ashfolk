import { isTreeSpecies, plantSpeciesDefinition } from "../content/plants.ts";
import { saturate } from "../shared/math.ts";
import type { WorldGrid } from "./world-grid.ts";

export const PlantState = {
  Alive: 0,
  Burnt: 1,
  Fallen: 3,
  Removed: 2,
} as const;

export const VEGETATION_CHANNELS = [
  "bornDay",
  "fruit",
  "height",
  "rotation",
  "seed",
  "species",
  "state",
  "x",
  "z",
] as const;

export const NO_PLANT = -1;

const FRUIT_LEVELS = 4;
const BURNT_QUEUE_COMPACTION = 1024;
const INITIAL_BERRY_BUSH_CAPACITY = 1024;

export interface PlantPlacement {
  bornDay: number;
  height: number;
  rotation: number;
  seed: number;
  species: number;
  x: number;
  z: number;
}

export type VegetationChannel = (typeof VEGETATION_CHANNELS)[number];

type ByteChannel = Extract<VegetationChannel, "species" | "state">;

export type VegetationChannels = Record<Exclude<VegetationChannel, ByteChannel>, Float32Array> &
  Record<ByteChannel, Uint8Array>;

export interface VegetationBuffers extends VegetationChannels {
  count: number;
}

export interface VegetationPatch extends VegetationBuffers {
  indices: Int32Array;
}

export interface VegetationSnapshot extends VegetationBuffers {
  aliveCount: number;
  burntDay: Float32Array;
  burntQueueDays: Float64Array;
  burntQueuePlants: Int32Array;
  cell: Int32Array;
  freeSlots: Int32Array;
  nextInCell: Int32Array;
  wear: Uint8Array;
}

interface BurntPlant {
  day: number;
  index: number;
}

export function createVegetationChannels(size: number): VegetationChannels {
  return {
    bornDay: new Float32Array(size),
    fruit: new Float32Array(size),
    height: new Float32Array(size),
    rotation: new Float32Array(size),
    seed: new Float32Array(size),
    species: new Uint8Array(size),
    state: new Uint8Array(size),
    x: new Float32Array(size),
    z: new Float32Array(size),
  };
}

export class VegetationStore implements VegetationChannels {
  readonly #burntDay: Float32Array;
  readonly #burntQueue: BurntPlant[] = [];
  readonly #capacity: number;
  readonly #changed = new Set<number>();
  readonly #firstInCell: Int32Array;
  readonly #freeSlots: number[] = [];
  readonly #grid: WorldGrid;
  readonly #nextInCell: Int32Array;
  readonly bornDay: Float32Array;
  readonly cell: Int32Array;
  readonly fruit: Float32Array;
  readonly height: Float32Array;
  readonly rotation: Float32Array;
  readonly seed: Float32Array;
  readonly species: Uint8Array;
  readonly state: Uint8Array;
  readonly wear: Uint8Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  #aliveCount = 0;
  #berryBushCount = 0;
  #berryBushes = new Int32Array(INITIAL_BERRY_BUSH_CAPACITY);
  #burntQueueStart = 0;
  #count = 0;
  #emptyBerryBushCount = 0;
  #fullBerryBushCount = 0;

  constructor(grid: WorldGrid, capacity: number) {
    this.#grid = grid;
    this.#capacity = capacity;
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.rotation = new Float32Array(capacity);
    this.height = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.bornDay = new Float32Array(capacity);
    this.#burntDay = new Float32Array(capacity);
    this.fruit = new Float32Array(capacity);
    this.species = new Uint8Array(capacity);
    this.state = new Uint8Array(capacity).fill(PlantState.Removed);
    this.wear = new Uint8Array(capacity);
    this.cell = new Int32Array(capacity).fill(NO_PLANT);
    this.#nextInCell = new Int32Array(capacity).fill(NO_PLANT);
    this.#firstInCell = new Int32Array(grid.cellCount).fill(NO_PLANT);
  }

  get count(): number {
    return this.#count;
  }

  get aliveCount(): number {
    return this.#aliveCount;
  }

  add(placement: PlantPlacement): number {
    const index = this.#allocate();

    if (index === NO_PLANT) {
      return NO_PLANT;
    }

    this.x[index] = placement.x;
    this.z[index] = placement.z;
    this.rotation[index] = placement.rotation;
    this.height[index] = placement.height;
    this.seed[index] = placement.seed;
    this.bornDay[index] = placement.bornDay;
    this.species[index] = placement.species;
    this.state[index] = PlantState.Alive;
    this.wear[index] = 0;
    this.fruit[index] = this.#givesBerries(index) ? 1 : 0;
    this.#linkToCell(index, this.#grid.cellAt(placement.x, placement.z));
    this.#aliveCount += 1;
    this.#changed.add(index);
    this.#trackBerryBush(index);

    return index;
  }

  remove(index: number): void {
    if (this.state[index] === PlantState.Removed) {
      return;
    }

    if (this.state[index] === PlantState.Alive) {
      this.#aliveCount -= 1;
      this.#untrackBerryBush(index);
    }

    this.#unlinkFromCell(index);
    this.state[index] = PlantState.Removed;
    this.height[index] = 0;
    this.fruit[index] = 0;
    this.#freeSlots.push(index);
    this.#changed.add(index);
  }

  detach(index: number): void {
    this.#unlinkFromCell(index);
  }

  attach(index: number, x: number, z: number): void {
    this.#unlinkFromCell(index);
    this.x[index] = x;
    this.z[index] = z;
    this.#linkToCell(index, this.#grid.cellAt(x, z));
    this.#changed.add(index);
  }

  burn(index: number, day: number): void {
    this.#kill(index, day, PlantState.Burnt);
  }

  fell(index: number, day: number, rotation: number): void {
    if (this.state[index] !== PlantState.Alive) {
      return;
    }

    this.rotation[index] = rotation;
    this.#kill(index, day, PlantState.Fallen);
  }

  setHeight(index: number, height: number): void {
    if (this.state[index] !== PlantState.Alive || this.height[index] === height) {
      return;
    }

    this.height[index] = height;
    this.#changed.add(index);
  }

  reshape(index: number, seed: number, rotation: number): void {
    if (this.state[index] !== PlantState.Alive) {
      return;
    }

    this.seed[index] = seed;
    this.rotation[index] = rotation;
    this.#changed.add(index);
  }

  setFruit(index: number, fruit: number): void {
    if (this.state[index] !== PlantState.Alive) {
      return;
    }

    const isVisibleChange = Math.round(this.fruit[index] * FRUIT_LEVELS) !== Math.round(fruit * FRUIT_LEVELS);
    const isBerryBush = this.#givesBerries(index);

    if (isBerryBush) {
      this.#countFruit(index, -1);
    }

    this.fruit[index] = fruit;

    if (isBerryBush) {
      this.#countFruit(index, 1);
    }

    if (isVisibleChange) {
      this.#changed.add(index);
    }
  }

  changeBerryFruit(change: number): void {
    if (!this.#canBerriesChange(change)) {
      return;
    }

    for (let position = 0; position < this.#berryBushCount; position += 1) {
      const bush = this.#berryBushes[position];

      this.setFruit(bush, saturate(this.fruit[bush] + change));
    }
  }

  takeBurntBefore(day: number): number[] {
    const expired: number[] = [];

    while (this.#burntQueueStart < this.#burntQueue.length) {
      const oldest = this.#burntQueue[this.#burntQueueStart];

      if (oldest.day >= day) {
        break;
      }

      this.#burntQueueStart += 1;

      if (this.#isDead(oldest.index) && this.#burntDay[oldest.index] === oldest.day) {
        expired.push(oldest.index);
      }
    }

    this.#compactBurntQueue();

    return expired;
  }

  wearDown(index: number): number {
    if (this.state[index] !== PlantState.Alive) {
      return 0;
    }

    this.wear[index] += 1;

    return this.wear[index];
  }

  isAlive(index: number): boolean {
    return this.state[index] === PlantState.Alive;
  }

  firstPlantInCell(cell: number): number {
    return this.#firstInCell[cell];
  }

  nextPlantInCell(index: number): number {
    return this.#nextInCell[index];
  }

  plantsInCell(cell: number): number[] {
    const plants: number[] = [];

    for (let index = this.#firstInCell[cell]; index !== NO_PLANT; index = this.#nextInCell[index]) {
      plants.push(index);
    }

    return plants;
  }

  hasPlantsInCell(cell: number): boolean {
    return this.#firstInCell[cell] !== NO_PLANT;
  }

  canopyFuelInCell(cell: number): number {
    let fuel = 0;

    for (let index = this.#firstInCell[cell]; index !== NO_PLANT; index = this.#nextInCell[index]) {
      if (this.state[index] === PlantState.Alive) {
        fuel += plantSpeciesDefinition(this.species[index]).canopyFuel;
      }
    }

    return fuel;
  }

  burnTreesInCell(cell: number, day: number): number {
    let burnt = 0;

    for (let index = this.#firstInCell[cell]; index !== NO_PLANT; index = this.#nextInCell[index]) {
      if (this.state[index] === PlantState.Alive && plantSpeciesDefinition(this.species[index]).canopyFuel > 0) {
        this.burn(index, day);
        burnt += 1;
      }
    }

    return burnt;
  }

  clearCell(cell: number, includesStones: boolean): void {
    for (const index of this.plantsInCell(cell)) {
      const { form } = plantSpeciesDefinition(this.species[index]);

      if (form !== "monument" && (includesStones || form !== "stone")) {
        this.remove(index);
      }
    }
  }

  hasTreeWithin(x: number, z: number, reach: number): boolean {
    const grid = this.#grid;
    const column = grid.columnAt(x);
    const row = grid.rowAt(z);
    const span = Math.ceil(reach / grid.cellSize);
    const storedX = Math.fround(x);
    const storedZ = Math.fround(z);

    for (let nearRow = row - span; nearRow <= row + span; nearRow += 1) {
      for (let nearColumn = column - span; nearColumn <= column + span; nearColumn += 1) {
        if (!grid.contains(nearColumn, nearRow)) {
          continue;
        }

        const cell = grid.index(nearColumn, nearRow);

        for (let index = this.#firstInCell[cell]; index !== NO_PLANT; index = this.#nextInCell[index]) {
          const isTree = this.state[index] === PlantState.Alive && isTreeSpecies(this.species[index]);

          if (isTree && Math.hypot(this.x[index] - storedX, this.z[index] - storedZ) < reach) {
            return true;
          }
        }
      }
    }

    return false;
  }

  countTreesInCell(cell: number): number {
    let trees = 0;

    for (let index = this.#firstInCell[cell]; index !== NO_PLANT; index = this.#nextInCell[index]) {
      if (this.state[index] === PlantState.Alive && isTreeSpecies(this.species[index])) {
        trees += 1;
      }
    }

    return trees;
  }

  takeChanges(): VegetationPatch | null {
    if (this.#changed.size === 0) {
      return null;
    }

    const indices = Int32Array.from(this.#changed);
    const patch: VegetationPatch = { ...createVegetationChannels(indices.length), count: indices.length, indices };

    for (const channel of VEGETATION_CHANNELS) {
      const source = this[channel];
      const target = patch[channel];

      for (const [position, index] of indices.entries()) {
        target[position] = source[index];
      }
    }

    this.#changed.clear();

    return patch;
  }

  discardChanges(): void {
    this.#changed.clear();
  }

  exportBuffers(): VegetationBuffers {
    const count = this.#count;
    const buffers: VegetationBuffers = { ...createVegetationChannels(count), count };

    for (const channel of VEGETATION_CHANNELS) {
      buffers[channel].set(this[channel].subarray(0, count));
    }

    return buffers;
  }

  snapshot(): VegetationSnapshot {
    const count = this.#count;
    const queue = this.#burntQueue.slice(this.#burntQueueStart);

    return {
      ...this.exportBuffers(),
      aliveCount: this.#aliveCount,
      burntDay: this.#burntDay.slice(0, count),
      burntQueueDays: Float64Array.from(queue, (burnt) => {
        return burnt.day;
      }),
      burntQueuePlants: Int32Array.from(queue, (burnt) => {
        return burnt.index;
      }),
      cell: this.cell.slice(0, count),
      freeSlots: Int32Array.from(this.#freeSlots),
      nextInCell: this.#nextInCell.slice(0, count),
      wear: this.wear.slice(0, count),
    };
  }

  restore(snapshot: VegetationSnapshot): void {
    const { count } = snapshot;

    if (count > this.#capacity) {
      throw new RangeError("The saved vegetation does not fit this island");
    }

    for (const channel of VEGETATION_CHANNELS) {
      this[channel].fill(0);
      this[channel].set(snapshot[channel].subarray(0, count));
    }

    this.state.fill(PlantState.Removed, count);
    this.#burntDay.fill(0);
    this.#burntDay.set(snapshot.burntDay);
    this.wear.fill(0);
    this.wear.set(snapshot.wear);
    this.cell.fill(NO_PLANT);
    this.cell.set(snapshot.cell);
    this.#nextInCell.fill(NO_PLANT);
    this.#nextInCell.set(snapshot.nextInCell);
    this.#count = count;
    this.#relinkCells();
    this.#aliveCount = snapshot.aliveCount;
    this.#freeSlots.length = 0;

    for (const slot of snapshot.freeSlots) {
      this.#freeSlots.push(slot);
    }

    this.#burntQueue.length = 0;
    this.#burntQueueStart = 0;

    for (const [position, index] of snapshot.burntQueuePlants.entries()) {
      this.#burntQueue.push({ day: snapshot.burntQueueDays[position], index });
    }

    this.#rebuildBerryBushes();
    this.#changed.clear();
  }

  #kill(index: number, day: number, state: number): void {
    if (this.state[index] !== PlantState.Alive) {
      return;
    }

    this.#untrackBerryBush(index);
    this.state[index] = state;
    this.#burntDay[index] = day;
    this.#burntQueue.push({ day: this.#burntDay[index], index });
    this.fruit[index] = 0;
    this.#aliveCount -= 1;
    this.#changed.add(index);
  }

  #isDead(index: number): boolean {
    return this.state[index] === PlantState.Burnt || this.state[index] === PlantState.Fallen;
  }

  #compactBurntQueue(): void {
    if (this.#burntQueueStart < BURNT_QUEUE_COMPACTION || this.#burntQueueStart * 2 < this.#burntQueue.length) {
      return;
    }

    this.#burntQueue.splice(0, this.#burntQueueStart);
    this.#burntQueueStart = 0;
  }

  #relinkCells(): void {
    const isFollower = new Uint8Array(this.#count);

    for (let index = 0; index < this.#count; index += 1) {
      const next = this.#nextInCell[index];

      if (next >= 0 && next < this.#count) {
        isFollower[next] = 1;
      }
    }

    this.#firstInCell.fill(NO_PLANT);

    for (let index = 0; index < this.#count; index += 1) {
      const cell = this.cell[index];

      if (cell >= 0 && cell < this.#firstInCell.length && isFollower[index] === 0) {
        this.#firstInCell[cell] = index;
      }
    }
  }

  #rebuildBerryBushes(): void {
    this.#berryBushCount = 0;
    this.#fullBerryBushCount = 0;
    this.#emptyBerryBushCount = 0;

    for (let index = 0; index < this.#count; index += 1) {
      if (this.state[index] === PlantState.Alive) {
        this.#trackBerryBush(index);
      }
    }
  }

  #allocate(): number {
    const reused = this.#freeSlots.pop();

    if (reused !== undefined) {
      return reused;
    }

    if (this.#count >= this.#capacity) {
      return NO_PLANT;
    }

    const index = this.#count;

    this.#count += 1;

    return index;
  }

  #canBerriesChange(change: number): boolean {
    if (change > 0) {
      return this.#fullBerryBushCount < this.#berryBushCount;
    }

    if (change < 0) {
      return this.#emptyBerryBushCount < this.#berryBushCount;
    }

    return false;
  }

  #givesBerries(index: number): boolean {
    return plantSpeciesDefinition(this.species[index]).givesBerries;
  }

  #trackBerryBush(index: number): void {
    if (!this.#givesBerries(index)) {
      return;
    }

    if (this.#berryBushCount === this.#berryBushes.length) {
      const grown = new Int32Array(this.#berryBushes.length * 2);

      grown.set(this.#berryBushes);
      this.#berryBushes = grown;
    }

    const position = this.#berryBushPosition(index);

    this.#berryBushes.copyWithin(position + 1, position, this.#berryBushCount);
    this.#berryBushes[position] = index;
    this.#berryBushCount += 1;
    this.#countFruit(index, 1);
  }

  #untrackBerryBush(index: number): void {
    if (!this.#givesBerries(index)) {
      return;
    }

    const position = this.#berryBushPosition(index);

    this.#berryBushes.copyWithin(position, position + 1, this.#berryBushCount);
    this.#berryBushCount -= 1;
    this.#countFruit(index, -1);
  }

  #berryBushPosition(index: number): number {
    let low = 0;
    let high = this.#berryBushCount;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);

      if (this.#berryBushes[middle] < index) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  #countFruit(index: number, direction: number): void {
    const fruit = this.fruit[index];

    if (fruit === 1) {
      this.#fullBerryBushCount += direction;
    }

    if (fruit === 0) {
      this.#emptyBerryBushCount += direction;
    }
  }

  #linkToCell(index: number, cell: number): void {
    this.cell[index] = cell;

    if (cell === NO_PLANT) {
      return;
    }

    this.#nextInCell[index] = this.#firstInCell[cell];
    this.#firstInCell[cell] = index;
  }

  #unlinkFromCell(index: number): void {
    const cell = this.cell[index];

    if (cell === NO_PLANT) {
      return;
    }

    let previous = NO_PLANT;
    let current = this.#firstInCell[cell];

    while (current !== NO_PLANT && current !== index) {
      previous = current;
      current = this.#nextInCell[current];
    }

    if (current === index && previous === NO_PLANT) {
      this.#firstInCell[cell] = this.#nextInCell[index];
    } else if (current === index) {
      this.#nextInCell[previous] = this.#nextInCell[index];
    }

    this.cell[index] = NO_PLANT;
    this.#nextInCell[index] = NO_PLANT;
  }
}
