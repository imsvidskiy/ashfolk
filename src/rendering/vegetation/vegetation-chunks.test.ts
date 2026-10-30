import { describe, expect, it } from "vitest";
import { PLANT_SPECIES, PlantSpecies } from "../../content/plants.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { canonicalHeight } from "../../models/plants/plant-models.ts";
import { NO_PLANT, PlantState } from "../../world/vegetation-store.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import {
  BUCKET_COUNT,
  bucketGroups,
  FLOATS_PER_PLANT,
  PLANT_BUCKETS,
  PLANT_SINKING,
  SPARSE_SHARE,
  VegetationChunks,
} from "./vegetation-chunks.ts";

const SLOPE = 0.6;

function packedPlantCount(chunks: VegetationChunks): number {
  return chunks.chunks.reduce((total, chunk) => {
    return (
      total +
      chunk.buckets.reduce((sum, bucket) => {
        return sum + bucket.length / FLOATS_PER_PLANT;
      }, 0)
    );
  }, 0);
}

function chunkOf(chunks: VegetationChunks, plant: number): number {
  return chunks.chunks.findIndex((chunk) => {
    return chunk.plants.has(plant);
  });
}

function alivePlantCount(mirror: WorldMirror): number {
  let count = 0;

  for (let plant = 0; plant < mirror.vegetation.count; plant += 1) {
    if (mirror.vegetation.state[plant] !== PlantState.Removed) {
      count += 1;
    }
  }

  return count;
}

describe("vegetation chunks", () => {
  it("packs every standing plant once", () => {
    const mirror = createVegetatedMirror();
    const chunks = new VegetationChunks(mirror);

    chunks.repackDirty();

    expect(alivePlantCount(mirror)).toBeGreaterThan(0);
    expect(packedPlantCount(chunks)).toBe(alivePlantCount(mirror));
  });

  it("packs about a third of the plants first for the sparse far level", () => {
    const mirror = createVegetatedMirror();
    const chunks = new VegetationChunks(mirror);

    chunks.repackDirty();

    const sparseCount = chunks.chunks.reduce((total, chunk) => {
      return (
        total +
        chunk.sparseCounts.reduce((sum, count) => {
          return sum + count;
        }, 0)
      );
    }, 0);
    const share = sparseCount / packedPlantCount(chunks);

    expect(share).toBeGreaterThan(SPARSE_SHARE - 0.1);
    expect(share).toBeLessThan(SPARSE_SHARE + 0.1);

    for (const chunk of chunks.chunks) {
      for (const [bucket, count] of chunk.sparseCounts.entries()) {
        expect(count * FLOATS_PER_PLANT).toBeLessThanOrEqual(chunk.buckets[bucket].length);
      }
    }
  });

  it("keeps one bucket per species and variant", () => {
    const chunks = new VegetationChunks(createVegetatedMirror());

    chunks.repackDirty();

    for (const chunk of chunks.chunks) {
      expect(chunk.buckets).toHaveLength(BUCKET_COUNT);
    }
  });

  it("drops removed plants after a change", () => {
    const mirror = createVegetatedMirror();
    const chunks = new VegetationChunks(mirror);

    chunks.repackDirty();
    mirror.vegetation.state[0] = PlantState.Removed;
    chunks.plantsChanged([0]);

    expect(chunks.repackDirty()).toHaveLength(1);
    expect(packedPlantCount(chunks)).toBe(alivePlantCount(mirror));
  });

  it("reports every bucket whose plants a repack changed", () => {
    const mirror = createVegetatedMirror();
    const chunks = new VegetationChunks(mirror);

    chunks.repackDirty();

    const before = chunks.chunks.map((chunk) => {
      return chunk.buckets.map((bucket) => {
        return [...bucket];
      });
    });

    mirror.vegetation.height[0] *= 1.5;
    mirror.vegetation.state[1] = PlantState.Removed;
    chunks.plantsChanged([0, 1]);

    const repacked = chunks.repackDirty();

    expect(repacked.length).toBeGreaterThan(0);

    for (const index of repacked) {
      const { buckets, changedBuckets } = chunks.chunks[index];

      expect(changedBuckets.length).toBeGreaterThan(0);

      const unchanged = [...buckets.entries()].filter(([bucket]) => {
        return !changedBuckets.includes(bucket);
      });

      for (const [bucket, data] of unchanged) {
        expect([...data]).toEqual(before[index][bucket]);
      }
    }
  });

  it("takes a held plant out of its chunk and packs it where it is set down", () => {
    const mirror = createVegetatedMirror();
    const chunks = new VegetationChunks(mirror);
    const { vegetation } = mirror;

    chunks.repackDirty();

    const origin = chunkOf(chunks, 0);
    const destination = chunks.chunks.findIndex((chunk, index) => {
      return index !== origin && chunk.plants.size > 0;
    });
    const destinationChunk = chunks.chunks[destination];

    if (origin < 0 || destinationChunk === undefined) {
      throw new Error("The test world should have plants in two chunks");
    }

    const [neighbor] = [...destinationChunk.plants];

    chunks.hold(0);
    chunks.repackDirty();

    expect(chunkOf(chunks, 0)).toBe(-1);
    expect(packedPlantCount(chunks)).toBe(alivePlantCount(mirror) - 1);

    vegetation.x[0] = vegetation.x[neighbor];
    vegetation.z[0] = vegetation.z[neighbor];
    chunks.hold(NO_PLANT);
    chunks.repackDirty();

    expect(chunkOf(chunks, 0)).toBe(destination);
    expect(packedPlantCount(chunks)).toBe(alivePlantCount(mirror));
  });

  it("widens a chunk's bounds to the crowns of its plants", () => {
    const mirror = createVegetatedMirror();
    const crowns = PLANT_SPECIES.map((definition) => {
      return { height: 0, radius: canonicalHeight(definition.index) * 100 };
    });
    const chunks = new VegetationChunks(mirror, crowns);

    chunks.repackDirty();

    const { bounds } = chunks.chunks[chunkOf(chunks, 0)];

    expect(bounds.max.x).toBeGreaterThanOrEqual(mirror.vegetation.x[0] + mirror.vegetation.height[0] * 99);
  });

  it("finds plants by the chunks around a spot", () => {
    const mirror = createVegetatedMirror();
    const chunks = new VegetationChunks(mirror);
    const { vegetation } = mirror;

    const near = chunks.plantsNear([{ x: vegetation.x[0], z: vegetation.z[0] }], 1);

    expect(near).toContain(0);
    expect(near.length).toBeLessThan(alivePlantCount(mirror));
    expect(
      near.every((plant) => {
        return chunkOf(chunks, plant) === chunkOf(chunks, 0);
      })
    ).toBe(true);
    expect(chunks.plantsNear([{ x: 0, z: 0 }], mirror.grid.worldSize)).toHaveLength(alivePlantCount(mirror));
  });

  it("finds a held plant that the chunks leave out", () => {
    const mirror = createVegetatedMirror();
    const chunks = new VegetationChunks(mirror);
    const { vegetation } = mirror;

    chunks.hold(0);

    expect(chunkOf(chunks, 0)).toBe(-1);
    expect(chunks.plantsNear([{ x: vegetation.x[0], z: vegetation.z[0] }], 1)).toContain(0);
  });

  it("reports every bucket after a height change", () => {
    const chunks = new VegetationChunks(createVegetatedMirror());

    chunks.repackDirty();
    chunks.heightsChanged({ firstColumn: 0, firstRow: 0, lastColumn: 0, lastRow: 0 });

    const [chunk] = chunks.repackDirty();

    expect(chunks.chunks[chunk].changedBuckets).toHaveLength(BUCKET_COUNT);
  });

  it("places plants on the ground", () => {
    const mirror = createVegetatedMirror();
    const chunks = new VegetationChunks(mirror);

    chunks.repackDirty();

    const chunk = chunks.chunks.find((candidate) => {
      return candidate.plants.size > 0;
    });
    const bucket = chunk?.buckets.find((candidate) => {
      return candidate.length > 0;
    });

    if (bucket === undefined) {
      throw new Error("The test world should have plants");
    }

    const [x, y, z] = bucket;

    expect(y).toBeCloseTo(mirror.heightAt(x, z) - PLANT_SINKING, 3);
  });

  it("sinks plants on a slope until their downhill side touches the ground", () => {
    const mirror = createVegetatedMirror({
      heightAt: (x) => {
        return 100 + x * SLOPE;
      },
    });
    const chunks = new VegetationChunks(mirror);

    chunks.repackDirty();

    const buckets = chunks.chunks.flatMap((chunk) => {
      return chunk.buckets.filter((bucket) => {
        return bucket.length > 0;
      });
    });

    expect(buckets.length).toBeGreaterThan(0);

    for (const bucket of buckets) {
      for (let offset = 0; offset < bucket.length; offset += FLOATS_PER_PLANT) {
        const [x, y, z] = bucket.subarray(offset, offset + 3);

        expect(y).toBeLessThan(mirror.heightAt(x, z) - PLANT_SINKING - 0.05);
      }
    }
  });

  it.each(["high", "medium", "low"] as const)("draws every bucket in exactly one %s batch", (level) => {
    const drawn = bucketGroups(level).flat();

    expect(
      [...drawn].sort((first, second) => {
        return first - second;
      })
    ).toEqual(
      Array.from({ length: BUCKET_COUNT }, (_, bucket) => {
        return bucket;
      })
    );
  });

  it("shares one far batch between the variants of a tree but keeps every cactus and monument form apart", () => {
    const farGroups = bucketGroups("low");

    function groupsOf(species: number): number {
      return farGroups.filter((group) => {
        return PLANT_BUCKETS[group[0]].species === species;
      }).length;
    }

    function bucketsOf(species: number): number {
      return PLANT_BUCKETS.filter((bucket) => {
        return bucket.species === species;
      }).length;
    }

    expect(farGroups.length).toBeLessThan(BUCKET_COUNT / 2);
    expect(groupsOf(PlantSpecies.Oak)).toBe(1);

    for (const species of [
      PlantSpecies.Cactus,
      PlantSpecies.Arch,
      PlantSpecies.Cairn,
      PlantSpecies.Dolmen,
      PlantSpecies.Idol,
      PlantSpecies.Menhir,
      PlantSpecies.Pillar,
    ]) {
      expect(groupsOf(species)).toBe(bucketsOf(species));
    }
  });
});
