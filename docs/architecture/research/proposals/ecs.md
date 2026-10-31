# Ashfolk target architecture: the ECS-first proposal

Stance: every discrete thing is an entity with components, cells stay typed-array field layers, and everything,
fire and tribes included, is a Bevy-style plugin. Where the evidence pushes back, the evidence wins:

- **No ECS library.** The ECS research measured 237 B per entity for bitECS against 16 B for hand-written arrays, and
  a 147× slower spawn/despawn. bitECS snapshots also remap ids on load. The proposal uses an in-house ECS of about
  900 lines that copies bitECS 0.4's shape.
- **One table per kind, not archetype moves.** A kind's component set is fixed when the registry is frozen. Optional
  state is a tag bit, not a structural change.
- **No event bus.** Events are pulled, not pushed: typed per-tick queues that systems read at fixed phases. Nothing
  calls a listener.

## 1. Principles

1. **Things are rows, properties are data.** A thing is a slot in its kind's table. Behavior comes from components,
   tags and the catalog properties of its variety, never from `if (isTreeSpecies(...))`.
2. **Cells are fields.** Fire, heat, wetness, snow, lava, gust, germs and the rest are typed arrays with active sets.
   Things and hazards affect each other through fields and events, never through calls to each other.
3. **Ask the place.** Every "what is around here" goes through one `Place` API backed by spatial indices. Nothing
   loops over cells or agents by hand.
4. **A module is one folder.** Its `module.ts` manifest is safe to load on any thread. Its `simulation/`, `engine/`
   and `interface/` sides plug into typed records keyed by `ModuleId`, so `tsc` fails when a line is missing.
5. **Order is a list people read.** Phases are a fixed list. Within a phase, systems run in module-list order. There
   is no topological sort and no glob.
6. **Commands in, frames out.** The simulation is `step(commands)`. Speed, pause and the camera live on the main
   thread.
7. **Deterministic everywhere.** The engine uses exact math, a named random stream per system, a stateless
   `unitHash` for per-cell chance, iteration in ascending order, and ties broken by the lowest id.
8. **Saves describe themselves.** Saves carry a name table for every catalog and store columns and sections by name,
   with defaults. Each world keeps a stored `WorldBase`. There are no per-version remaps.
9. **Layers are compiler projects.** `tsc` enforces imports between layers. dependency-cruiser enforces imports
   between sibling modules.
10. **Zero allocation in a tick.** Queries take caller-owned outputs, visitors are hoisted, and offsets are
    precomputed.

## 2. Target tree

Four layers, plus modules that cut across them. A module only plugs in; it never edits a layer.

```
src/
  core/                       pure TypeScript, both threads, no three/react/zustand
    shared/                   exact-math, hash (lowbias32, unitHash), random streams, cell-set, channel, ignore
    catalog/                  biomes, grounds, species, animals, buildings, technologies, resources;
                              tags, properties, stats, name tables; compose-catalog (data stage, freeze, hash)
    world/                    grid, terrain layers, the water rule, coast, footing, island outline data,
                              hydrology (moved from generation), spatial/ (radial pattern, buckets, block counts),
                              world-reader (one query interface for the worker and the mirror)
    protocol/                 command schemas, frame envelope, presentation events, save envelope, thing ids
  simulation/                 worker only
    kernel/                   things/ (tables, components, tags, queries), fields/, schedule/, events/,
                              commands/, saves/, frames/, random/, hasher/, app-builder
    vocabulary/               shared components (Position, Motion, Body, Health, Exposure, Flammable...),
                              shared fields (fire, heat, wetness, snow, scorch, fuel, molten, gust, soak),
                              shared events (impact, killed, ignited, lost), standard filters
    place/                    the Place API: cell reader, thing query, area summary, environment reading
    generation/               island generation; imports core only
    worker/                   entry, protocol endpoint, simulation-plugins (the composition record)
  engine/                     main thread, no React
    bridge/                   protocol client, session, scheduler (speed, pause, backlog, tick stamps)
    mirror/                   mirror tables per kind, field mirrors, mirror sections, world-reader impl
    kit/                      what modules build on: RenderLayer, ThingPresenter, EffectPresenter, AudioPart
    render/                   renderer, stages, core layers (sky, terrain, water, vegetation, figures, effects)
    models/                   procedural meshes, skeletons, clips, looks keyed by name
    audio/                    context, buses, voices, ambience, music
    input/                    camera, pointer, picking, power and hand tools
  interface/                  React
    design/                   design system, islands, game-icon, settings-group, backdrops
    stores/                   shared Zustand stores: engine, launch, preferences, world, interface, guide
    features/                 HUD panels that never import each other
    pages/                    game and privacy pages
    app/                      shell, providers, launch, contributions (the interface record)
  modules/                    plugins grouped by domain; each module has module.ts + sides
    elements/                 fire, water, weather, surface, embers
    life/                     plants, animals, people, physics (push, float, fall)
    society/                  tribes, jobs, buildings, rivalry, farming, sickness
    powers/                   rain, snow, lightning, tornado, volcano, meteor, earthquake, terraform, acid-rain
    things/                   hand, monuments, crossings, deposits, boat
    modules.ts                MODULES: the only ordered list of manifests
```

A module folder has the same shape everywhere:

```
modules/powers/tornado/
  module.ts            id, power definitions, catalog patches, icon URLs, message ids (UI-safe)
  tornado-path.ts      pure path math shared by both threads (tornadoPositionAt)
  locales/             en.po, ru.po
  simulation/          api.ts (public components, events), tornado-plugin.ts, systems, tests
  engine/              tornado-funnel-layer.ts, tornado-cue.ts, tornado.webm
  interface/           icon.webp, optional inspector entry
```

## 3. Layer rules

| Code | May import |
| --- | --- |
| `core/shared` | nothing in `src` |
| `core/catalog` | `shared` |
| `core/world` | `shared`, `catalog` |
| `core/protocol`, every `module.ts` | `core/*` |
| `simulation/kernel` | `core` |
| `simulation/vocabulary`, `simulation/place` | `kernel`, `core` |
| `simulation/generation` | `core` (never the kernel) |
| `modules/*/*/simulation` | `kernel`, `vocabulary`, `place`, `core`, its own module, other modules' `simulation/api.ts` |
| `simulation/worker` | all of the above |
| `engine/*` | `core`, `engine/kit`, `modules/*/*/engine`, `module.ts` files. Never `simulation` |
| `modules/*/*/engine` | `engine/kit`, `engine/models`, `core`, its own `module.ts` |
| `interface/*` | `core`, the `engine/bridge` handle types, `modules/*/*/interface`, `module.ts` files |
| `modules/*/*/interface` | `interface/design`, `interface/stores`, `core`, its own `module.ts` |
| `features/*` | `design`, `stores`, `core`, `module.ts` files. Never another feature or `app` |

How each rule is enforced:

1. **Composite tsconfig projects:** `core`, `simulation` (which includes `modules/**/simulation`), `engine` (which
   includes `modules/**/engine`) and `interface`. References follow the table. A simulation file that imports
   `engine/` fails `tsc --build`. `core`, `simulation` and `engine` keep `noUncheckedIndexedAccess` off;
   `interface` keeps it on.
2. **Biome `noRestrictedImports`:** bans bare packages (`three` outside engine, `react`/`zustand` outside interface)
   and `noRestrictedGlobals` for DOM globals in `engine/render`. A GritQL `deterministic-engine.grit` plugin, scoped
   to `core`, `simulation` and `modules/**/simulation`, bans `Math.random`, the transcendental functions, `**` and
   `Date.now`.
3. **dependency-cruiser in CI (`bun run boundaries`):** imports between sibling modules go only through
   `simulation/api.ts`, features stay independent, there are no non-type cycles, and nothing reachable from
   `simulation/worker/entry.ts` reaches `three` or `react`.

## 4. Core abstractions

### Kernel, ticks and phases

```ts
export const PHASES = ["input", "weather", "emit", "react", "nature", "life", "settle"] as const;

export type Phase = (typeof PHASES)[number];

export interface SystemOptions {
  readonly every: number;
  readonly spread: boolean;
}

export interface TickContext {
  readonly tick: number;
  readonly seconds: number;
  readonly things: Things;
  readonly fields: Fields;
  readonly place: Place;
  readonly events: Events;
  readonly random: RandomStream;
  readonly resources: Resources;
  readonly tasks: TaskQueue;
}

export type System = (context: TickContext) => void;

export function step(kernel: Kernel, commands: readonly StampedCommand[]): FrameEnvelope {
  applyCommands(kernel, commands);

  for (const phase of PHASES) {
    runPhase(kernel, phase);
  }

  clearExposures(kernel.fields);

  clearEvents(kernel.events);

  kernel.tick += 1;

  return buildFrame(kernel);
}
```

- Each system gets a preallocated `TickContext` whose `random` is the stream named after it.
- `every: 10` runs a system every tenth tick. `spread: true` instead gives it every tick but only the slots where
  `slot % 10 === tick % 10`, which is RimWorld's rare tick.
- `TaskQueue` holds data, `{ dueTick, kind, payload }`, sorted by tick then sequence. Meteors and delayed collapses
  use it, and it is saved.

### Cell fields and cell properties

```ts
export interface FieldDefinition<Id extends string> {
  readonly id: Id;
  readonly type: "f32" | "u8" | "u16";
  readonly lifetime: "persistent" | "exposure";
  readonly save: "dense" | "sparse" | "none";
  readonly frame: "surface" | "texture" | "none";
  readonly tags: readonly FieldTag[];
  readonly hasActiveSet: boolean;
}

export interface Fields {
  value(field: FieldKey, cell: number): number;
  set(field: FieldKey, cell: number, value: number): void;
  add(field: FieldKey, cell: number, amount: number): void;
  scale(field: FieldKey, cell: number, factor: number): void;
  active(field: FieldKey): CellSet;
  tagged(tag: FieldTag): readonly FieldKey[];
}

export const FIRE = defineField({
  frame: "surface",
  hasActiveSet: true,
  id: "fire",
  lifetime: "persistent",
  save: "sparse",
  tags: ["heat-source"],
  type: "f32",
});
```

- Setters clamp, snap values below a threshold to zero, keep the active set and mark frame rows dirty. That replaces
  the 40 raw writes and 25 `mark*` calls found in the coupling research.
- Exposure fields (`gust-x`, `gust-z`, `soak`, `acid`) are stamped in `emit` and cleared at the end of the tick, so
  they are never saved.
- Biome, ground, height, slope, water and temperature are read-only cell properties. Ground and biome rows carry tags
  (`wooded`, `rocky`, `marsh`, `flammable`) compiled to masks. `effectiveBiome` reports `Water` under water and
  `Barren` under molten rock. One meaning of "wooded" replaces the four conflicting groups.

### Things, components, tags and properties

```ts
export type ThingId = number;

export interface ComponentDefinition<Name extends string, Columns extends ColumnSchema> {
  readonly name: Name;
  readonly columns: Columns;
  readonly save: boolean;
  readonly frame: "stream" | "patch" | "none";
}

export const HEALTH = defineComponent("health", { max: "f32", value: "f32" }, { frame: "none", save: true });

export const PERSON = defineThingKind({
  capacity: 2048,
  components: [POSITION, MOTION, BODY, HEALTH, EXPOSURE, FLAMMABLE, TRIBE_MEMBER, NEEDS],
  name: "person",
  order: "creation",
  spatial: "mover",
  tags: ["living", "mobile", "person"],
  traits: { grab: personGrab },
  varieties: null,
});

export interface ThingTable {
  readonly kind: KindIndex;
  readonly live: Uint8Array;
  readonly generation: Uint16Array;
  readonly tags: Uint32Array;
  readonly variety: Uint16Array;
  f32(column: ColumnKey<"f32">): Float32Array;
  i32(column: ColumnKey<"i32">): Int32Array;
  u8(column: ColumnKey<"u8">): Uint8Array;
}

export interface Things {
  table(kind: KindKey): ThingTable;
  spawn(kind: KindKey, variety: number): ThingId;
  despawn(id: ThingId): void;
  handle(id: ThingId): ThingHandle;
  resolve(handle: ThingHandle): ThingId;
  hasTag(id: ThingId, tag: TagKey): boolean;
  setTag(id: ThingId, tag: TagKey, isOn: boolean): void;
  forEach(query: ThingQueryKey, visitor: SlotVisitor): void;
  property(id: ThingId, property: PropertyKey): number;
}
```

- A `ThingId` is `kind << 24 | slot`. A `ThingHandle` is `generation * 2^31 + id`, safe in a `Float64Array`
  relation column. `resolve` returns `-1` for a stale handle, which ends the plot ABA bug.
- `order: "creation"` keeps a dense list sorted by serial, so iteration matches today's `Map` insertion order and
  hashes stay unchanged. `order: "slot"` scans live slots, which is what plants do today.
- Module-defined queries such as `{ all: [POSITION, HEALTH], tags: ["living"], none: ["held"] }` compile at freeze
  time to a list of matching kinds. They iterate kinds in registry order, then slots in each kind's order.
- Properties are Type Objects. Catalog rows (species, animals, buildings) give values by property id. At freeze
  time each kind gets one `Float32Array` per property, indexed by variety. `property(id, WIND_RESISTANCE)` is two
  array reads.
- Stats are properties that modules adjust: `app.modifier(WIND_RESISTANCE, wetRoots)`. `effective(context, stat,
  id, explain)` applies them in list order, and the inspector can show the explanation lines.
- `app.extendKind(PERSON, [SICKNESS])` lets a module add columns to a kind it doesn't own. It is resolved at freeze
  time.

The plant kind keeps today's `VegetationStore` layout: the same columns, the intrusive per-cell list and the free
list. That stays at about 40 B per plant. Rocks and monument pieces become kinds of their own (`rock`,
`monument-piece`), which retires the special cases for them in `clearCell`.

### The context-query API

```ts
export interface Disc {
  x: number;
  z: number;
  radius: number;
}

export interface ThingFilter {
  readonly kinds: Uint32Array;
  readonly all: number;
  readonly none: number;
  readonly varieties: Uint8Array | null;
  readonly tribe: number;
}

export interface ThingVisitor {
  visit(id: ThingId, distanceSquared: number): boolean;
}

export interface ThingHit {
  id: ThingId;
  distanceSquared: number;
}

export interface ThingQuery {
  count(area: Disc, filter: ThingFilter): number;
  any(area: Disc, filter: ThingFilter): boolean;
  nearest(area: Disc, filter: ThingFilter, out: ThingHit): boolean;
  collect(area: Disc, filter: ThingFilter, out: Int32Array): number;
  visit(area: Disc, filter: ThingFilter, visitor: ThingVisitor): void;
  visitCell(cell: number, filter: ThingFilter, visitor: ThingVisitor): void;
  countByVariety(area: Disc, filter: ThingFilter, out: Uint16Array): void;
}

export interface CellSample {
  biome: number;
  ground: number;
  height: number;
  slope: number;
  waterDepth: number;
  temperature: number;
  fire: number;
  heat: number;
  wetness: number;
  snow: number;
  molten: number;
  fuel: number;
}

export interface AreaSummary {
  readonly biomeShares: Float32Array;
  readonly tagCounts: Uint16Array;
  dominantBiome: number;
  waterShare: number;
  maxFire: number;
  meanHeat: number;
  meanSlope: number;
  people: number;
  animals: number;
  buildings: number;
}

export interface Place {
  readonly things: ThingQuery;
  readonly environment: EnvironmentReading;
  sample(cell: number, out: CellSample): void;
  summarize(area: Disc, out: AreaSummary): void;
  hasCellTag(cell: number, tag: CellTagKey): boolean;
  fireDistance(cell: number): number;
}
```

The `Place` API has three index backends:

- **Movers** (`spatial: "mover"`): 40 m CSR buckets, rebuilt by counting sort at the first query of a tick
  (measured at 22 µs for 5k agents).
- **Anchored things** (plants, buildings, monuments, deposits): intrusive per-cell lists, updated on spawn and
  despawn.
- **Aggregates**: `BlockCounts` per 16×16-cell block, one channel per variety and tag, kept current by `spawn`,
  `despawn` and `setTag`. A circle adds whole blocks and scans only its edge blocks.

The same index rules apply everywhere:

- Held and dead things are excluded through the `live` mask in one place.
- Distances are compared squared.
- `nearest` walks the radial pattern, and ties go to the lowest `(kind, order key)`. That reproduces today's
  first-found winners.
- The same `core/world/spatial` code backs the mirror's picking query on the main thread.

### Reactions and rules

```ts
export interface Reaction {
  readonly id: string;
  readonly drivenBy: FieldKey;
  readonly when: (fields: Fields, cell: number) => boolean;
  readonly apply: (context: TickContext, cell: number) => void;
}
```

- **Cell reactions** run in `react` over the active set of their driving field, in list order. Lava meeting water
  is a reaction on `molten`. Soak dousing fire is a reaction on `soak`.
- **Thing responses** are ordinary systems:
  1. `expose` (in `react`) samples each `EXPOSURE` thing's cell into its columns once per tick.
  2. Generic systems read those columns: `burn` (for `FLAMMABLE` things), `push` (gust against mass), `scald`
     (molten and fire against `heatResistance`), and `uproot` (gust against `windResistance` for things tagged
     `uprootable`).

  The three copies of "a thing on a burning cell takes harm" become `scald`.
- **Area harm** is one event, `IMPACT { x, z, radius, harm, cause, fright, dangerSeconds, ignites }`. The `impact`
  system in `life` resolves it against every `HEALTH` thing inside, scaled by properties. That covers all kinds, so
  earthquakes now hurt animals.

### Modules and registries

```ts
export interface SimulationPlugin<Id extends ModuleId> {
  readonly id: Id;
  readonly build: (app: AppBuilder) => void;
}

export interface AppBuilder {
  kind(definition: ThingKindDefinition): KindKey;
  extendKind(kind: KindKey, components: readonly AnyComponent[]): void;
  field(definition: AnyFieldDefinition): FieldKey;
  resource<Value>(key: ResourceKey<Value>, create: (seed: number) => Value): void;
  event<Payload>(key: EventKey<Payload>): void;
  system(phase: Phase, id: string, system: System, options?: SystemOptions): void;
  reaction(reaction: Reaction): void;
  modifier(stat: StatKey, modifier: StatModifier): void;
  command<Payload>(definition: CommandDefinition<Payload>): void;
  power<Id extends PowerId>(id: Id, handler: PowerHandler<Id>): void;
  filter(definition: FilterDefinition): ThingFilter;
  save<Saved>(section: SaveSection<Saved>): void;
  frame<Payload>(section: FrameSection<Payload>): void;
}

export const SIMULATION_PLUGINS = {
  acidRain: acidRainPlugin,
  fire: firePlugin,
  tornado: tornadoPlugin,
} as const satisfies { readonly [Id in ModuleId]: SimulationPlugin<Id> | null };
```

- `build` runs in `MODULES` order, which sets the phase order within each phase. The catalog's data stage (base,
  module patches, scenario, final fixes) runs first and freezes the catalog. The worker and the main thread compute
  the same catalog hash.

### Commands

```ts
export interface StampedCommand {
  readonly tick: number;
  readonly player: number;
  readonly command: SimulationCommand;
}

export interface CommandDefinition<Payload> {
  readonly kind: string;
  readonly schema: z.ZodMiniType<Payload>;
  readonly apply: (context: TickContext, payload: Payload, player: number) => Refusal | null;
}
```

- Powers go through one `usePower { power, x, z, parameters }` and per-tick `strokeStep` samples.
- A refusal becomes a `NOTICE` event carrying a message id. A paused step applies commands without running nature.

### Events

```ts
export interface EventKey<Payload> {
  readonly name: string;
  readonly isPresented: boolean;
  readonly sample: Payload;
}

export interface Events {
  emit<Payload>(key: EventKey<Payload>, payload: Payload): void;
  read<Payload>(key: EventKey<Payload>): readonly Payload[];
}
```

- Payloads sit in a preallocated ring per key. Events are readable by any later phase of the same tick and cleared
  at its end, so a save never holds an event.
- Events marked `isPresented` also go into the frame (merged per 16×16 block) for the renderer, audio and chronicle.
  Lightning teaching fire becomes one `discovery` system reading `FIRE_SEEN`.

### Save sections

```ts
export interface SaveSection<Saved> {
  readonly key: string;
  readonly schema: z.ZodMiniType<Saved>;
  readonly write: (names: NameWriter) => Saved;
  readonly read: (saved: Saved, names: NameReader) => void;
  readonly reset: () => void;
  readonly legacyKeys: readonly string[];
}
```

- Kind tables and fields generate their sections: `things.person` holds count, generations, order, free list, tags
  by name, varieties by name, and columns keyed `component.column`. A missing column takes its default, and an
  unknown one is dropped with a warning.
- `legacyKeys` names today's top-level keys (`society`, `vegetation`) for one frozen reader per key, not per version.

### Frame sections

```ts
export interface FrameSection<Key extends string, Payload> {
  readonly key: Key;
  readonly build: () => Payload | null;
}

export interface MirrorSection<Key extends string, Payload> {
  readonly key: Key;
  readonly apply: (mirror: MirrorWriter, payload: Payload) => void;
}
```

- Kinds stream their `frame: "stream"` columns as one packed `Float32Array` per kind (people, animals, tornadoes,
  boats), or as dirty-slot patches (plants, buildings).
- Fields with `frame: "surface"` go into row runs.
- Custom pairs live in the module folder, with payload types in a shared `frame-types.ts`.

## 5. Walkthrough A: the tornado, one tick

The tornado is a thing kind (`spatial: "mover"`, components `POSITION`, `MOTION`, `FUNNEL`). It is saved
automatically and streamed every frame, so it no longer blocks saving and a late joiner can see it.

```ts
interface TornadoScratch {
  readonly area: Disc;
  readonly core: Disc;
  readonly summary: AreaSummary;
  readonly treeCounts: Uint16Array;
  readonly trees: ThingFilter;
  readonly people: ThingFilter;
  readonly burning: ThingFilter;
}

function rageAll(context: TickContext, scratch: TornadoScratch): void {
  context.things.forEach(TORNADOES, {
    visit: (table, slot) => {
      rage(context, scratch, table, slot);
    },
  });
}

function rage(context: TickContext, scratch: TornadoScratch, table: ThingTable, slot: number): void {
  const { events, fields, place } = context;
  const { area, core, summary } = scratch;

  area.x = table.f32(POSITION.x)[slot];
  area.z = table.f32(POSITION.z)[slot];
  area.radius = table.f32(FUNNEL.radius)[slot];
  core.x = area.x;
  core.z = area.z;
  core.radius = area.radius * CORE_SHARE;

  place.summarize(area, summary);
  place.things.countByVariety(area, scratch.trees, scratch.treeCounts);

  const strength = strengthOver(summary, table.f32(FUNNEL.strength)[slot]);
  const isFireWhirl = summary.maxFire > FIRE_WHIRL_INTENSITY || place.things.any(core, scratch.burning);
  const peopleCaught = place.things.count(area, scratch.people);

  stampSwirl(fields, area, strength * context.seconds);

  if (isFireWhirl) {
    stampHeat(fields, core, FIRE_WHIRL_HEAT * context.seconds);
  }

  table.f32(FUNNEL.strength)[slot] = strength;
  context.things.setTag(table.kind << 24 | slot, FIRE_WHIRL_TAG, isFireWhirl);

  events.emit(IMPACT, {
    cause: TORNADO_CAUSE,
    dangerSeconds: context.seconds,
    fright: area.radius * SCARE_REACH,
    harm: strength * context.seconds,
    ignites: isFireWhirl,
    radius: core.radius,
    x: area.x,
    z: area.z,
  });

  if (peopleCaught > 0) {
    events.emit(TORNADO_STRUCK_CAMP, { people: peopleCaught, x: area.x, z: area.z });
  }
}

function strengthOver(summary: AreaSummary, strength: number): number {
  if (summary.waterShare > WATERSPOUT_SHARE) {
    return strength * WATERSPOUT_GROWTH;
  }

  if (summary.tagCounts[OPEN_BIOME_CHANNEL] > summary.tagCounts[WOODED_BIOME_CHANNEL]) {
    return strength * OPEN_GROUND_GROWTH;
  }

  return strength * FOREST_DRAG;
}
```

The tornado touches nothing directly. Other modules react to what it stamps:

```ts
function uprootByGust(context: TickContext, scratch: UprootScratch): void {
  const { fields, place } = context;

  for (const cell of fields.active(GUST_X).cells) {
    scratch.gust = gustSpeed(fields, cell);
    scratch.cell = cell;

    place.things.visitCell(cell, scratch.uprootable, scratch.visitor);
  }
}

function tryUproot(context: TickContext, scratch: UprootScratch, id: ThingId): boolean {
  const resistance = effective(context, WIND_RESISTANCE, id, null);

  if (unitHash(context.tick, scratch.cell, id, UPROOT_SALT) > scratch.gust / resistance) {
    return true;
  }

  context.events.emit(PLANT_DISTURBED, { cause: GUST_CAUSE, id, toward: scratch.gust });

  return true;
}
```

Who does what in that tick:

- `modules/elements/fire` has the `wind-blows-out-fire` reaction, driven by `gust-x`.
- `modules/life/plants` turns `PLANT_DISTURBED` into fell or remove, according to the species tags `fellable` and
  `uprootable`.
- `modules/life/physics` has `push`, which applies gust divided by `mass` to every `MOTION` thing, so a mammoth no
  longer swirls like a hare.
- `modules/society/buildings` reads gust at occupied cells to blow out a burning hut.
- `impact` harms and frightens everything inside.
- The chronicle reads `TORNADO_STRUCK_CAMP`.

Biome, trees by species, fire and people came from three O(blocks) calls, without allocating.

## 6. Walkthrough B: an "acid rain" power

`module.ts` declares:

- the power, as a brush with `radius` and `strength` parameters, a `cursorRadius`, an icon URL and message ids;
- a catalog patch: the property `acidResistance` (default 0.3), with values by species name (Pine 0.6, Willow 0.1)
  and by ground (Basalt 1).

The simulation plugin declares:

- the exposure field `acid`;
- `app.power("acidRain", stampAcid)`, where a stroke step stamps `acid` and `soak` in a disc;
- the reaction `acid-sears-ground`, driven by `acid`, which lowers `fuel`, adds `scorch`, and changes ground with the
  `fertile` tag to `Barren` once wear passes a threshold;
- the system `acid-withers-plants` (in `life`), which visits plants on active `acid` cells and, through
  `acidResistance`, ages leaves or kills;
- a modifier on `WIND_RESISTANCE` that weakens withered trees;
- `IMPACT` with cause `acid` for living things standing in it.

Fire is put out by the existing `soak` reaction. Death text comes from the cause's message id.

Files:

```
src/modules/powers/acid-rain/module.ts
src/modules/powers/acid-rain/locales/en.po
src/modules/powers/acid-rain/locales/ru.po
src/modules/powers/acid-rain/simulation/api.ts
src/modules/powers/acid-rain/simulation/acid-rain-plugin.ts
src/modules/powers/acid-rain/simulation/acid-reactions.ts
src/modules/powers/acid-rain/simulation/acid-rain-plugin.test.ts
src/modules/powers/acid-rain/engine/acid-rain-layer.ts         precipitation sub-layer tint
src/modules/powers/acid-rain/engine/acid-rain-cue.ts           + acid-rain.webm
src/modules/powers/acid-rain/engine/acid-rain-layer.browser.test.ts
src/modules/powers/acid-rain/interface/icon.webp
src/modules/modules.ts                        + acidRainModule
src/modules/power-order.ts                    + "acidRain"
src/simulation/worker/simulation-plugins.ts   + acidRain
src/engine/session/engine-modules.ts          + acidRain
src/interface/app/contributions.ts            + acidRain: null
```

11 module files and 5 one-line registrations, against 25 non-test files for the volcano today.

## 7. Walkthrough C: a "boat" thing kind (grabbable, floats, burns)

`modules/things/boat/` contains:

- **`module.ts`:** a `spawnBoat` power for testing, the icon and the varieties (`raft`, `canoe`) with properties
  `mass`, `flammability`, `buoyancy` and `heatResistance`.
- **`simulation/boat-plugin.ts`:**

```ts
export const BOAT = defineThingKind({
  capacity: 256,
  components: [POSITION, MOTION, BODY, HEALTH, EXPOSURE, FLAMMABLE, FLOATS],
  name: "boat",
  order: "creation",
  spatial: "mover",
  tags: ["mobile", "wooden", "floating"],
  traits: { grab: boatGrab },
  varieties: BOAT_VARIETIES,
});

const boatGrab: GrabTrait = {
  canLift: (context, id) => {
    return !context.things.hasTag(id, BURNING_TAG);
  },
  canPlace: (context, x, z) => {
    return hasWater(context.place.world, context.place.world.grid.cellAt(x, z));
  },
  lift: ignore,
  place: ignore,
};
```

- **Floating:** a generic `FLOATS` component handled by `modules/life/physics`. It drifts with the water flow and
  `gust`, and runs aground when `hasWater` is false. The boat writes no new system.
- **Burning:** the shared `burn` system, from the `FLAMMABLE` component and `Exposure.fire`. A burning boat adds
  `heat` to its cell, and `soak` or open water put it out through the same reaction.
- **Grabbing:** the `hand` module finds kinds whose `traits.grab` is set. The command schema derives
  `GRABBABLE_KINDS` from the frozen registry.
- **Save and frame:** `things.boat` and the stream come from the kind table.
- **`engine/`:** `boat-model.ts` and `boat-presenter.ts` (extends `InstancedThings`: pick volume, lift pose,
  waterline footing).
- **`interface/`:** an inspector entry and the icon.

Registrations: `MODULES` plus the three side records. `tsc` then asks for the presenter, because
`THING_PRESENTERS` is keyed by every kind that has `frame: "stream"`.

## 8. Walkthrough D: tribe sickness with a journal panel

`modules/society/sickness/` contains:

- **`module.ts`:** strains as catalog rows (routes `contact`/`water`/`marsh`, tags it affects, a curve
  `{ onset, peak, end }`, lethality), the stat `resistance`, message ids, and a journal tab manifest
  `{ id: "sickness", icon, label }`.
- **Simulation:**
  - The `germs` field: `u16`, sparse save, an active set, `frame: "none"`.
  - `app.extendKind(PERSON, [SICKNESS])`, with columns strain, stage, seconds and immunity, plus the tag `sick`.
  - `germs.grow` (`nature`, `every: 10`): random block ticks from `unitHash(seed, tick, block)`. Growth follows
    `wetness`, `heat` and the cell tags `marsh` and `wet`, it decays in sun and snow, and it diffuses to neighbors.
    Inert blocks are skipped.
  - `sickness.catch` (`life`, `spread: true`): it samples germs at the person's cell, runs `place.things.count(disc,
    sickOfTribe)` for contact, and compares against `effective(RESISTANCE)`. Age, hunger, warmth and the herbalism
    technology are modifiers.
  - `sickness.progress`: follows the curve, lowers `HEALTH` and `energy`, emits `KILLED` with cause `sickness`,
    `FELL_ILL` and `RECOVERED`, and makes sick people shed germs into their cell.
  - The tribes module's decisions read the `sick` tag to rest people, through `sickness/simulation/api.ts`.
  - A frame section `sickness`: per tribe, counts by stage and strain and the trend over the last 10 days, built
    only when it changes.
- **Engine:** a `MirrorSection` that writes the per-tribe summary into the mirror. Figures get a pale tint hook
  through `PersonLook` modifiers.
- **Interface:** `sickness-store.ts` (fed from the mirror section), `sickness-tab.tsx` built from `design` islands,
  and `journalTabs: [{ id: "sickness", Content: SicknessTab }]` in the module's interface record. `JOURNAL_TABS` and
  the `JournalTab` union derive from contributions, so the journal shell doesn't change.

## 9. Determinism, replays, lockstep and saves

**Inputs.**
- The worker exposes only `step(commands)`.
- The bridge scheduler on the main thread stamps commands with ticks and owns speed, pause, the backlog and the
  40-tick cap.
- Lightning chooses its site from `unitHash` over block summaries, not the camera.
- Strokes are per-tick samples. Meteors are tasks. Water filling counts ticks.

**Math.** The GritQL ban applies, and `core/shared/exact-math.ts` holds fdlibm ports pinned by golden tests. The 151
`hypot` calls become `Math.sqrt(dx*dx+dz*dz)` by codemod.

**Randomness.**
- Each system gets its own stream, `stream(worldSeed, systemId)`, seeded through lowbias32 with no parent draws.
- Per-cell and per-thing chance uses stateless `unitHash(seed, tick, a, b)`.
- `randomStreams` are saved by name, and a missing stream is re-derived from the seed.
- Visual-only draws use an unhashed `effects` stream.

**Order.** Phases, then plugins, then systems; kinds in registry order, slots in each kind's order; a LIFO free list
saved verbatim; events in emission order; ties to the lowest `(kind, order key)`.

**Hashes.**
- `kernel/hasher` digests every tick: the tick, the RNG states, the live counts and serials of each kind, and the
  active set sizes.
- Every 10 ticks it adds each table's columns and each persistent field, cached per 64×64 chunk and refreshed from
  dirty chunks.
- Section digests localize a desync. NaN is normalized.

**Replays.** A replay is a start save, the command log and the root hashes per turn. A property test checks that
"save, load, run N" equals "run N".

**Lockstep.**
- Turns are 2 ticks, with commands scheduled two turns ahead.
- A Durable Object relay orders the commands. The socket lives inside the worker.
- The handshake compares the build id, the catalog hash and the module list.

**Saves.**
- One envelope: `{ format, names, base: { id, hash }, sections }`.
- `names` covers every catalog saved by index (grounds, biomes, species, plant states, crops, technologies,
  buildings, tags, causes), and each catalog declares a policy for unknown names (`fallback` or `drop`). A rename
  goes in a `formerNames` list on the definition itself. This retires `OLDER_SAVE_PLANT_SPECIES`.
- Sections use `z.looseObject` with defaults. A section that fails resets with a notice instead of failing the
  load.

**Independence from generator changes.**
- At creation, a `WorldBase` (all 12 terrain layers, water, springs, crossings, monuments, deposits) is stored once,
  compressed, in its own IndexedDB store.
- Saves diff against the base, so changes to the generator (terrain realism v2, stream fixes) never touch existing
  worlds.
- Old saves regenerate and compare the fingerprint once, then attach a base.
- The chronicle saves message ids and parameters.

## 10. Worker bridge and frame protocol

- **Comlink goes**, replaced by `core/protocol` plus about 150 lines in `engine/bridge` and `simulation/worker`:
  - `ToWorker`: `create`, `load`, `save`, `advance { realSeconds, commands }`, `dispose`.
  - `ToMain`: `progress`, `world`, `frame`, `saved`, `failed`.
  - Requests carry integer ids. Only commands are validated (`zod/mini`), because under lockstep they arrive from
    peers.
- **Frame:** `{ tick, stateHash, things: { [kind]: Stream | Patch }, fields: RowRuns, sections: Partial<{ [Key in
  SectionKey]: PayloadOf<Key> }>, presented: PresentationEvent[] }`. The type is derived from the registries, not
  from declaration merging.
- **Transfers** are collected by `buffersWithin(frame)`. A development check fails when a transferred buffer belongs
  to a live table.
- **The mirror** is an ECS read model: one `MirrorTable` per kind with the same column names. That gives the
  renderer, picking, audio and labels one main-thread `ThingQuery`, and picking stops depending on
  `vegetation-chunks`.
- **SharedArrayBuffer and OffscreenCanvas:** neither now; COOP/COEP would cost Whop embeds, sign-in popups and
  portal embeds.

## 11. Rendering, models and audio extension points

`engine/kit` defines what modules build on:

- **`RenderLayer`:** `{ object, changed(changes), update(renderFrame), dispose }`, created from `RenderServices`. The
  services are textures, patch levels, plant weather, height sampling and shake. Each layer is placed in one of the
  fixed stages `sky, ground, water, cover, figures, overlays, effects`, and keeps today's order constraints:
  atmosphere before vegetation, water after the terrain patch levels. A browser test pins the order.
- **`TerrainLayer` and `WaterLayer`:** own their data texture and add a `look(ground, coordinates)` node. Lava
  becomes a terrain layer. Every layer still respects the patch step and the island outline.
- **`ThingPresenter<Kind>`:** layer, pick candidates, hover and selection rings, spot, heading, footing and lift
  pose. Two generic bases do the shared work:
  - `SkinnedFigures<Visual>`: palette, LOD, frustum, marker and hand pose. People and animals stop duplicating it.
  - `InstancedThings`: boats, rocks, monuments.
- **`EffectPresenter<Kind>`:** `{ clock, look, cue }` keyed by presented event kind. One channel feeds the renderer
  and audio, which replaces the two switches.
- **Models:** looks keyed by name (`PLANT_LOOKS`, `ANIMAL_LOOKS`); a module contributes looks for its own species.
- **Audio:** `AudioPart` (`hearFrame`, `hearPresented`, `hearCommand`) and `EmitterSource`. Cues live next to their
  owner, and the catalog is generated from the module's sound files, so an orphan fails knip.

## 12. Interface: pages, features, stores and design

- `interface/stores` holds every store used by more than one feature: engine, launch, preferences, world, interface,
  guide. This removes the features→app edges and the feature cycles (rules R2 and R3 in the boundaries research).
- Features never import each other. Shells compose leaf panels through contributions, not imports:
  - `journalTabs`, `settingsSections` and `inspectors`, keyed by kind;
  - `menuButtons`, rendered by both menus;
  - `bridges`, of type `(engine) => () => void`.
- `pages/` holds the game and privacy pages. The privacy page becomes TSX, which drops react-markdown.
- Design system: islands, `GameIcon(IconSource)` and `settings-group` move into `design`. Records carry `icon`
  fields, which retires the eight icon maps.
- Strings: Lingui with per-module catalogs. The worker sends `{ id, values }` descriptors, so saved journals can be
  translated.

## 13. Packages

| Action | Package | Reason |
| --- | --- | --- |
| Add (runtime) | `@lingui/core`, `@lingui/react` | Message descriptors cross the worker and go into saves; catalogs per module; ICU plurals for Russian; runtime catalogs for mods |
| Add (dev) | `@lingui/cli`, `@lingui/vite-plugin`, `@lingui/babel-plugin-lingui-macro` | Extract and check |
| Add (dev) | `fast-check` | Property tests: replay equality, save round trips, catalog reordering, the water rule |
| Add (dev) | `ts-morph` | Scripted, repeatable file moves (bundles its own TS 6, works beside TS 7) |
| Add (dev, at step 2) | `dependency-cruiser` + `@swc/core` | Sibling-module and worker-reachability rules |
| Optional | `idb` | Wrappers for the base and save stores |
| Remove | `comlink` | Stale; lockstep needs messages, not RPC |
| Remove | `react-markdown`, `remark-gfm` | 100 packages and a 50 kB gzip chunk for one page |
| Keep, change | `zod` → `zod/mini` | About 37 kB gzip less; `looseObject` and `codec` remain |
| Keep | `pure-rand`, `simplex-noise`, `three`, `zustand`, `@base-ui/react`, `tailwind-merge`, `clsx`, `vite-plugin-pwa`, `lucide-react` | Fit and maintained, or finished |
| Rejected | bitECS, Koota, Miniplex, Becsy | Memory and churn cost on 500k plants; id-remapping snapshots; untyped components push toward `as`; one maintainer each |
| Rejected | kdbush, flatbush, rbush | The cell-aligned grid is faster and deterministic |
| Rejected | Nx, Turborepo, Bun workspaces | A module spans threads, so per-package modules would split it |

Against the stance: a forced library would be bitECS 0.4, minus its entity index and serializer, leaving only the
query cache, which is the easy part.

## 14. Migration

Each step is a group of pull requests that each merge green. "Hash" means the golden digest for seeds 3, 7 and 11
over 600 scripted ticks.

| # | Step | Size | Verification | Hash and saves |
| --- | --- | --- | --- | --- |
| 0 | Guardrails: golden digests, a corpus of save fixtures from v0.8–0.10, a dependency-cruiser baseline, bench project | S, 3 PRs | the new tests themselves | none |
| 1 | Saves first: name tables for every catalog, `formerNames`, looseObject sections with defaults, `WorldBase` store, legacy readers | M, 4 PRs | fixture corpus loads; fast-check catalog reordering | format grows; old saves load |
| 2 | Layer moves with ts-morph: `core`, `simulation`, `engine`, `interface`; protocol extracted; hydrology to `core/world`; R1–R5 fixed; composite projects | L but mechanical, 6 PRs, one per layer | typecheck, knip, boundaries | none |
| 3 | Bridge: protocol replaces Comlink; scheduler on the main thread; ticks on commands; tasks and strokes as data; `snapshot()` never null | M, 3 PRs | replay test | changes only stroke and meteor scenarios |
| 4 | Kernel: phases, `AppBuilder`, one adapter plugin per current system in today's order; `Simulation` shrinks to the kernel | M, 4 PRs | golden digest identical | none |
| 5 | Fields: `Fields` setters replace raw writes; field save sections | M, 5 PRs (one per field family) | digest identical | none |
| 6 | Things: tables and components. Hazards first (tornado, ember, arrow, volcano, meteor as kinds), then buildings, animals, people (`order: "creation"`), then plants (same layout), rocks and monument pieces split out | L, 10 PRs | digest identical per PR except the split | the split uses a legacy `vegetation` reader |
| 7 | Place: buckets, block counts, radial pattern; port the 18 linear scans and 17 disc loops | M, 6 PRs by domain | digest identical (ties match first-found); bench budgets | none |
| 8 | Unification: events, `IMPACT`, `expose`/`burn`/`scald`/`push`/`uproot`, reactions; powers rewritten as modules | L, about 12 PRs, one per power or hazard | behavior tests per power; screenshots via `bun run shots` | hash changes; one digest bump per PR, noted |
| 9 | Engine kit: stages, presenters, mirror tables, audio parts; cues move next to their owners | L, 8 PRs | browser order test; screenshots at three sizes and a far view | none |
| 10 | Determinism batch: exact math, named streams, integer hashes, lightning off the camera, colliding generation seeds | M, 2 PRs | cross-engine CI (Chromium, Firefox, WebKit, Bun) | one fingerprint bump; `WorldBase` protects saves |
| 11 | Interface: stores layer, contributions, Lingui, `zod/mini`, privacy page as TSX | M, 6 PRs | browser tests; bundle size | none |
| 12 | Lockstep groundwork: section hashes, replay files, desync dumps | M | two workers in lockstep in a test | none |

**Moved versus rewritten.**
- Moved: generation, world, models, rendering views, design, most features, content (into the catalog).
- Rewritten:
  - the simulation core: `simulation.ts`, `frame-builder`, `frame-packing`, `saved-world`, `PowerServices`;
  - the powers and the hand;
  - the query sites;
  - the worker API;
  - `WorldRenderer` composition and the effect switches;
  - audio wiring.

**Parallel lanes.** Steps 0–4 are serial. After step 4, six lanes run in parallel, each touching only its own
modules plus one registry line, so conflicts are limited to adjacent sorted keys:

- elements
- life
- society
- powers
- engine (step 9)
- interface (step 11)

Each lane works in its own worktree. Hash-changing PRs go one at a time through a "digest bump" label.

## 15. Risks and open questions

**Risks.**
- **Plants as a generic kind.** This risks losing today's 40 B per plant. Gate it with a bench: the table must
  match `VegetationStore` memory and spawn cost within 10%, or plants keep a specialized table behind the same
  interface.
- **Visitor callbacks may turn megamorphic** in hot loops. Hoist visitors, and give `forEach` typed fast paths for a
  single kind.
- **`extendKind` columns** cost memory on every slot. That is fine for people (about 2k slots), but not for plants.
  There, add a sparse component variant backed by a `Map` from slot, iterated in sorted order.
- **Plugin-order conflicts at 30–100 PRs a day** are real conflicts about meaning and should stop the merge.
- **The step-8 behavior changes** (for example, earthquakes hurting animals) need design sign-off per power.

**Open questions.**
- Are tribes things (a `tribe` kind with camp position), or a resource? This proposal leans toward a kind, so rival
  gods become a `player` column.
- Should mods ship code, or only data and reactions?
- How large is a compressed `WorldBase` at 768²?
- Does the 10-tick full hash fit at speed 16 on phones?
