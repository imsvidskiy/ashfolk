# Spatial and context queries: research and recommendation

## 1. What engines do

- **Unity 6000.6** `OverlapSphereNonAlloc(position, radius, Collider[] results, layerMask, triggers)`:
  - writes into a caller buffer and returns the count;
  - "generates no garbage";
  - silently drops hits past the end of the buffer.
  - https://docs.unity.com/en-us/engine/current/script-reference/unityengine/physics/overlapspherenonalloc
- **Godot 4.7** `intersect_shape(params, max_results = 32) -> Array[Dictionary]` takes a params object and a cap, but allocates a dictionary per hit. https://docs.godotengine.org/en/stable/classes/class_physicsdirectspacestate3d.html
- **Factorio 2.1** `find_entities_filtered` and `count_entities_filtered` take one filter record:
  - fields: `area`, or `position`+`radius`, `name`, `type`, `force`, `limit`, `invert`; all ANDed;
  - counting is cheaper "as it doesn't construct all the wrapper objects".
  - https://lua-api.factorio.com/latest/classes/LuaSurface.html, https://lua-api.factorio.com/latest/concepts/EntitySearchFilters.html
- **RimWorld** (https://github.com/josh-m/RW-Decompile):
  - `ThingGrid` holds a `List<Thing>[]` per cell (`Verse/ThingGrid.cs:11`).
  - `ListerThings` keeps lists per `ThingRequestGroup` (Plant, Pawn, Fire…) (`ListerThings.cs:10,31`).
  - `GenRadial` precomputes 10,000 offsets sorted by distance (`GenRadial.cs:94-122`), so scans run nearest-first and can stop early.
  - `GenClosest` does a region-wise search (`GenClosest.cs:72`).
  - Caveat: the comparator returns 0 on ties and .NET `List.Sort` is unstable, so tie order is implementation-defined. We must break ties explicitly.
- **bevy_spatial** rebuilds its k-d tree on a wall-clock `with_frequency`. That breaks lockstep; rebuild per tick instead. https://docs.rs/crate/bevy_spatial/latest
- **Influence maps** stamp precomputed templates and combine layers arithmetically. They are the right model for fire, heat and threat nearby: grid layers, not object scans. https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter30_Modular_Tactical_Influence_Maps.pdf
- **Nystrom** on flat grids: they are "easier to reason about", "Memory usage is constant", and a move is a remove plus an add. https://gameprogrammingpatterns.com/spatial-partition.html
- **NVIDIA particles** build the grid by sorting on cell index and storing each cell's start, which keeps memory reads coherent. https://developer.download.nvidia.com/assets/cuda/files/particles.pdf

**Lessons:**
- One precompiled filter.
- Separate verbs (`count`, `any`, `nearest`, `visit`, `collect`).
- Results go into caller buffers.
- Per-cell lists plus per-group indexes.
- A radial pattern with a fixed tie order.

## 2. Today's code

- `society.ts:406` `livingWithin` filters all people and allocates per call. `rivalry/engagement.ts:33` calls it per person, so the cost is O(n²).
- `vegetation-store.ts:306` `plantsInCell` allocates `number[]`, and `tornadoes.ts:148` chains `.filter`.
- `hasTreeWithin` (`vegetation-store.ts:355`) uses `Math.hypot`, which is not exact across browsers.
- 22 simulation files loop by hand.
- The intrusive per-cell plant lists (`vegetation-store.ts:90-93`) are worth keeping.

## 3. Grid vs trees, measured

Setup:
- Node 24.22.1 (V8, as in Chromium workers) on this Mac.
- 640² cells of 10 m.
- 5,000 agents in 12 camps; 300,000 plants of 28 species.
- Script: `research/bench-scripts/spatial-bench.mts`.

| Operation | Uniform grid | kdbush 4.1 | Other |
|---|---|---|---|
| Rebuild for 5k movers per tick | **22 µs** (40 m buckets, counting sort) | 179 µs | flatbush 155 µs |
| 5k radius-30 m queries | **0.54 ms** | 0.93 ms `withinInto`, 1.59 ms allocating | |
| Build for 300k plants | CSR 2.4 ms | 36 ms | |
| Count one species, r = 30 / 100 / 300 m | linked list 0.67 / 4.4 / 35 µs; **CSR 0.14 / 0.66 / 3.3 µs** | 1.09 / 7.5 / 50 µs | 160 m block counts ≈ 0.02 µs |
| Tornado footprint, r = 60 m (biome histogram + max fire) | 0.4 µs | | |

**Verdict:**
- The island is bounded, dense and fixed in size. A grid aligned to the cell lattice beats both trees on rebuild and on query.
- Per-species block counts are about 1000× faster for "how many oaks within 300 m".
- Cell fields are already O(1) typed-array reads.

## 4. Packages

| Package | Version | Verdict |
|---|---|---|
| `kdbush` | 4.1.0, 2026-05-19 | Added allocation-free `withinInto`. Static and slower than the grid here. |
| `flatbush` | 4.7.0, 2026-10-30 | Added early-exit `collides`. Static rectangles; not needed. Too fresh to adopt. |
| `rbush` | 4.0.1, 2024 | Object-based dynamic R-tree that allocates. Reject. |
| `geokdbush`, `geoflatbush` | | Geographic distance; irrelevant. |
| `@thi.ng/geom-accel` | 4.2.1 | Map/Set API, 12 dependencies. Reject. |
| npm spatial-hash libraries | | Map-based and little used. Reject. |

**Add no dependency.** About 300 lines of our own code (radial pattern, buckets, block counts) are faster, deterministic and fit the code style. Reconsider `kdbush` (about 1.5 kB, transferable buffer) only for main-thread kNN over static data.

## 5. Recommended design

`world/spatial/` holds pure structures and has no simulation imports. `simulation/context/` composes them with fields, weather and stores.

### Structures

```ts
// world/spatial/radial-pattern.ts — sorted by (distanceSquared, dz, dx)
export interface RadialPattern {
  readonly dx: Int8Array;
  readonly dz: Int8Array;
  readonly distanceSquared: Uint16Array;
}
export function createRadialPattern(maxRadiusInCells: number): RadialPattern;

// world/spatial/cell-buckets.ts — CSR for movers; ascending id within a bucket
export interface CellBuckets {
  readonly cellsPerBucket: number;   // 4 → 40 m, 160² buckets
  readonly start: Int32Array;        // bucketCount + 1
  readonly members: Int32Array;
  builtTick: number;
  isDirty: boolean;
}
export function rebuildBuckets(buckets: CellBuckets, x: Float32Array, z: Float32Array, live: Uint8Array, count: number): void;

// world/spatial/block-counts.ts — incremental counts per 16×16-cell block (160 m)
export interface BlockCounts {
  readonly channels: number;
  readonly counts: Uint16Array;      // block * channels + channel
}
export function changeBlockCount(counts: BlockCounts, cell: number, channel: number, change: number): void;
```

Vegetation:
- Keep the intrusive lists, with ascending-id order inside each cell.
- Replace `plantsInCell(): number[]` with `firstPlantInCell`/`nextPlantInCell` loops.
- Keep block channels (each species, and tags such as tree, edible, burning) updated on `add`, `remove`, `burn` and `fell`.

Exact circle counts:
- Blocks fully inside the circle add their counts.
- Blocks on the edge scan their cells.
- `any` stops at the first hit.

### Query API

Plain numbers, a precompiled filter, caller buffers, no closures per call.

```ts
// simulation/context/thing-query.ts
export interface ThingFilter {            // module constants via createThingFilter
  readonly kinds: number;                 // bitmask over THING_KINDS
  readonly tags: number;                  // bitmask over THING_TAGS
  readonly species: Uint8Array | null;    // 1 = allowed; null = any
  readonly tribe: number;                 // -1 = any
}
export interface ThingVisitor {
  visit(kind: ThingKind, id: number, distanceSquared: number): boolean; // false stops
}
export interface ThingReference {
  kind: ThingKind;
  id: number;
}
export interface ThingQuery {
  count(x: number, z: number, radius: number, filter: ThingFilter): number;
  any(x: number, z: number, radius: number, filter: ThingFilter): boolean;
  nearest(x: number, z: number, radius: number, filter: ThingFilter, out: ThingReference): boolean;
  collect(x: number, z: number, radius: number, filter: ThingFilter, out: Int32Array): number;
  visit(x: number, z: number, radius: number, filter: ThingFilter, visitor: ThingVisitor): void;
}
```

### The context reader

```ts
// simulation/context/surroundings.ts
export interface CellReading {            // direct typed-array reads, never cached
  biome(cell: number): number;
  ground(cell: number): number;
  height(cell: number): number;
  slope(cell: number): number;
  water(cell: number): number;
  fire(cell: number): number;
  heat(cell: number): number;
  wetness(cell: number): number;
  snow(cell: number): number;
  fuel(cell: number): number;
}
export interface AreaSummary {            // caller-owned and reused
  readonly biomeShares: Float32Array;
  readonly speciesCounts: Uint16Array;
  readonly tribeCounts: Uint16Array;
  dominantBiome: number;
  waterShare: number;
  maxFire: number;
  meanHeat: number;
  meanSlope: number;
  people: number;
  animals: number;
  buildings: number;
}
export interface Surroundings {
  readonly tick: number;
  readonly season: number;
  readonly windX: number;
  readonly windZ: number;
  readonly weather: WeatherReading;
  readonly cells: CellReading;
  readonly things: ThingQuery;
  summarize(x: number, z: number, radius: number, out: AreaSummary): void;
  fireDistance(cell: number): number;     // derived, lazily rebuilt per tick
}
```

Laziness:
- Indexes carry `builtTick` and `isDirty`. The first query of a tick rebuilds only a dirty index.
- Derived fields use `TickMemo { tick; data: Float32Array }`.
- A `(cell, radius)` summary table, cleared by tick stamp, comes only if profiling demands it.

A tornado then needs three calls:
- `summarize` for the biome, fire, water and counts;
- `things.visit(x, z, r, UPROOTABLE, pushVisitor)` for what it pushes;
- `things.any(x, z, r, BURNING_BUILDING)`.

### Determinism

- Squared distances only.
- `visit` and `collect` go row-major by bucket, ascending id inside each. `nearest` goes in radial order, ties to the lower id.
- Buckets are built at the first query of a tick. The scan range grows by `maxSpeed × tickSeconds`, and the exact test uses live positions.
- Held things are excluded in one place: the `live` mask.

### Memory

| Structure | Size |
|---|---|
| Buckets | 100 KB |
| Block counts, 40 channels | 128 KB |
| Radial pattern, 64-cell radius | about 52 KB |

Indexes are rebuilt on load, never saved.
