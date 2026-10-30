import { uniform } from "three/tsl";
import {
  type DirectionalLight,
  type Frustum,
  Group,
  type InstancedBufferGeometry,
  type MeshStandardNodeMaterial,
  type PerspectiveCamera,
  Vector2,
  Vector3,
} from "three/webgpu";
import { PLANT_SPECIES, PlantSpecies } from "../../content/plants.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { MaterialSlot } from "../../models/materials.ts";
import type { MeshData, VertexChannel } from "../../models/mesh/mesh-data.ts";
import { buildPlantVariant, PLANT_DETAIL_LEVELS } from "../../models/plants/plant-models.ts";
import type { CellRegion } from "../../world/change-tracking.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { CAMERA_FADE_REACH, extentOf, type ObjectExtent, widestExtent } from "../camera-fade.ts";
import type { FireGlow } from "../effects/fire-glow.ts";
import type { HandMotion } from "../hand-motion.ts";
import { geometryFromMeshData, InstanceBatch, toInstancedGeometry } from "../instancing.ts";
import { SHADOW_ONLY_LAYER } from "../shadow-only-layer.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import { HIDDEN_LEVEL, levelWithin } from "../view-input.ts";
import { createPlantMaterial, PlantWeather, SpeciesLook } from "./plant-material.ts";
import { foliageLook } from "./plant-palette.ts";
import {
  bucketGroups,
  bucketOf,
  FLOATS_PER_PLANT,
  PLANT_BUCKETS,
  PLANT_SINKING,
  SPARSE_SHARE,
  type VegetationChunk,
  VegetationChunks,
  writePlantLook,
} from "./vegetation-chunks.ts";

const LEVEL_DISTANCES: readonly number[] = [160, 600, 1600, 4200, Number.POSITIVE_INFINITY];
const FAR_LEVEL_DISTANCES: readonly number[] = [160, 600, 1600, Number.POSITIVE_INFINITY];
const SHADOW_LEVEL_COUNT = 3;
const BURN_DETAIL_FADE = { end: 1300, start: 500 } as const;
const FAR_BURN_DETAIL_FADE = { end: 24_000, start: 16_000 } as const;
const NEAREST_LEVEL = 0;
const SHADOW_PROXY_LEVEL = 1;
const FARTHEST_MODEL_LEVEL = 3;
const SPARSE_LEVEL = 4;
const SPARSE_OVERLAP = 1.15;
const SPARSE_WIDENING = Math.sqrt(1 / SPARSE_SHARE) * SPARSE_OVERLAP;

const PLANT_CHANNELS: readonly VertexChannel[] = ["flutter", "part", "shade", "slot", "sway"];

const PLANT_FIELDS = [
  { name: "plantPlacement", size: 4 },
  { name: "plantLook", size: 4 },
] as const;

interface PlantReach {
  readonly hasFarPlants: boolean;
  readonly hasFarShadows: boolean;
}

interface PlantModel {
  readonly buckets: readonly number[];
  readonly mesh: MeshData;
  readonly species: number;
}

interface NearMaterials {
  readonly fading: MeshStandardNodeMaterial;
  readonly solid: MeshStandardNodeMaterial;
}

interface BatchCounts {
  drawn: number;
  shadowed: number;
}

interface PlantBatch {
  readonly batch: InstanceBatch;
  readonly buckets: readonly number[];
  readonly counts: BatchCounts;
}

function crownMiddle(models: readonly PlantModel[], species: number): number {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;

  for (const { mesh } of models.filter((model) => {
    return model.species === species;
  })) {
    const { channels, positions } = mesh;

    for (const [vertex, slot] of channels.slot.entries()) {
      if (slot === MaterialSlot.Leaf || slot === MaterialSlot.Needle) {
        lowest = Math.min(lowest, positions[vertex * 3 + 1]);
        highest = Math.max(highest, positions[vertex * 3 + 1]);
      }
    }
  }

  if (lowest > highest) {
    return 0;
  }

  return (lowest + highest) / 2;
}

function speciesExtent(models: readonly PlantModel[], species: number): ObjectExtent {
  return widestExtent(
    models
      .filter((model) => {
        return model.species === species;
      })
      .map((model) => {
        return extentOf(model.mesh.positions);
      })
  );
}

function shadowFrustumOf(sun: DirectionalLight): Frustum {
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  sun.shadow.updateMatrices(sun);

  return sun.shadow.getFrustum();
}

function castsShadowAt(
  chunk: VegetationChunk,
  level: number,
  shadowFrustum: Frustum,
  shadowLevelCount: number
): boolean {
  if (level === HIDDEN_LEVEL || level >= shadowLevelCount) {
    return false;
  }

  return shadowFrustum.intersectsBox(chunk.bounds);
}

function chunkLevelOf(
  chunk: VegetationChunk,
  camera: PerspectiveCamera,
  frustum: Frustum,
  detail: number,
  levelDistances: readonly number[]
): number {
  if (chunk.plants.size === 0 || !frustum.intersectsBox(chunk.bounds)) {
    return HIDDEN_LEVEL;
  }

  const distance = chunk.bounds.distanceToPoint(camera.position);

  return levelWithin(distance, levelDistances, detail);
}

function widened(mesh: MeshData, factor: number): MeshData {
  const positions = mesh.positions.slice();

  for (let offset = 0; offset < positions.length; offset += 3) {
    positions[offset] *= factor;
    positions[offset + 2] *= factor;
  }

  return { ...mesh, positions };
}

function plantsOf(chunk: VegetationChunk, bucket: number, isSparse: boolean): Float32Array {
  const source = chunk.buckets[bucket];

  if (!isSparse) {
    return source;
  }

  return source.subarray(0, chunk.sparseCounts[bucket] * FLOATS_PER_PLANT);
}

function fillPlants(
  plants: PlantBatch,
  chunks: readonly VegetationChunk[],
  casterCount: number,
  isSparse = false
): void {
  const { batch, buckets, counts } = plants;

  const sources: Float32Array[] = [];

  let shadowedFloats = 0;

  for (const [index, chunk] of chunks.entries()) {
    for (const bucket of buckets) {
      const source = plantsOf(chunk, bucket, isSparse);

      if (source.length === 0) {
        continue;
      }

      sources.push(source);

      if (index < casterCount) {
        shadowedFloats += source.length;
      }
    }
  }

  batch.fill(sources);
  counts.drawn = batch.count;
  counts.shadowed = shadowedFloats / FLOATS_PER_PLANT;
}

export class VegetationView {
  readonly chunks: VegetationChunks;
  readonly group = new Group();
  readonly weather = new PlantWeather();
  readonly #batches: readonly (readonly PlantBatch[])[];
  readonly #changedBuckets: readonly Set<number>[];
  readonly #chunkLevels: Int8Array;
  readonly #chunkShadows: Uint8Array;
  readonly #detailFade = uniform(new Vector2(BURN_DETAIL_FADE.start, BURN_DETAIL_FADE.end));
  readonly #heldBatches = new Map<number, InstanceBatch>();
  readonly #heldInstance = new Float32Array(FLOATS_PER_PLANT);
  readonly #highlight = uniform(new Vector3());
  readonly #looks: readonly SpeciesLook[];
  readonly #mirror: WorldMirror;
  readonly #nearMaterials: readonly NearMaterials[];
  readonly #shadowProxies: readonly PlantBatch[];
  #heldBatch: InstanceBatch | null = null;
  #isFadingNear = false;
  #levelDistances = LEVEL_DISTANCES;
  #paintedSeason = Number.NaN;
  #shadowLevelCount = SHADOW_LEVEL_COUNT;
  #shouldRefillAll = true;

  constructor(mirror: WorldMirror, textures: TerrainTextures, glow: FireGlow) {
    this.#mirror = mirror;
    this.chunks = new VegetationChunks(mirror);
    this.#chunkLevels = new Int8Array(this.chunks.chunks.length).fill(HIDDEN_LEVEL);
    this.#chunkShadows = new Uint8Array(this.chunks.chunks.length);
    this.#looks = PLANT_SPECIES.map(() => {
      return new SpeciesLook();
    });

    const detailedModels = PLANT_DETAIL_LEVELS.map((level) => {
      return bucketGroups(level).map((buckets) => {
        const { species, variant } = PLANT_BUCKETS[buckets[0]];

        return { buckets, mesh: buildPlantVariant(species, variant, level), species };
      });
    });
    const sparseModels = detailedModels[FARTHEST_MODEL_LEVEL].map((model) => {
      return { ...model, mesh: widened(model.mesh, SPARSE_WIDENING) };
    });
    const models = [...detailedModels, sparseModels];

    const materials = this.#looks.map((look, species) => {
      const options = {
        crown: {
          hasTiers: species === PlantSpecies.Spruce,
          middle: crownMiddle(models[NEAREST_LEVEL], species),
        },
        detailFade: this.#detailFade,
        glow,
        grid: mirror.grid,
        highlight: this.#highlight,
        isFlammable: PLANT_SPECIES[species].canopyFuel > 0,
        look,
        textures,
        weather: this.weather,
      };

      return {
        fading: createPlantMaterial({ ...options, fadingExtent: speciesExtent(models[NEAREST_LEVEL], species) }),
        solid: createPlantMaterial({ ...options, fadingExtent: null }),
      };
    });

    this.#batches = models.map((levelModels, levelIndex) => {
      return levelModels.map(({ buckets, mesh, species }) => {
        return this.#createBatch(
          geometryFromMeshData(mesh, PLANT_CHANNELS),
          materials[species].solid,
          levelIndex,
          buckets
        );
      });
    });
    this.#nearMaterials = models[NEAREST_LEVEL].map(({ species }) => {
      return materials[species];
    });

    this.#shadowProxies = models[SHADOW_PROXY_LEVEL].map(({ buckets, mesh, species }) => {
      return this.#createShadowProxy(geometryFromMeshData(mesh, PLANT_CHANNELS), materials[species].solid, buckets);
    });

    this.#changedBuckets = this.#batches.map(() => {
      return new Set<number>();
    });
  }

  plantsChanged(indices: readonly number[]): void {
    this.chunks.plantsChanged(indices);
  }

  heightsChanged(region: CellRegion): void {
    this.chunks.heightsChanged(region);
  }

  highlightPlant(plant: number): void {
    const { vegetation } = this.#mirror;

    if (plant === NO_PLANT) {
      this.#highlight.value.set(0, 0, 0);

      return;
    }

    this.#highlight.value.set(vegetation.x[plant], vegetation.z[plant], 1);
  }

  hold(hand: HandMotion): void {
    const { subject } = hand;
    const plant = subject === null || subject.kind !== "plant" ? NO_PLANT : subject.id;

    this.chunks.hold(plant);

    if (this.#heldBatch !== null) {
      this.#heldBatch.begin();
      this.#heldBatch.commit();
      this.#heldBatch = null;
    }

    if (plant === NO_PLANT) {
      return;
    }

    const { vegetation } = this.#mirror;

    const pose = hand.poseOf("plant", plant, vegetation.x[plant], vegetation.z[plant]);

    if (pose === null) {
      return;
    }

    const batch = this.#heldBatchFor(bucketOf(vegetation.species[plant], vegetation.seed[plant]));
    const instance = this.#heldInstance;

    instance[0] = pose.x;
    instance[1] = this.#mirror.surfaceAt(pose.x, pose.z) + pose.lift - PLANT_SINKING;
    instance[2] = pose.z;
    instance[3] = vegetation.rotation[plant];
    writePlantLook(vegetation, plant, instance, 4);

    batch.begin();
    batch.add(instance);
    batch.commit();
    this.#heldBatch = batch;
  }

  setReach({ hasFarPlants, hasFarShadows }: PlantReach): void {
    const fade = hasFarPlants ? FAR_BURN_DETAIL_FADE : BURN_DETAIL_FADE;

    this.#levelDistances = hasFarPlants ? FAR_LEVEL_DISTANCES : LEVEL_DISTANCES;
    this.#shadowLevelCount = hasFarShadows ? LEVEL_DISTANCES.length : SHADOW_LEVEL_COUNT;
    this.#detailFade.value.set(fade.start, fade.end);

    for (const [levelIndex, batches] of this.#batches.entries()) {
      for (const { batch } of batches) {
        batch.mesh.castShadow = this.#castsShadowAtLevel(levelIndex);
      }
    }

    this.#shouldRefillAll = true;
  }

  update(camera: PerspectiveCamera, frustum: Frustum, sun: DirectionalLight, detail: number, season: number): void {
    this.#paintSeason(season);

    const repacked = this.chunks.repackDirty();

    this.#assignLevels(camera, frustum, sun, detail);
    this.#fadeNearCamera(camera);
    this.#markBucketsOf(repacked);
    this.#refillDirtyLevels(this.#shouldRefillAll);
    this.#shouldRefillAll = false;
  }

  dispose(): void {
    for (const plants of [...this.#batches.flat(), ...this.#shadowProxies]) {
      plants.batch.dispose();
    }

    for (const batch of this.#heldBatches.values()) {
      batch.dispose();
    }
  }

  #createBatch(
    geometry: InstancedBufferGeometry,
    material: MeshStandardNodeMaterial,
    levelIndex: number,
    buckets: readonly number[]
  ): PlantBatch {
    const batch = new InstanceBatch(geometry, material, PLANT_FIELDS, 64);
    const counts: BatchCounts = { drawn: 0, shadowed: 0 };

    batch.mesh.castShadow = this.#castsShadowAtLevel(levelIndex);
    batch.mesh.receiveShadow = true;
    batch.mesh.onBeforeShadow = () => {
      geometry.instanceCount = counts.shadowed;
    };
    batch.mesh.onAfterShadow = () => {
      geometry.instanceCount = counts.drawn;
    };
    this.group.add(batch.mesh);

    return { batch, buckets, counts };
  }

  #createShadowProxy(
    geometry: InstancedBufferGeometry,
    material: MeshStandardNodeMaterial,
    buckets: readonly number[]
  ): PlantBatch {
    const batch = new InstanceBatch(geometry, material, PLANT_FIELDS, 64);

    batch.mesh.castShadow = true;
    batch.mesh.layers.set(SHADOW_ONLY_LAYER);
    this.group.add(batch.mesh);

    return { batch, buckets, counts: { drawn: 0, shadowed: 0 } };
  }

  #castsShadowAtLevel(levelIndex: number): boolean {
    return levelIndex !== NEAREST_LEVEL && levelIndex < this.#shadowLevelCount;
  }

  #heldBatchFor(bucket: number): InstanceBatch {
    const known = this.#heldBatches.get(bucket);

    if (known !== undefined) {
      return known;
    }

    const nearest = this.#nearestBatchOf(bucket);
    const { fading } = this.#nearMaterials[this.#batches[NEAREST_LEVEL].indexOf(nearest)];
    const batch = new InstanceBatch(toInstancedGeometry(nearest.batch.mesh.geometry), fading, PLANT_FIELDS, 1);

    batch.mesh.castShadow = true;
    batch.mesh.receiveShadow = true;
    this.group.add(batch.mesh);
    this.#heldBatches.set(bucket, batch);

    return batch;
  }

  #nearestBatchOf(bucket: number): PlantBatch {
    for (const plants of this.#batches[NEAREST_LEVEL]) {
      if (plants.buckets.includes(bucket)) {
        return plants;
      }
    }

    throw new RangeError(`No plant model for bucket ${bucket}`);
  }

  #paintSeason(season: number): void {
    if (season === this.#paintedSeason) {
      return;
    }

    this.#paintedSeason = season;

    for (const [species, look] of this.#looks.entries()) {
      const current = foliageLook(PLANT_SPECIES[species].index, season);

      look.foliageColor.value.setHex(current.color);
      look.foliageCoverage.value = current.coverage;
    }
  }

  #fadeNearCamera(camera: PerspectiveCamera): void {
    const isFading = this.chunks.chunks.some((chunk, index) => {
      return (
        this.#chunkLevels[index] === NEAREST_LEVEL && chunk.bounds.distanceToPoint(camera.position) < CAMERA_FADE_REACH
      );
    });

    if (isFading === this.#isFadingNear) {
      return;
    }

    this.#isFadingNear = isFading;

    for (const [index, { batch }] of this.#batches[NEAREST_LEVEL].entries()) {
      const { fading, solid } = this.#nearMaterials[index];

      batch.mesh.material = isFading ? fading : solid;
    }
  }

  #assignLevels(camera: PerspectiveCamera, frustum: Frustum, sun: DirectionalLight, detail: number): void {
    const shadowFrustum = shadowFrustumOf(sun);

    for (const [index, chunk] of this.chunks.chunks.entries()) {
      const level = chunkLevelOf(chunk, camera, frustum, detail, this.#levelDistances);
      const castsShadow = castsShadowAt(chunk, level, shadowFrustum, this.#shadowLevelCount) ? 1 : 0;
      const previous = this.#chunkLevels[index];

      if (level !== previous) {
        this.#chunkLevels[index] = level;
        this.#markBucketsDirty(chunk, previous);
        this.#markBucketsDirty(chunk, level);
      }

      if (castsShadow !== this.#chunkShadows[index]) {
        this.#chunkShadows[index] = castsShadow;
        this.#markBucketsDirty(chunk, level);
      }
    }
  }

  #markBucketsOf(chunkIndices: readonly number[]): void {
    for (const index of chunkIndices) {
      const level = this.#chunkLevels[index];

      if (level === HIDDEN_LEVEL) {
        continue;
      }

      for (const bucket of this.chunks.chunks[index].changedBuckets) {
        this.#changedBuckets[level].add(bucket);
      }
    }

    for (const index of chunkIndices) {
      this.chunks.chunks[index].changedBuckets = [];
    }
  }

  #markBucketsDirty(chunk: VegetationChunk, level: number): void {
    if (level === HIDDEN_LEVEL) {
      return;
    }

    const changed = this.#changedBuckets[level];

    for (const [bucket, source] of chunk.buckets.entries()) {
      if (source.length > 0) {
        changed.add(bucket);
      }
    }

    for (const bucket of chunk.changedBuckets) {
      changed.add(bucket);
    }
  }

  #refillDirtyLevels(isWhole: boolean): void {
    for (const [level, batches] of this.#batches.entries()) {
      const changed = this.#changedBuckets[level];

      if (!isWhole && changed.size === 0) {
        continue;
      }

      const casters = this.chunks.chunks.filter((_chunk, index) => {
        return this.#chunkLevels[index] === level && this.#chunkShadows[index] === 1;
      });
      const others = this.chunks.chunks.filter((_chunk, index) => {
        return this.#chunkLevels[index] === level && this.#chunkShadows[index] === 0;
      });
      const chunks = [...casters, ...others];

      for (const batch of batches) {
        if (
          isWhole ||
          batch.buckets.some((bucket) => {
            return changed.has(bucket);
          })
        ) {
          fillPlants(batch, chunks, casters.length, level === SPARSE_LEVEL);
        }
      }

      if (level === NEAREST_LEVEL) {
        for (const proxy of this.#shadowProxies) {
          if (
            isWhole ||
            proxy.buckets.some((bucket) => {
              return changed.has(bucket);
            })
          ) {
            fillPlants(proxy, casters, casters.length);
          }
        }
      }

      changed.clear();
    }
  }
}
