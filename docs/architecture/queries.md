# Context queries

`Surroundings` is the one query API. It answers "what is here" around a point or over an area: cells and their
fields and properties, things, tribes and the environment, with a fixed order and no allocation. This file covers
where each part lives, the interfaces, how filters and area queries are declared, what every query guarantees, and the
indexes that thing queries run over. Fields, cell properties and things are defined in
[Cells and things](cells-and-things.md).

## Where queries live

- **Both threads.** The cell side lives in `core/world/queries`: `CellReader`, compiled cell properties, `CellFilter`,
  area query descriptors and the cell part of `measure`. It is written against `WorldReader` plus a list of
  `ThingSource`s.
- **Worker.** The worker adds thing queries over its stores and mover buckets in `simulation/queries`.
- **Main thread.** The main thread gets `MirrorSurroundings`: cells over mirrored fields, and plant and agent tallies
  from the mirror's buffers ([Mirroring](cells-and-things.md#mirroring)).

Mirrored thresholds compare in channel units on both threads, so rendering, audio and the simulation agree at the
edge. Main-thread measures of anything else are approximate by design.

## The interfaces

`core/world/queries/surroundings.ts`:

```ts
export type QueryShape = Disc | Capsule | CellRegion;

export interface Disc {
  readonly kind: "disc";
  radius: number;
  x: number;
  z: number;
}

export interface CellReader {
  readonly catalog: CatalogTables;
  readonly terrain: TerrainReader;
  compiled<Value extends number | boolean>(property: CellProperty<Value>): (cell: number) => Value;
  field(field: FieldDefinition): FieldView;
}

export interface Surroundings {
  readonly cells: CellReader;
  readonly environment: EnvironmentReading;
  readonly things: ThingQuery;
  readonly tribes: TribeQuery;
  cellAt(x: number, z: number): number;
  collectCells(shape: QueryShape, out: CellList): number;
  filter(handle: FilterHandle): PreparedFilter;
  findCell(shape: QueryShape, filter: PreparedCellFilter): number;
  measure(query: PreparedAreaQuery, shape: QueryShape, out: AreaResult): void;
  prepare(handle: AreaQueryHandle): PreparedAreaQuery;
}

export interface AreaResult {
  readonly biomeTally: Float32Array;
  readonly dominantBiome: number;
  readonly waterShare: number;
  field(field: FieldDefinition): FieldMeasure;
  things(filter: FilterHandle): ThingMeasure;
}

export interface FieldMeasure {
  readonly countAbove: number;
  readonly maximum: number;
}

export interface ThingMeasure {
  readonly count: number;
  readonly dominantTribe: number;
  readonly tally: KindTally;
}

export interface CellList {
  readonly cells: Int32Array;
  readonly distancesSquared: Float64Array;
}
```

`simulation/queries/thing-query.ts`:

```ts
export interface ThingQuery {
  collect(shape: QueryShape, filter: PreparedFilter, out: ThingList): number;
  count(shape: QueryShape, filter: PreparedFilter): number;
  hasAny(shape: QueryShape, filter: PreparedFilter): boolean;
  nearest(shape: QueryShape, filter: PreparedFilter, out: ThingReference): boolean;
  nearestOfTribe(shape: QueryShape, filter: PreparedFilter, tribe: number, out: ThingReference): boolean;
  tally(shape: QueryShape, filter: PreparedFilter, out: KindTally): void;
  visit(shape: QueryShape, filter: PreparedFilter, visitor: ThingVisitor): void;
}
```

## Filters and area queries

Filters and area queries are **descriptors**: values declared at module scope and resolved per world in `create`, so
a world with a scenario resolves against its own catalog. A filter is immutable once prepared; the tribe is a query
argument, not part of the filter.

`modules/hazards/tornado/shared/tornado-view.ts`:

```ts
export const PEOPLE = defineFilter({ groups: [ThingGroup.Person] });

export const TREES = defineFilter({ all: [TREE], groups: [ThingGroup.Plant] });

export const TORNADO_VIEW = defineAreaQuery({
  fields: [{ field: FIRE, threshold: 0 }],
  hasBiomes: true,
  hasWater: true,
  things: [
    { filter: TREES, measure: "tally" },
    { filter: PEOPLE, measure: "byTribe" },
  ],
});
```

`measure` pays only for what the query declares. A module's own field (acid, germs) joins a query through its handle.
[The tornado, one tick](walkthroughs.md#the-tornado-one-tick) shows this query in use.

`CellFilter` covers cell tags and field thresholds. `findCell` answers "nearest shore" or "nearest dry spot" in radial
order, without random probes.

## Guarantees

- **Order.** Distances are compared squared. Cells come in radial order `(distanceSquared, dz, dx)` from a precomputed
  pattern. Things come in ascending serial (plants by slot); ties go to the lower `(group, serial)`. The rest of the
  simulation's orders are in [Canonical orders](determinism.md#canonical-orders).
- **No side effects.** A query makes no random draws, allocates nothing and builds no cache. Inspection and picking
  between steps read without building anything, and a test checks that hashes don't change when inspect queries are
  interleaved.
- **Hot paths** use `count`, `hasAny`, `nearest` and `collect`: inline loops per store, chosen by the filter's group
  bits. `visit` is for rare queries and early exit. Scratch lists and visitors belong to a system instance, never a
  module constant, and a debug-only guard throws when a query is re-entered with the same scratch.

## Indexes

Thing queries run over these indexes.

- **Movers** (people and animals) sit in 40 m CSR buckets (compressed sparse rows: one array of movers with a start
  offset per bucket). Buckets are rebuilt at phase boundaries when dirty, never by a query
  ([Steps, ticks and phases](kernel.md#steps-ticks-and-phases)). A rebuild takes about 30 µs for 5,000 movers.
- **Spawned things.** Things spawned since the last refresh sit in a tail list that queries scan linearly.
- **Padding.** Searches pad by the largest step a mover takes in a tick and test live positions.
- **Anchored things** (plants, buildings and features) use their per-cell lists
  ([Things](cells-and-things.md#things-kinds-tags-flags-and-properties)).
- **Block counts** (16×16 cells, 160 m) are added only for a caller that a bench shows over budget. At tornado radii
  (5–140 m, default 45) at most one whole block fits, and only near alignment.
