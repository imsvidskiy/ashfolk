import { Box3, Vector3 } from "three/webgpu";
import { isMonumentSpecies, PLANT_SPECIES, type PlantSpeciesIndex } from "../../content/plants.ts";
import type { GroundPoint } from "../../game/camera/god-camera.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { canonicalHeight, farVariantOf, footprintRadius, plantVariantCount } from "../../models/plants/plant-models.ts";
import { isDistantLevel, type PlantDetailLevel } from "../../models/plants/tree-mesher.ts";
import { grownIndexArray } from "../../shared/growth.ts";
import { clamp, hashToUnit } from "../../shared/math.ts";
import type { CellRegion } from "../../world/change-tracking.ts";
import { NO_PLANT, PlantState, type VegetationChannels } from "../../world/vegetation-store.ts";
import type { ObjectExtent } from "../camera-fade.ts";

export const CHUNK_CELLS = 16;
export const FLOATS_PER_PLANT = 8;
export const PLANT_SINKING = 0.15;
export const SPARSE_SHARE = 1 / 3;

const NO_CHUNK = -1;
const NO_BUCKET = -1;
const EMPTY_BUCKET = new Float32Array(0);
const corner = new Vector3();
const NO_CROWNS: readonly ObjectExtent[] = PLANT_SPECIES.map(() => {
  return { height: 0, radius: 0 };
});

interface PlantBucket {
  readonly species: PlantSpeciesIndex;
  readonly variant: number;
}

export const PLANT_BUCKETS: readonly PlantBucket[] = PLANT_SPECIES.flatMap((definition) => {
  return Array.from({ length: plantVariantCount(definition.index) }, (_, variant) => {
    return { species: definition.index, variant };
  });
});
export const BUCKET_COUNT = PLANT_BUCKETS.length;

const FIRST_BUCKETS: readonly number[] = PLANT_SPECIES.map((definition) => {
  return PLANT_BUCKETS.findIndex((bucket) => {
    return bucket.species === definition.index;
  });
});

export interface VegetationChunk {
  readonly bounds: Box3;
  buckets: Float32Array[];
  changedBuckets: number[];
  isDirty: boolean;
  readonly plants: Set<number>;
  sparseCounts: number[];
}

export function bucketOf(species: number, seed: number): number {
  const count = plantVariantCount(PLANT_SPECIES[species].index);

  return FIRST_BUCKETS[species] + Math.min(count - 1, Math.floor(seed * count));
}

export function bucketGroups(level: PlantDetailLevel): number[][] {
  if (!isDistantLevel(level)) {
    return PLANT_BUCKETS.map((_bucket, index) => {
      return [index];
    });
  }

  const groups = new Map<string, number[]>();

  for (const [index, { species, variant }] of PLANT_BUCKETS.entries()) {
    const key = `${species}:${farVariantOf(species, variant)}`;
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [index]);

      continue;
    }

    group.push(index);
  }

  return [...groups.values()];
}

export function writePlantLook(
  vegetation: VegetationChannels,
  plant: number,
  target: Float32Array,
  offset: number
): void {
  const species = vegetation.species[plant];

  target[offset] = vegetation.height[plant] / canonicalHeight(PLANT_SPECIES[species].index);
  target[offset + 1] = (vegetation.seed[plant] * 7.31) % 1;
  target[offset + 2] = vegetation.state[plant];
  target[offset + 3] = vegetation.fruit[plant];
}

function isKeptWhenSparse(plant: number): boolean {
  return hashToUnit(plant, 1) < SPARSE_SHARE;
}

function allocateBucket(count: number): Float32Array {
  if (count === 0) {
    return EMPTY_BUCKET;
  }

  return new Float32Array(count * FLOATS_PER_PLANT);
}

export class VegetationChunks {
  readonly chunks: VegetationChunk[] = [];
  readonly chunksPerSide: number;
  readonly #crowns: readonly ObjectExtent[];
  readonly #footprints: readonly number[] = PLANT_SPECIES.map((species) => {
    return footprintRadius(species.index);
  });
  readonly #mirror: WorldMirror;
  readonly #touchedBuckets: Set<number>[] = [];
  #bucketOfPlant = new Int32Array(0);
  #chunkOfPlant = new Int32Array(0);
  #heldPlant = NO_PLANT;
  #keptWhenSparse = new Int32Array(0);

  constructor(mirror: WorldMirror, crowns = NO_CROWNS) {
    this.#mirror = mirror;
    this.#crowns = crowns;
    this.chunksPerSide = Math.ceil(mirror.grid.cellsPerSide / CHUNK_CELLS);

    for (let chunk = 0; chunk < this.chunksPerSide * this.chunksPerSide; chunk += 1) {
      this.chunks.push({
        bounds: new Box3(),
        buckets: [],
        changedBuckets: [],
        isDirty: true,
        plants: new Set(),
        sparseCounts: [],
      });
      this.#touchedBuckets.push(new Set());
    }

    const { count } = mirror.vegetation;

    for (let plant = 0; plant < count; plant += 1) {
      this.#place(plant);
    }
  }

  plantsChanged(indices: readonly number[]): void {
    for (const plant of indices) {
      this.#place(plant);
    }
  }

  hold(plant: number): void {
    const previous = this.#heldPlant;

    if (plant === previous) {
      return;
    }

    this.#heldPlant = plant;

    for (const changed of [previous, plant]) {
      if (changed !== NO_PLANT) {
        this.#place(changed);
      }
    }
  }

  plantsNear(spots: readonly GroundPoint[], radius: number): number[] {
    const chunks = new Set<number>();

    for (const { x, z } of spots) {
      this.#collectChunks(x, z, radius, chunks);
    }

    const plants: number[] = this.#heldPlant === NO_PLANT ? [] : [this.#heldPlant];

    for (const chunk of chunks) {
      plants.push(...this.chunks[chunk].plants);
    }

    return plants;
  }

  heightsChanged(region: CellRegion): void {
    const firstChunkColumn = Math.floor(region.firstColumn / CHUNK_CELLS);
    const lastChunkColumn = Math.floor(region.lastColumn / CHUNK_CELLS);
    const firstChunkRow = Math.floor(region.firstRow / CHUNK_CELLS);
    const lastChunkRow = Math.floor(region.lastRow / CHUNK_CELLS);

    for (let row = firstChunkRow; row <= lastChunkRow; row += 1) {
      for (let column = firstChunkColumn; column <= lastChunkColumn; column += 1) {
        this.#touchAll(row * this.chunksPerSide + column);
      }
    }
  }

  repackDirty(): number[] {
    const repacked: number[] = [];

    for (const [index, chunk] of this.chunks.entries()) {
      if (chunk.isDirty) {
        this.#repack(chunk, this.#touchedBuckets[index]);
        repacked.push(index);
      }
    }

    return repacked;
  }

  #collectChunks(x: number, z: number, radius: number, chunks: Set<number>): void {
    const { grid } = this.#mirror;

    const last = this.chunksPerSide - 1;
    const firstColumn = clamp(Math.floor(grid.columnAt(x - radius) / CHUNK_CELLS), 0, last);
    const lastColumn = clamp(Math.floor(grid.columnAt(x + radius) / CHUNK_CELLS), 0, last);
    const firstRow = clamp(Math.floor(grid.rowAt(z - radius) / CHUNK_CELLS), 0, last);
    const lastRow = clamp(Math.floor(grid.rowAt(z + radius) / CHUNK_CELLS), 0, last);

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        chunks.add(row * this.chunksPerSide + column);
      }
    }
  }

  #place(plant: number): void {
    const { vegetation } = this.#mirror;

    this.#chunkOfPlant = grownIndexArray(this.#chunkOfPlant, plant + 1, NO_CHUNK);
    this.#bucketOfPlant = grownIndexArray(this.#bucketOfPlant, plant + 1, NO_BUCKET);
    this.#keptWhenSparse = grownIndexArray(this.#keptWhenSparse, plant + 1, 0);

    const previous = this.#chunkOfPlant[plant];
    const next = this.#chunkFor(plant);

    if (previous !== NO_CHUNK) {
      this.chunks[previous].plants.delete(plant);
      this.#touch(previous, this.#bucketOfPlant[plant]);
    }

    this.#chunkOfPlant[plant] = next;
    this.#bucketOfPlant[plant] = bucketOf(vegetation.species[plant], vegetation.seed[plant]);
    this.#keptWhenSparse[plant] = isKeptWhenSparse(plant) ? 1 : 0;

    if (next !== NO_CHUNK) {
      this.chunks[next].plants.add(plant);
      this.#touch(next, this.#bucketOfPlant[plant]);
    }
  }

  #touch(chunk: number, bucket: number): void {
    this.chunks[chunk].isDirty = true;
    this.#touchedBuckets[chunk].add(bucket);
  }

  #touchAll(chunk: number): void {
    for (let bucket = 0; bucket < BUCKET_COUNT; bucket += 1) {
      this.#touch(chunk, bucket);
    }
  }

  #chunkFor(plant: number): number {
    const { grid, vegetation } = this.#mirror;

    if (plant === this.#heldPlant || vegetation.state[plant] === PlantState.Removed) {
      return NO_CHUNK;
    }

    const cell = grid.cellAt(vegetation.x[plant], vegetation.z[plant]);

    if (cell === -1) {
      return NO_CHUNK;
    }

    const chunkColumn = Math.floor(grid.columnOf(cell) / CHUNK_CELLS);
    const chunkRow = Math.floor(grid.rowOf(cell) / CHUNK_CELLS);

    return chunkRow * this.chunksPerSide + chunkColumn;
  }

  #repack(chunk: VegetationChunk, touched: Set<number>): void {
    const counts = new Array<number>(BUCKET_COUNT).fill(0);
    const sparseCounts = new Array<number>(BUCKET_COUNT).fill(0);
    const sparse: number[] = [];
    const rest: number[] = [];

    for (const plant of chunk.plants) {
      const bucket = this.#bucketOfPlant[plant];

      counts[bucket] += 1;

      if (this.#keptWhenSparse[plant] === 1) {
        sparseCounts[bucket] += 1;
        sparse.push(plant);
      } else {
        rest.push(plant);
      }
    }

    const buckets = counts.map((count) => {
      return allocateBucket(count);
    });
    const filled = new Array<number>(BUCKET_COUNT).fill(0);

    chunk.bounds.makeEmpty();

    for (const plant of [...sparse, ...rest]) {
      const bucket = this.#bucketOfPlant[plant];
      const offset = filled[bucket] * FLOATS_PER_PLANT;

      this.#writePlant(plant, buckets[bucket], offset, chunk.bounds);
      filled[bucket] += 1;
    }

    chunk.buckets = buckets;
    chunk.sparseCounts = sparseCounts;
    chunk.changedBuckets = [...touched];
    chunk.isDirty = false;
    touched.clear();
  }

  #writePlant(plant: number, target: Float32Array, offset: number, bounds: Box3): void {
    const { vegetation } = this.#mirror;

    const x = vegetation.x[plant];
    const z = vegetation.z[plant];
    const species = vegetation.species[plant];
    const height = vegetation.height[plant];
    const scale = height / canonicalHeight(PLANT_SPECIES[species].index);
    const footprint = this.#footprints[species] * scale;
    const y = isMonumentSpecies(species) ? this.#groundAround(x, z, footprint) : this.#groundUnder(x, z, footprint);

    target[offset] = x;
    target[offset + 1] = y - PLANT_SINKING;
    target[offset + 2] = z;
    target[offset + 3] = vegetation.rotation[plant];
    writePlantLook(vegetation, plant, target, offset + 4);

    const crown = this.#crowns[species];
    const isFallen = vegetation.state[plant] === PlantState.Fallen;
    const reach = isFallen
      ? Math.max(height, Math.max(crown.radius, crown.height) * scale)
      : Math.max(height * 0.5, crown.radius * scale);
    const top = Math.max(height, (isFallen ? crown.radius : crown.height) * scale);

    bounds.expandByPoint(corner.set(x - reach, y - 1, z - reach));
    bounds.expandByPoint(corner.set(x + reach, y + top, z + reach));
  }

  #groundAround(x: number, z: number, radius: number): number {
    const mirror = this.#mirror;

    const around =
      mirror.heightAt(x + radius, z) +
      mirror.heightAt(x - radius, z) +
      mirror.heightAt(x, z + radius) +
      mirror.heightAt(x, z - radius);

    return Math.min(mirror.heightAt(x, z), around / 4);
  }

  #groundUnder(x: number, z: number, radius: number): number {
    const mirror = this.#mirror;

    return Math.min(
      mirror.heightAt(x, z),
      mirror.heightAt(x + radius, z),
      mirror.heightAt(x - radius, z),
      mirror.heightAt(x, z + radius),
      mirror.heightAt(x, z - radius)
    );
  }
}
