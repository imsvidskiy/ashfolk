# Architecture plan

This plan rewrites Ashfolk's structure so that a power, hazard, thing kind, tribe system or page is one folder plus a
few typed registry lines, so that every thing and every cell exposes declared properties, and so that any system can
ask "what is around here" through one typed, fast, deterministic API. It keeps the rules in
[AGENTS.md](../AGENTS.md#rules-that-are-easy-to-miss): the engine never imports React, the simulation never imports
rendering, generation and the simulation are deterministic for a seed, commands are validated at the worker boundary,
saves keep loading, and large stores stay in typed arrays.

It replaces the previous plan. It was chosen from three competing designs (data-oriented evolution, ECS-first, and
workspace packages), each attacked by five critics on determinism, performance, extensibility, migration and
simplicity, and checked against `main` at v0.10.0. [Why this design](#why-this-design) says what was taken from each.

## Contents

- [Goals](#goals)
- [Why this design](#why-this-design)
- [Principles](#principles)
- [Target structure](#target-structure)
- [Core model](#core-model)
- [Walkthroughs](#walkthroughs)
- [Determinism, replays, lockstep and saves](#determinism-replays-lockstep-and-saves)
- [Worker bridge and frames](#worker-bridge-and-frames)
- [Engine side](#engine-side)
- [Interface](#interface)
- [Packages](#packages)
- [Migration](#migration)
- [Checklists](#checklists)
- [What we deliberately don't do](#what-we-deliberately-dont-do)
- [Risks and open decisions](#risks-and-open-decisions)
- [Sources](#sources)

## Goals

Each goal answers one of the owner's asks and names the test that shows it is met.

| Ask | Goal | Done when |
| --- | --- | --- |
| Modular | A power, hazard, thing kind, tribe system or page is one folder plus typed registration lines. Core files never name a module. | The four [walkthroughs](#walkthroughs) hold with the core-edit counts they state; a test boots every module and fails on an unregistered handle. |
| Properties everywhere | Cells expose fields and derived properties; things expose kinds, tags, flags, numeric properties and traits. Effects go through cells, `strike` and events, never per-pair calls. | No `fire.douse`, `buildings.blowOut`, `damageArea` or `isTreeSpecies` call outside their owners; one test per rule. |
| Context queries | One `Surroundings` API answers cell reads, area measures and thing queries, in the worker and on the main thread, with a fixed tie order and no allocation. | The tornado reads biome, trees by species, fire and people in one tick for under 25 µs at radius 140 m (bench). |
| Not flat and huge | Four layers plus modules, each with a few sublayers, at most four folders deep under `src/`. | The tree below; a boundaries check that fails on a wrong import. |
| Packages | Drop what earns nothing, add only what removes work. | Comlink, react-markdown and remark-gfm gone; `zod/mini`; no new runtime dependency. |
| Deep rewrite | The kernel, saves, frames, queries, rules and composition are rewritten; leaf code moves once by script. | Main deploys green through every step; saves from 0.10 load at every step. |

## Why this design

The base is the data-oriented evolution. It scored highest (mean 5.2, against 5.0 for ECS-first and 4.8 for
packages), and it was the strongest on determinism and saves. Its weakest lenses were migration (4) and simplicity
(5), so most grafts fix those.

| Taken from | What |
| --- | --- |
| Evolve | Typed-array fields with active sets; the SoA `VegetationStore`; four layers plus modules; the field / cell property / exposure split; `Surroundings` with a fixed tie order; `strike`; save and frame sections; name tables with `formerNames`; `WorldBase`; exact math; commands only; a typed event queue. |
| ECS-first | One thing-kind table compiled from the catalog with per-kind property arrays; the generational slot for plants; event-driven thing responses; the kind manifest that both threads read; the rule that state is either saved or derived. |
| Packages | A throwaway spike before risky moves; one ordered list of systems pinned by a test; module-owned standard events in the catalog; generic events with a `cause`; the worker-closure check; fields and exposures merged into one concept. |
| Critics | Canonical iteration orders; a logical save schema behind one frozen legacy reader; lossless `WorldBase`; batch reaction kernels; no dense drivers; numeric bench gates; typed handles instead of closed name unions; an assembly layer; facades before storage changes; each file moves once; turns in wall time; a step counter apart from game time. |

Rejected: workspace packages (the package graph adds about 90 tsconfigs and a lockfile edit per module, and buys
nothing that composite projects and a boundaries check don't), a generic column store for people and animals (a
rewrite of the busiest folder with no measured need), and closures per cell in the reaction pass (5–8× slower than a
direct loop, measured).

## Principles

1. **Four layers and modules.** `core` below `simulation` and `engine`, `interface` on top. A module cuts across
   them with one folder per side. Imports only go down, and sublayers only import lower sublayers.
2. **Data in typed arrays, behavior in systems, meaning in the catalog.** A kind is a row with tags and numbers. Code
   reads properties and tags, never lists of kinds.
3. **Three ways for things to affect each other, and only three.**
   - **Cells:** emitters write fields; reactions turn fields into fields; things respond to the cells they stand on.
   - **`strike`:** force and harm on the things in an area, scaled by their properties.
   - **Events:** facts for the chronicle, effects, sounds and other modules' listeners. An event is never a request.
4. **Handles, not name unions.** Fields, properties, tags, flags, events, death causes, columns and stats are created
   by their owner with a `define*` call and imported from it. Core declares only the handle types.
5. **One way to ask "what is here".** `Surroundings`, with a fixed order, no random draws and no allocation.
6. **Commands in, frames out.** The simulation takes stamped commands. Real time lives in the scheduler only.
7. **Every engine gives the same result.** Exact math, order-free hashes, named streams, canonical iteration orders.
8. **State is saved or derived.** Every structure says which. Derived means a pure function of saved state, rebuilt
   at fixed points. Saves describe themselves: name tables, defaults, no per-version remaps.
9. **Explicit, typed lists.** No globs, no declaration merging, no topological sort. Order lives in lists people read,
   and tests pin it.
10. **Facades first, storage later.** A new interface lands over today's stores without changing hashes. Storage and
    behavior change in labeled PRs.

## Target structure

### The tree

```
src/
  core/                          pure TypeScript for both threads; no DOM, three, React or zustand
    foundation/                  exact-math, hash, random streams, noise, cell-set, bitset, channel, buffers, ignore
    catalog/                     handles (define-field, define-tag…), land/ (biomes, grounds), life/ (species,
                                 animals, buildings), society/ (technologies, eras, resources), name tables
    world/                       terrain/ (grid, sampling, footing, coast, outline), water/ (hasWater, brooks,
                                 crossings, hydrology moved from generation), spatial/ (radial pattern, buckets),
                                 vegetation-store.ts, world-reader.ts
    protocol/                    commands, bridge messages, frame and save envelopes, codecs, effect payloads
  assembly/                      MODULES, compiled CATALOG, POWER_ORDER, the event and frame key unions
  simulation/                    worker only, deterministic
    kernel/                      clock, steps, phases, scheduler, event queue, sections, hasher, streams
    state/                       cells/ (field store, properties), things/ (sources, transients, kinds, flags,
                                 columns), tribes/
    queries/                     surroundings, filters, area queries, mover buckets
    rules/                       reaction pass, strike, trait responses
    api/                         ModuleContext, SimulationModule, ModuleRuntime: all a module side sees
    generation/                  generateWorld and its stages
    nature/                      calendar, weather, wind, fire, embers, surface, water settling, growth
    life/                        movement, navigation, crowding, fauna, society, rivalry, hand, chronicle
    runtime/                     composition, core and module lists, tick source, worker entry
  engine/                        main thread, no React
    bridge/                      protocol client, session
    mirror/                      WorldMirror (a WorldReader), mirror sections
    models/                      mesh/, plants/, animals/, people/, structures/
    render/                      base/ (renderer, stages, node helpers), layers/, presenters/
    audio/                       engine, buses, voices, ambience, parts, generated sound catalog
    input/                       camera, pointer, picking, tools
  interface/                     React; noUncheckedIndexedAccess on
    design/                      primitives, islands, game-icon, settings-group, backdrops
    stores/                      every store more than one panel reads
    panels/                      dock, journal, inspector, minimap, settings, tribes, time, notices…
    pages/                       game, privacy, pages.ts
    app/                         shell, launcher, HUD layouts
  modules/
    tornado/                     module.ts, shared/, simulation/, engine/, interface/
    volcano/  rain/  snow/  lightning/  meteor/  earthquake/  terraform/  forest/  wildlife/
```

A module folder holds only the sides it has:

```
modules/tornado/
  module.ts            manifest: id, sides, requires, powers, catalog rows, death causes, icon URL, message ids
  messages.ts          { en, ru } message tables
  shared/              tornado-path.ts (pure, both threads), tornado-frame.ts (payload type)
  simulation/          tornado-system.ts, tornado-power.ts, tornado-simulation.ts, tests
  engine/              tornado-funnel-layer.ts, tornado-cue.ts, tornado.webm, tornado-engine.ts
```

**Core or module.** Core is what everything reacts to or acts on and cannot be removed: calendar, weather, wind,
fire, embers, surface (wetness, snow, scorch), water settling, vegetation growth and succession, movement and
navigation, crowding, fauna, society (tribes, jobs, farming, construction), rivalry, the hand and the chronicle. A
module is anything you can delete without breaking a core rule: every power, hazard and spawn, and later sickness,
trade, beliefs, boats and bridges. Natural lightning stays in core weather and emits `lightningStruck`; the lightning
power module calls the same `strikeLightning` through `ModuleContext`. Rivalry may become a module once tribe
extension points exist; that is an [open decision](#risks-and-open-decisions). A data-only species stays a catalog row.

Names mean one thing each: `core` is only the top layer, `land` (not `terrain`) is the catalog folder, render
infrastructure is `render/base`.

### Layers

| Code | May import |
| --- | --- |
| `core/foundation` | nothing in `src` |
| `core/catalog` | `foundation` |
| `core/world` | `foundation`, `catalog` |
| `core/protocol` | `foundation`, `catalog`, `world` types |
| `modules/*/module.ts`, `modules/*/shared` | `core`, the `shared/` of modules it `requires` |
| `assembly` | `core`, every `module.ts` and `shared/` |
| `simulation/kernel` → `state` → `queries` → `rules` → `api` | lower sublayers, `core`, `assembly` |
| `simulation/generation` | `core` |
| `simulation/nature`, `simulation/life` | `api` and below, `generation` (only `world-generator` for repopulating) |
| `modules/*/simulation` | `simulation/api` and below, own `module.ts` and `shared/`, required modules' `shared/` |
| `simulation/runtime` | all of `simulation`, every `modules/*/simulation` |
| `engine/bridge` → `mirror` → `models` → `render`, `audio` → `input` | lower sublayers, `core`, `assembly` |
| `modules/*/engine` | `engine/{mirror,models,render,audio}`, own manifest and `shared/` |
| `interface/design` → `stores` → `panels` → `pages` → `app` | lower sublayers, `core`, `assembly`, `engine/bridge` handle types, `engine/mirror` readers |
| `modules/*/interface` | `interface/{design,stores}`, own manifest |

Panels never import panels. Systems in `nature` and `life` may import each other only through files named
`*-api.ts`; there are 46 cross-folder imports between them today, many for `Waypoint`, which moves to `core/world`.

### How it is enforced

1. **Composite tsconfig projects**, one per layer: `core` (with `assembly`, `module.ts` and `shared/`), `simulation`
   (with `modules/*/simulation`), `engine` (with `modules/*/engine`) and `interface` (with `modules/*/interface`), plus
   `tests` for test files and `testing/` helpers, which references all four. References follow the table, and TS6202
   rejects a cycle. `core`, `simulation` and `engine` keep `noUncheckedIndexedAccess` off; `interface` keeps it on.
2. **`bun run boundaries`**, a Bun script of about 150 lines. Every import in `src` is relative (there are no aliases),
   so `Bun.Transpiler.scanImports` plus path resolution gives the full graph, `new URL(…, import.meta.url)` included.
   It checks the layer table, `requires` between modules, panels apart, `*-api.ts` between systems, and that nothing
   reachable from the worker entry reaches `three`, `react` or `zustand`. It runs in CI and in pre-push. It starts in
   report mode with today's offenders listed.
3. **Biome.** `noRestrictedImports` bans bare packages per side, for editor feedback. `noRestrictedGlobals` keeps DOM
   globals out of `engine/render`. A GritQL plugin, `deterministic.grit`, scoped to `core/{foundation,catalog,world}`,
   `simulation/**`, `modules/*/{module.ts,shared,simulation}` and `assembly`, allows only `Math.abs`, `ceil`, `floor`,
   `round`, `trunc`, `sign`, `min`, `max`, `sqrt`, `fround`, `imul` and `clz32`, and bans `**`, `Math.random`, `Date`,
   `performance`, timers, `Intl` and `toLocale*`. The boundaries script also scans every file reachable from the worker
   entry for the same list, so a shared file outside those folders can't slip through.
4. **Tests** for what types can't see: every registered handle is resolved (`modules.test.ts` boots every module), the
   system order fingerprint, frame and mirror keys match, save section keys are unique, sound files are all referenced.

## Core model

### Kernel: steps, ticks and phases

The clock has two counters. `step` advances on every simulation step, paused or not. `tick` is game time and
advances only when the world runs. Commands and hashes are keyed by step; nature runs on ticks.

```ts
export const PHASES = ["intake", "weather", "emit", "react", "nature", "life", "settle"] as const;

export type Phase = (typeof PHASES)[number];

export interface Tick {
  readonly day: number;
  readonly index: number;
  readonly seconds: number;
  readonly step: number;
}

export interface System {
  readonly cadence?: number;
  readonly id: string;
  readonly phase: Phase;
  readonly step: (tick: Tick) => void;
}

export function runStep(kernel: Kernel, commands: readonly StampedCommand[]): void {
  const { clock, events, indexes, phases } = kernel;

  applyCommands(kernel, commands);
  runStepTasks(kernel, clock.step);

  if (clock.isPaused) {
    clock.step += 1;

    return;
  }

  for (const phase of PHASES) {
    indexes.refresh(clock.tick);

    for (const system of phases[phase]) {
      if (isDue(system, clock.tick)) {
        system.step(clock.current);
      }
    }
  }

  events.drain(clock.current);
  clock.advance();
}
```

- **Order.** Within a phase: core systems in `CORE_SYSTEMS` order, then module systems in `MODULES` order, then
  registration order. `system-order.test.ts` prints the whole order and fails on any change; a change is a
  hash change and is labeled. A pair that must run in opposite orders in two phases is pinned in `phase-pins.ts`.
- **Cadence.** `cadence: 50` runs a system every 50th tick, offset by a hash of its id, so cadenced systems don't all
  land on one tick. Heavy tasks (hydrology, navigation rebuilds) run as resumable slices with a budget in work units,
  never wall time.
- **Pause.** A paused step applies commands and step tasks (strokes, water settling) but runs no phase. Brushes and
  the hand work while paused, and replays stay exact.
- **No context bag.** Systems close over the `ModuleContext` they got at creation. `step` receives only `Tick`.
- **Indexes** are refreshed at each phase boundary when dirty, never by a query.

### Cell fields and cell properties

A **field** is stored per cell. With `lifetime: "persistent"` it is saved; with `lifetime: "tick"` (an exposure:
gust, soak, blast) it is cleared at `settle` and never saved. A **cell property** is derived on read and never saved.

```ts
export interface FieldDefinition<Name extends string = string, Storage extends FieldStorage = FieldStorage> {
  readonly decayPerDay: number;
  readonly floor: number;
  readonly formerNames: readonly string[];
  readonly layout: "dense" | "sparse" | "tiled";
  readonly lifetime: "persistent" | "tick";
  readonly maximum: number;
  readonly mirror: MirrorChannel | null;
  readonly name: Name;
  readonly rest: FieldRest;
  readonly storage: Storage;
  readonly tags: readonly CellTagDefinition[];
}

export type FieldStorage = "f32" | "u16" | "u8";

export type FieldRest = { readonly kind: "constant"; readonly value: number } | { readonly kind: "base"; readonly value: (world: WorldReader, cell: number) => number };

export function defineField<const Name extends string, const Storage extends FieldStorage>(definition: FieldDefinition<Name, Storage>): FieldDefinition<Name, Storage> {
  return definition;
}

export const FIRE = defineField({
  decayPerDay: 0,
  floor: 0,
  formerNames: [],
  layout: "sparse",
  lifetime: "persistent",
  maximum: 1,
  mirror: { channel: "fire", encode: "byte" },
  name: "fire",
  rest: { kind: "constant", value: 0 },
  storage: "f32",
  tags: [HEAT_SOURCE],
});
```

- **Storage.** `dense` fields (wetness, snow) are full arrays tracked by 32-cell segment bitsets. `sparse` fields
  (fire, heat, lava, germs) carry an active set. `tiled` fields allocate 64×64 tiles on first write (acid, a module's
  rare field). Exposures are sparse stamps cleared through a touched list, never with `fill`.
- **`rest`** is the value a cell returns to and the value an old save without the field loads at. Fuel's rest comes
  from the ground (`kind: "base"`), as `sparseDifference(fuel, groundFuel(...))` does today.
- **Floors** are applied in the field's own decay pass, never in `add` or `set`, so weak contributions from several
  sources still add up (fire's `HEAT_FLOOR` works this way today).
- **Two write tiers.** The owning kernel (fire spread, the surface sweep, growth) takes raw arrays once at creation
  and calls `markRows` or `markChunk` in bulk; it keeps today's bit tricks. Everyone else writes through one concrete
  `FieldWriter` class with the policy as data, so call sites stay monomorphic.
- **Dirty chunks.** Every write path sets a bit per 64×64 chunk. The hasher, the frame builder and the base diff each
  keep their own copy of the bits and clear only their own. A debug verifier compares incremental digests with full
  ones.
- **Mirroring** is opt-in. A field with `mirror` gets a byte channel in a shared RGBA8 cell-state page that feeds both
  the frame diff and the GPU textures. Unmirrored fields never leave the worker.

```ts
export interface FieldView {
  readonly definition: FieldDefinition;
  at(cell: number): number;
}

export interface FieldWriter extends FieldView {
  add(cell: number, amount: number): void;
  scale(cell: number, factor: number): void;
  set(cell: number, value: number): void;
}

export interface FieldKernel {
  readonly values: Float32Array;
  activate(cell: number): void;
  markChunk(cell: number): void;
  markRows(firstRow: number, lastRow: number): void;
}
```

**Cell properties** are a base plus ordered contributions from modules, applied in `MODULES` order; the first
contribution whose `when` holds wins. A test pins the contribution order.

```ts
export const EFFECTIVE_BIOME = defineCellProperty({
  base: (cells, cell) => {
    if (cells.property(HAS_WATER, cell)) {
      return Biome.Water;
    }

    return cells.terrain.biome[cell];
  },
  name: "biome",
});

export const LAVA_BIOME = contributeToCellProperty(EFFECTIVE_BIOME, {
  id: "volcano.lava-biome",
  value: () => {
    return LAVA_FIELDS_BIOME.index;
  },
  when: (cells, cell) => {
    return cells.field(LAVA).at(cell) > 0;
  },
});
```

Core properties: `HEIGHT`, `SLOPE`, `GROUND`, `HAS_WATER`, `WATER_DEPTH`, `EFFECTIVE_BIOME`, `AIR_TEMPERATURE` (base,
altitude, season, weather), `FLAMMABILITY` (ground, canopy fuel, wetness), `WALKABLE` (footing plus contributions from
dams, ice and bridges). `HAS_WATER` is backed by the one water rule, `hasWater` in `core/world/water`.

### Things, kinds, tags, flags and properties

Things stay in their stores, and every store answers one interface. People, animals and buildings stay objects with
their monotonic `serial` from `IdentifierSource`; plants stay in the SoA `VegetationStore`; a new small
`TransientStore` holds tornadoes, meteors, embers, arrows and volcano craters as columns, so they are saved, framed and
queryable.

```ts
export const ThingGroup = {
  Animal: 1,
  Building: 2,
  Person: 3,
  Plant: 0,
  Transient: 4,
} as const;

export interface ThingSource {
  readonly group: ThingGroupIndex;
  readonly slotCount: number;
  cell(slot: number): number;
  flags(slot: number): number;
  isLive(slot: number): boolean;
  kind(slot: number): number;
  serial(slot: number): number;
  x(slot: number): number;
  z(slot: number): number;
}

export interface AnchoredSource extends ThingSource {
  firstInCell(cell: number): number;
  nextInCell(slot: number): number;
}
```

- **Identity.** Public and saved identity is `(kind name, serial)` for agents, buildings and transients, and
  `(plant, slot, generation)` for plants: `VegetationStore` gains a saved `generation` column, which ends the ABA reuse
  behind `PlotSpot.plant`. Saved state refers to things only through the `thingRef` codec. Randomness is keyed on
  serials, never on slots. Frame id columns are `Uint32Array`, never `Float32Array`.
- **Positions.** Agent positions stay float64. Plants stay float32.
- **Kinds.** One compiled kind table covers every group. Base rows keep fixed indices pinned by a test, because
  `PlantSpecies.X`, `Biome.X` and `Ground.X` appear about 890 times in 41 files; rows added by modules get indices after
  the base rows when the catalog compiles. Rocks and monument pieces stay rows of the plant store, so plant slots never
  renumber; `rock` and `monument` are kind tags. Monument damage moves out of the piece's `seed` into the monument
  section, keyed by monument id.
- **Tags** are static per kind (`tree`, `conifer`, `wooden`, `uprootable`, `movable`), compiled into multi-word masks
  sized when the catalog compiles. `WOODED_BIOMES` and the three other conflicting biome groups become one `wooded`
  biome tag.
- **Flags** are dynamic per thing (`held`, `burning`, `sick`), registered by their owners and stored in each store's
  flag word. `held` is excluded from every query by default, in one place.
- **Properties** are open: `defineThingProperty({ name: "windResistance", rest: 0.5 })` compiles to one `Float32Array`
  per property indexed by kind, so existing kinds get the default. Catalog rows and module patches set values by kind
  name.
- **Columns** are per-thing data a module adds to a group it doesn't own: `defineColumn(ThingGroup.Person, "infection",
  "f32", 0)`. Columns are saved by name, cleared on spawn and mirrored only on opt-in. Non-numeric per-thing data
  lives in side tables keyed by serial, each with its own save section.
- **Stats** are properties with modifiers: `defineStat({ name: "resistance", base: RESISTANCE_PROPERTY })`.
  Modifiers that depend only on kind and global state (technology, season, rules) fold into a per-kind array refreshed
  when those change. Per-thing modifiers are column reads compiled into the stat. `explain` runs only for the
  inspector.
- **Traits** are behavior with configuration, defined by the module that owns the behavior: `flammable` in fire,
  `grabbable` in the hand, `uprootable` in vegetation. `defineTrait({ id, config: schema, response })`; configs are
  validated when the catalog compiles, and catalog patches may attach a trait to another module's kind by name.

**Trait responses have a driver contract.** Anchored things (plants, buildings) respond from a field's active set
through the per-cell list, so a response costs nothing where nothing burns. Movers and transients respond per thing,
because they number in the thousands. A response declares which, and the catalog compiler rejects a per-thing sweep
over plants. Plants keep burning as a per-cell aggregate (`canopyFuel` and a state flip), with no per-plant heat.

**Tribes** get a store with columns and stats like any group, without a position index: `TribeQuery.relation(a, b)`
reads the relation book, and modules add relation modifiers. A territory `claim` field (tribe slot per cell) makes
"whose land is this" a cell read.

### Reactions

A reaction is a batch kernel called once per tick over the active cells of its driving field. Field arrays are
resolved at creation, so nothing looks up a field by name inside the loop.

```ts
export interface ReactionDefinition {
  readonly create: (cells: CellStore) => ReactionKernel;
  readonly drivenBy: FieldDefinition;
  readonly id: string;
}

export interface ReactionKernel {
  readonly run: (tick: ReactionTick, active: Int32Array, count: number) => void;
}

export const SOAK_DOUSES_FIRE = defineReaction({
  create: (cells) => {
    const fire = cells.kernel(FIRE);
    const heat = cells.kernel(HEAT);
    const soak = cells.kernel(SOAK);

    return {
      run: (tick, active, count) => {
        for (let index = 0; index < count; index += 1) {
          const cell = active[index];

          if (fire.values[cell] > 0) {
            const remaining = 1 - Math.min(1, soak.values[cell] * tick.seconds);

            fire.values[cell] *= remaining;
            heat.values[cell] *= remaining;
            fire.markChunk(cell);
          }
        }
      },
    };
  },
  drivenBy: SOAK,
  id: "soak-douses-fire",
});
```

- **Only sparse fields and exposures drive a reaction.** The catalog compiler rejects a dense driver. A rule that
  depends on a dense condition (germs on wet cells) runs on a row sweep like `SurfaceSystem`'s 32 rows per tick, with
  its rate scaled by the sweep period. Global weather stays a scalar in `EnvironmentReading` and is never stamped on
  every cell.
- **Order.** Core reactions, then module reactions in `MODULES` order. Rules apply at once, in list order. A test pins
  the order.
- **Chance** comes from `unitHash(seed, tick, cell, ruleHash)`, so it doesn't depend on order.
- **Transitions as data.** Grounds and fields declare thresholds (`quenchesInto: "basalt"`, `meltsInto`,
  `ignitesAt`). The `transition()` helper turns each into an explicit reaction listed in `REACTIONS`, so every rule can
  be found with grep.
- **Iteration.** The pass walks a copy of the active cells taken at the start of the pass, in ascending cell order.
  Cells added during the pass are visited next tick.

### Strike

`strike` is the one way force and harm reach things in an area. It replaces 14 `damageArea`, 5 `scare` and 5
`addZone` calls and the three copies of "standing on a burning or lava cell hurts".

```ts
export interface Blow {
  readonly cause: DeathCauseDefinition;
  readonly damage: DamageType;
  readonly dangerSeconds: number;
  readonly filter: ThingFilter;
  readonly fright: number;
  readonly harm: number;
  readonly push: number;
  readonly swirl: number;
  readonly uproot: number;
}

export function strike(context: ModuleContext, area: QueryShape, blow: Blow): void;
```

- `harm` is scaled by the thing's resistance to `damage` (`wind`, `fire`, `crush`, `cold`, `corrosion`); `push`
  (outward) and `swirl` (around the center) are divided by `mass`; `uproot` goes to plants through the `uprootable`
  trait (trees fall, shrubs go, rocks and monuments have no trait).
- Health is 0 to 1 everywhere. Building and animal health keep their saved absolute values until the things section
  is rewritten; the section's reader converts.
- A hazard that hurts in its core and frightens wider strikes twice.
- `strike` adds danger to the `danger` field (which replaces `DangerZone[]`), emits `thingKilled` for deaths, and
  accumulates harm in columns. It never emits per-hit events.

### Context queries

One reader for both threads. `WorldState` and `WorldMirror` implement the cell part; the worker adds things, tribes
and area measures.

```ts
export type QueryShape = Disc | Capsule | CellRegion;

export interface Disc {
  readonly kind: "disc";
  radius: number;
  x: number;
  z: number;
}

export interface Surroundings {
  readonly cells: CellReader;
  readonly environment: EnvironmentReading;
  readonly things: ThingQuery;
  readonly tribes: TribeQuery;
  cellAt(x: number, z: number): number;
  collectCells(shape: QueryShape, out: CellList): number;
  findCell(shape: QueryShape, filter: CellFilter): number;
  measure(query: PreparedAreaQuery, shape: QueryShape, out: AreaResult): void;
}

export interface CellReader {
  field(field: FieldDefinition): FieldView;
  property<Value extends number | boolean>(property: CellProperty<Value>, cell: number): Value;
}

export interface ThingQuery {
  any(shape: QueryShape, filter: ThingFilter): boolean;
  collect(shape: QueryShape, filter: ThingFilter, out: ThingList): number;
  count(shape: QueryShape, filter: ThingFilter): number;
  nearest(shape: QueryShape, filter: ThingFilter, out: ThingReference): boolean;
  tally(shape: QueryShape, filter: ThingFilter, out: KindTally): void;
  visit(shape: QueryShape, filter: ThingFilter, visitor: ThingVisitor): void;
}

export interface ThingVisitor {
  visit(group: number, slot: number, distanceSquared: number): boolean;
}

export interface ThingFilter {
  readonly all: Uint32Array;
  readonly any: Uint32Array;
  readonly flagsClear: number;
  readonly flagsSet: number;
  readonly groups: number;
  readonly kinds: Uint8Array | null;
  readonly none: Uint32Array;
  readonly relation: TribeRelation;
  tribe: number;
}

export interface CellList {
  readonly cells: Int32Array;
  readonly distancesSquared: Float64Array;
}
```

Filters and area queries are written as descriptors at module scope and resolved per world in `create`, so a world
with mods resolves against its own catalog:

```ts
export const TREES = defineFilter({ all: [TREE], groups: [ThingGroup.Plant] });

export const TORNADO_VIEW = defineAreaQuery({
  biomes: true,
  fields: [{ field: FIRE, measures: ["maximum", "countAbove"], threshold: 0 }],
  things: [
    { filter: TREES, measure: "tally" },
    { filter: PEOPLE, measure: "byTribe" },
  ],
  water: true,
});
```

`measure` pays only for what the query declares. A module's own field (acid, germs) joins a query through its handle,
with no core edit. `CellFilter` covers cell tags and field thresholds, and `findCell` answers "nearest shore" or
"nearest dry spot" in radial order without random probes.

Guarantees:

- **Order.** Distances are compared squared. Cells come in radial order `(distanceSquared, dz, dx)` from a
  precomputed pattern. Things in a cell or bucket come in ascending slot order; ties go to the lower `(group, slot)`.
- **Indexes.** Movers sit in 40 m CSR buckets (22 µs to rebuild for 5,000 movers), rebuilt at phase boundaries when
  dirty. Searches pad by the largest step a mover takes in a tick and test live positions. Plants and buildings use
  per-cell lists. Block counts (16×16 cells) are added only for a caller a bench shows over budget; at tornado radii
  (45–140 m) no whole block fits, and a cell scan costs 5–25 µs.
- **No side effects.** No random draws, no allocation, no cache built by a query. Inspection and picking between
  steps read without building anything, and a test checks that hashes don't change when inspect queries are
  interleaved.
- **Hot paths** use `count`, `any`, `nearest` and `collect` (inline loops per store, chosen by the filter's group
  bits). `visit` is for rare queries and early exit. Visitors and lists are hoisted to module constants.

### Modules and registries

```ts
export interface ModuleManifest<Id extends string = string> {
  readonly catalog: CatalogContribution;
  readonly deathCauses: readonly DeathCauseDefinition[];
  readonly icon: IconSource;
  readonly id: Id;
  readonly powers: readonly PowerDefinition[];
  readonly requires: readonly string[];
  readonly sides: ModuleSides;
}

export interface ModuleSides {
  readonly engine: boolean;
  readonly interface: boolean;
  readonly simulation: boolean;
}

export function defineModule<const Manifest extends ModuleManifest>(manifest: Manifest): Manifest {
  return manifest;
}

export const MODULES = [rainModule, snowModule, lightningModule, tornadoModule, volcanoModule] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export type ModuleIdWith<Side extends keyof ModuleSides> = Extract<(typeof MODULES)[number], { readonly sides: { readonly [Key in Side]: true } }>["id"];

export const SIMULATION_MODULES = {
  lightning: lightningSimulation,
  rain: rainSimulation,
  snow: snowSimulation,
  tornado: tornadoSimulation,
  volcano: volcanoSimulation,
} as const satisfies { readonly [Id in ModuleIdWith<"simulation">]: SimulationModule<Id> };
```

- A side record lists exactly the modules that declare that side, so there are no `null` lines and `tsc` names a
  missing or extra one. Iteration always follows `MODULES`, never object key order.
- `requires` lets a module import the `shared/` of another; `modules.test.ts` checks that the graph is acyclic and
  follows `MODULES` order. An optional dependency resolves a handle at creation and gets `null` when the module is
  absent.
- `module.ts` carries ids, numbers, zod schemas, catalog rows, an icon URL and message ids. Message text lives in
  `messages.ts`, which only the interface imports, so the worker bundle carries no strings.
- The catalog compiles once, in two rounds: base rows, then module contributions (grounds, biomes, kinds, tags, trait
  patches, death causes) in `MODULES` order. It is frozen and hashed; the hash goes into replays and the lockstep
  handshake. Scenario and mod rounds arrive with scenarios and mods.

```ts
export interface SimulationModule<Id extends string> {
  readonly create: (context: ModuleContext) => ModuleRuntime;
  readonly id: Id;
}

export interface ModuleRuntime {
  readonly columns: readonly ColumnDefinition[];
  readonly commands: readonly CommandDefinition[];
  readonly fields: readonly FieldDefinition[];
  readonly frames: readonly FrameSection[];
  readonly jobs: readonly JobDefinition[];
  readonly listeners: readonly EventListener[];
  readonly powers: Partial<PowerHandlers>;
  readonly reactions: readonly ReactionDefinition[];
  readonly saves: readonly SaveSection[];
  readonly statModifiers: readonly StatModifier[];
  readonly systems: readonly System[];
}

export interface ModuleContext {
  readonly catalog: FrozenCatalog;
  readonly cells: CellStore;
  readonly events: EventSink;
  readonly query: Surroundings;
  readonly random: (streamId: string) => RandomStream;
  readonly rules: RulesReader;
  readonly schedule: Scheduler;
  readonly stats: StatReader;
  readonly strike: (area: QueryShape, blow: Blow) => void;
  readonly terrain: TerrainEditor;
  readonly things: ThingWriter;
}
```

`defineRuntime({ systems: [...] })` fills empty lists, so a module lists only what it uses. Core systems use the same
contract and register in `CORE_SYSTEMS` in `simulation/runtime`. `TerrainEditor` batches height and ground edits and
schedules hydrology; derived layers (water, walkability, navigation, coast) declare their inputs and rebuild after a
load and when an input's change bits fire, so a dam or ice sheet that loads in a section still shapes the water.

**Society and fauna extension points**, so tribe systems don't edit core:

- `JobDefinition { kind, band: "survive" | "duty" | "work" | "leisure", score, start, update, schema,
  interruptible }`. Decisions pick the best proposal per band in band order, replacing the `decideJob` ladder and the
  `NIGHT_JOBS`, `UNWAVERING_JOBS` and `STEADFAST_JOBS` sets. Jobs save as `{ kind, data }`; an unknown kind loads as
  idle.
- Considerations: a module adds a weight to an existing job's score ("rest when sick") without importing society.
- Animal brains by kind tag in fauna, so a beaver brain is a registration.
- Lifecycle events: `personBorn`, `personDied`, `tribeFounded`, `tribeExtinct`.

### Commands

```ts
export interface StampedCommand {
  readonly command: SimulationCommand;
  readonly player: number;
  readonly sequence: number;
  readonly step: number;
}

export interface CommandDefinition<Payload = unknown> {
  readonly apply: (payload: Payload, issuer: Issuer, tick: Tick) => Refusal | null;
  readonly kind: string;
  readonly schema: ZodMiniType<Payload>;
}
```

- Payloads carry quantized integers: centimeters, whole milliseconds. Every command, the local player's included, is
  applied only after the same encode and decode, so `-0` and float noise can't split peers.
- Powers go through `usePower { power, x, z, parameters }` and per-step `strokeStep { power, x, z, milliseconds }`
  samples taken on the main thread. A brush applies `milliseconds` of effect, so speed 16 doesn't multiply it.
- `setPaused` is a command and pause is clock state (saved, hashed). Speed is scheduler state: it changes how many
  steps run per real second, never what a step does.
- Validation is a pure function of the command and the state. A refusal becomes a notice event with a message id.
- Inspection is a query message, not a command.

### Events

```ts
export function defineEvent<Payload>(definition: EventDefinition): EventHandle<Payload>;

export const THING_KILLED = defineEvent<ThingKilled>({ id: "thingKilled", isPresented: true });

export interface EventListener {
  readonly event: EventHandle<unknown>;
  readonly handle: (tick: Tick, payload: unknown) => void;
}
```

- Events queue in emission order and drain once, at the end of the tick. Listeners run in `MODULES` order, then
  registration order. Events emitted during the drain join the same drain, up to four rounds.
- A listener writes only its own module's state. If something must change the world in the same tick, it is a field.
- Shared facts live in the catalog as generic events with a `cause` (`thingKilled`, `hazardStruckCamp`,
  `lightningStruck`, `fireSeen`, `waterChanged`), so society listens once for every hazard. A module's private events
  live in its `shared/`.
- High-volume facts (plants burning) are merged per 16×16 block before they are emitted, never per plant.
- `isPresented` events also go into the frame as effects, coalesced per frame by kind and block. The chronicle stores
  `{ id, values }`, never English text.

### Save sections

```ts
export interface SaveSection<Saved = unknown> {
  readonly afterRestore: (() => void) | null;
  readonly isCore: boolean;
  readonly key: string;
  readonly read: (saved: Saved, names: NameReader) => void;
  readonly requires: readonly string[];
  readonly reset: () => void;
  readonly schema: ZodMiniType<Saved>;
  readonly write: (names: NameWriter) => Saved;
}
```

- Every field, store, core system and module that holds state contributes sections. The logical form is designed
  once and does not follow the memory layout (see [Saves](#saves)).
- The digest of a section is a canonical hash of its `write` output (keys sorted, typed arrays read as words, NaN
  rejected). Only the session section is unhashed, and a test lists it. Hot sections may add an incremental digest
  that a CI test proves equal to the canonical one.
- A section that fails its schema resets, together with the sections that `require` it. A core section (terrain,
  society, vegetation) refuses to load instead. In a lockstep resync any failure is fatal.

### Frame sections

```ts
export interface FrameSection<Key extends string = string, Payload = unknown> {
  readonly build: () => FramePart<Payload> | null;
  readonly key: Key;
}

export interface FramePart<Payload> {
  readonly payload: Payload;
  readonly transfer: readonly ArrayBuffer[];
}

export interface MirrorSection<Key extends string = string, Payload = unknown> {
  readonly apply: (mirror: MirrorWriter, payload: Payload) => WorldChanges;
  readonly key: Key;
}
```

The payload type lives in the module's `shared/`. Section kinds: `rows` (cell-state pages), `regions` (height and
water), `patch` (vegetation and dirty thing slots), `packed` (people, animals, transients). `apply` returns the change
kinds, which replaces the hand-kept `hasLandChanged` list. Lasting effects (tornadoes, embers, meteors) are transient
things with frame rows, so a reload or a late joiner sees them; only instant effects stay events.

## Walkthroughs

Each walkthrough states its core edits. That count is the acceptance test for the architecture.

### The tornado, one tick

The tornado is a transient thing in phase `emit`. It writes the gust exposure, measures its surroundings, and strikes.

```ts
const SWEPT = defineFilter({ all: [MOVABLE], groups: [ThingGroup.Animal, ThingGroup.Person] });

const STANDING = defineFilter({ groups: [ThingGroup.Building] });

export function createTornadoSystem(context: ModuleContext, tornadoes: TornadoColumns): System {
  const { cells, events, query, strike } = context;

  const scratch = {
    area: createDisc(),
    cells: createCellList(TORNADO_CELL_LIMIT),
    core: createDisc(),
    result: createAreaResult(TORNADO_VIEW),
  };
  const view = query.prepare(TORNADO_VIEW);
  const filters = { standing: query.filter(STANDING), swept: query.filter(SWEPT), trees: query.filter(TREES) };
  const gust = { x: cells.writer(GUST_X), z: cells.writer(GUST_Z) };

  return {
    id: "tornado",
    phase: "emit",
    step: (tick) => {
      for (let slot = 0; slot < tornadoes.count; slot += 1) {
        rage({ events, filters, gust, query, scratch, strike, view }, tornadoes, slot, tick);
      }
    },
  };
}

function rage(parts: TornadoParts, tornadoes: TornadoColumns, slot: number, tick: Tick): void {
  const { events, filters, gust, query, scratch, strike, view } = parts;
  const { area, core, result } = scratch;

  const center = tornadoPositionAt(tornadoes.path[slot], tornadoes.age[slot]);
  const radius = tornadoes.radius[slot];

  setDisc(area, center.x, center.z, radius);
  setDisc(core, center.x, center.z, radius * CORE_SHARE);
  query.measure(view, area, result);

  const strength = tornadoes.strength[slot] * strengthOver(result, filters.trees);
  const force = strength * tick.seconds;
  const count = query.collectCells(area, scratch.cells);

  stampSwirl(gust, scratch.cells, count, center, force);
  strike(core, { ...SWEPT_BLOW, filter: filters.swept, harm: PEOPLE_HARM * force, push: FLUNG * force, swirl: SWIRL * force, uproot: force });
  strike(area, { ...STANDING_BLOW, filter: filters.standing, harm: BUILDING_HARM * force });

  if (result.field(FIRE).countAbove > 0) {
    events.emit(FIRE_WHIRL, { cell: query.cellAt(center.x, center.z), strength: result.field(FIRE).maximum });
  }

  if (result.things(PEOPLE).count > 0) {
    events.emit(HAZARD_STRUCK_CAMP, { cause: TORNADO_CAUSE, tribe: result.things(PEOPLE).dominantTribe, x: center.x, z: center.z });
  }

  tornadoes.strength[slot] = strength;
}

function strengthOver(result: AreaResult, trees: ThingFilter): number {
  if (result.waterShare > WATERSPOUT_SHARE) {
    return WATERSPOUT_GROWTH;
  }

  return 1 - FOREST_DRAG * windHoldOf(result.things(trees).tally);
}
```

What it learns: the effective biome (right over lava and water), trees by species (`tally`, weighted by each species'
`windResistance`), fire (maximum and burning cells), people by tribe. The spread object in `strike` is the one place it
allocates; a hot module hoists its blows. Who reacts:

- **`react`:** `wind-blows-out-fire` reads the gust and replaces the tornado's `blowOut` loop; burning buildings go
  out through fire's `flammable` response reading the lower cell fire, which removes `buildings.blowOut`.
- **`strike`:** movers are pushed and swirled by mass (a mammoth no longer swirls like a hare), harmed by `wind`
  resistance; trees fall with an angle from `unitHash`, shrubs go; held things are skipped by the filter's default.
- **`settle`:** `thingKilled` and `hazardStruckCamp` become chronicle lines from the module's death message.

Cost at radius 140 m: about 615 cells, two short mover bucket walks, one cell scan for the tally; 5–25 µs, against
today's two allocating disc walks, five linear agent scans and four temporary arrays. Core edits: none.

### A new power: acid rain

The brush stamps the `soak` exposure and a tiled persistent field `acid` (tags `wet`, `corrosive`, `decayPerDay`).

```
modules/acid-rain/
  module.ts                       power (zod/mini radius, strength), sides, icon URL, death cause,
                                  catalog: grounds patch { barren }, trait patch corrodes → wooden kinds
  messages.ts
  simulation/acid-simulation.ts   ACID field, two reactions (acid-sears-ground, transition grass → barren),
                                  the corrodes response, the stroke handler
  simulation/acid-simulation.test.ts
  engine/acid-tint-layer.ts       TerrainLayer reading the acid channel of the cell-state pages
  engine/acid-rain-cue.ts, acid-hiss.webm, acid-engine.ts
  engine/acid-tint-layer.browser.test.ts
  interface/icon.webp
```

Fires go out for free through `soak-douses-fire`. The rain look's tint goes through the precipitation look slot that
weather owns. Registration: `MODULES`, `POWER_ORDER`, `SIMULATION_MODULES`, `ENGINE_MODULES`: four sorted lines.

Core edits: none, if the first corrosive kind ships with its trait in the module. The `barren` ground is a catalog
contribution and appears in the ground name table; an old save has no `acid` and loads it at rest. A build without the
module keeps the unknown section verbatim and writes it back.

### A new thing kind: boat

```ts
export const BOAT = defineThingKind({
  formerNames: [],
  group: ThingGroup.Transient,
  name: "boat",
  properties: { heatResistance: 0.1, mass: 300, radius: 2.5, windResistance: 0.5 },
  tags: [WOODEN, MOVABLE],
  traits: [
    useTrait(FLAMMABLE, { burnSeconds: 45, ignitesAt: 0.25 }),
    useTrait(GRABBABLE, { liftHeight: 3, settlesOn: "water" }),
    useTrait(FLOATS, { draft: 0.4 }),
  ],
});
```

- **`floats`** is a trait the boat module owns: a `life` system moves boats down the water surface gradient (from the
  world reader) and with the gust, and beaches them where `HAS_WATER` is false. It moves to core when a second kind
  floats.
- **Fire, hand, tornado, lava** need no code: `flammable` heats and burns movers per thing; `grabbable` with
  `settlesOn: "water"` lets the hand set it on water; `strike` pushes it by mass; lava harms it through `fire`
  resistance.
- **Files:** `module.ts`, `messages.ts`, `simulation/boat-simulation.ts` (kind, `floats`, `spawnBoat` command) and its
  test, `engine/boat-model.ts`, `engine/boat-presenter.ts` (a `ThingPresenter`: layer, pick volume, rings, hand pose),
  `engine/boat-engine.ts`, `interface/icon.webp`. Inspection comes from the generic kind rows. Four registration lines;
  `tsc` asks for the presenter because `THING_PRESENTERS` is keyed by every kind manifest with a packed frame.

Core edits: none.

### A new tribe system: sickness with a journal panel

- **State.** `germs`, a sparse field tagged `contagion`. Columns `infection` and `immunity` on the person group.
  Disease rows in the module's catalog contribution: routes, affected tags, an onset–peak–end curve, lethality.
- **Simulation.**
  - Reactions on `germs` (driven by the sparse field): fade in sun, thrive on `marsh` ground.
  - `sickness.catch` (phase `life`, cadence 10) samples germs at each person's cell, counts sick neighbors with
    `count(contactDisc, SICK_PEOPLE)` (filter `flagsSet: SICK`), and compares with `stat(slot, RESISTANCE)`. Warmth,
    hunger and herbalism publish their own stats; sickness pulls them, so providers never write code for sickness.
  - Progress follows the curve; death goes through `things.kill` with the module's death cause.
  - A consideration raises the score of `rest` for sick people. A `healer` job is a `JobDefinition` in the module.
  - Events `fellIll` and `recovered` in its `shared/`; `thingKilled` with cause `sickness` from the catalog.
- **Panel.** `shared/sickness-frame.ts` (per-tribe counts, built once per game hour), a `MirrorSection` that feeds
  `useSicknessStore`, and `interface/sickness-journal.tsx` registered as `{ id: "sickness", placement: "journal",
  label, icon, load }`. The journal derives its tabs from `PANELS`; test setup resets registered stores.
- **Look.** Pale sick people through a person visual-state channel that the people presenter exposes to modules.

About 14 files, five registration lines. Core edits: none once the society extension points and the visual-state
channel exist ([phase T](#migration)).

## Determinism, replays, lockstep and saves

### Exact math and randomness

- `core/foundation/exact-math.ts` holds `sin`, `cos`, `atan2`, `exp`, `log`, `log2`, `pow`, `tanh`, `asin` and
  `acos`, ported from fdlibm with exact operations only, pinned by golden tests. A port of `exp` measured 1.3× native
  in V8 and 1.8× in JSC. Per-cell factors (fire's slope and wind terms) use clamped lookup tables.
- A codemod rewrites the 147 `Math.hypot` calls in simulation, generation and world as `Math.sqrt(dx * dx + dz * dz)`
  or squared comparisons. About 180 other transcendental calls and 10 lines with `**` follow.
- `unitHash(seed, a, b, c)` (`Math.imul` and lowbias32) replaces the `Math.sin` `hashToUnit` at its 44 sites. Its seed
  parameter is a branded `WorldSeed`, so a seedless call (as in `succession.ts` today) fails typecheck.
- Named streams: `stream(worldSeed, "fauna.instincts")`, seeded through splitmix32 into the full xoroshiro128plus
  state, with no draws from a parent. Each module gets `power:<id>` for its powers. States are saved in
  `randomStreams`; a missing one is re-derived. Generation gets named streams too, which fixes the shared
  `seed * 19 + 7` in `wetlands.ts` and `rock-strength.ts`.
- There is no presentation stream in the simulation. Ember durations look visual but decide where embers land, so they
  are state. Visual-only randomness is derived on the main thread from `hash(serial, tick)`.
- Sort comparators in simulation code break ties by serial (`sortBy` helper).

### Canonical orders

Iteration order must be a function of saved state, or save, load and N ticks diverges from N ticks.

- Active sets become bitsets scanned in ascending order over a snapshot taken at the start of each pass (about 12,800
  words at 640², microseconds). Today `CellSet` keeps insertion order and `FireSnapshot` saves it; that stays until the
  determinism batch switches it.
- Each cell's plant list is kept sorted by slot, so `nextInCell` becomes derivable. The free list is state, saved and
  hashed.
- Lazy indexes refresh at phase boundaries, never on a query.
- Change trackers that feed simulation decisions are saved; frame trackers never feed the simulation. Navigation
  rebuilds in the tick that edited terrain, the same way live and after a load.

### Hashing

- The hasher keeps its own dirty bits: 64×64 chunks for fields, 1,024-slot pages for plant columns, full rehash for
  movers and transients, which are small. A rolling pass rereads 1/K of chunks every turn from raw data, so a missed
  dirty mark is caught within K turns.
- Hashes are computed only when something consumes them: a lockstep peer, the replay recorder, a test or debug mode.
  Single-player frames carry none. Budget: 0.3 ms per turn.
- The root hash folds section digests, so a desync points at a section.

### Replays and lockstep

- **`TickSource`** lives in the worker. The local one accumulates real time with speed, pause, the backlog and the
  40-step cap, and stamps commands. The lockstep one hands out confirmed turns. The kernel doesn't know which it runs.
- **Turns** are 100–200 ms of real time holding `speed` ticks each, so speed 16 doesn't mean 80 turns a second.
  Speed and pause are relay-ordered commands applied at turn boundaries.
- **Relay:** one Cloudflare Durable Object per match orders and broadcasts commands and never simulates. The socket
  lives in the worker. The handshake compares the build id, the catalog hash and the module list. Each build is served
  at an immutable versioned URL; a lobby pins one.
- **Replay:** a header (build, catalog hash, seed, base hash, name tables), the command log, root hashes per turn, and
  optional keyframes. Exports and resync payloads embed the compressed base.
- **Desync:** root hashes differ, peers swap section digests, both dump the first bad turn, the host sends a snapshot.

### Saves

- **Envelope:** `{ format: 2, base: { id, hash }, names, sections }`. `names` covers every catalog stored by index:
  grounds, biomes, plant species, plant states, crops, eras, monument damage, animal kinds, weapons, resources,
  technologies, buildings, power ids, weather kinds. Columns and fields declare catalog references through
  `catalogRef(...)` codecs, and the name tables are collected from the codecs used, so a missing table is a type error.
- **Unknown names:** each catalog declares `fallback(name)` or `drop`. Renames are `formerNames` on the definition,
  which works across stores because kinds share one namespace.
- **The logical schema** is designed once, before any memory refactor: things as records keyed by kind name with
  serials; fields by name, lava a field from day one (with volcano ownership as a side table); jobs and transients as
  records. Later steps change memory and section code, never what is on disk. They may only add defaulted fields; a
  saved field never changes meaning.
- **One frozen legacy reader**, `legacy-snapshot-1.ts`, maps today's `SAVE_VERSION = 1` snapshot into the logical
  schema, with copies of every implicit index order frozen inside it (`OLDER_SAVE_PLANT_SPECIES`, ground and biome
  orders, crop codes, plant states, eras). It is written once and never extended. This is not a per-version remap
  table: there is exactly one, for the shape that predates self-describing saves.
- **Schemas** are `zod/mini` `looseObject` with per-field defaults, and the loader keeps the parsed output (today
  `z.custom` in `saved-world.ts` throws it away).
- **Older and newer builds.** Unknown sections and rows with unknown names are kept verbatim and written back. A
  writer refuses to overwrite a save newer than its format. A save that loaded with losses is never autosaved over;
  the game writes a copy and marks it. Every save shape change is expand–contract: write old and new keys for one
  release, read new and fall back to old, then drop the old.
- **Saved now that wasn't:** jobs, paths through `pathRef`, `claimedPlants`, tornadoes, meteors, arrows, grabs, tasks
  as `{ dueStep, kind, data }`, water settling counted in steps. `snapshot()` never returns `null`.
- **`WorldBase`**: when a world is created, its 12 terrain layers, water features, springs, crossings, monuments and
  deposits are stored once, losslessly (row delta, byte-plane shuffle, gzip through `CompressionStream`, measured
  5.7 MB against 16 MB raw for seed 7 at 640²), in the worker after the world appears. It lives in its own IndexedDB
  database, `ashfolk-bases`, so the saves database never needs a version bump. Saves diff against it and reference
  `{ id, hash }`; the hash covers the stored bytes. Loading reads the base instead of regenerating, which saves 3.5–9 s.
  Orphan bases are deleted when no save references them.
- **Old saves** attach a base at their next load: loading regenerates the island anyway, and on a fingerprint match the
  base is written. Saves without a fingerprint keep regenerating on every load until the player confirms the land.
- **Generator changes** wait until `WorldBase` has shipped. Saves never opened since then hit the land-changed dialog,
  unless the owner chooses to keep a frozen copy of the generator ([open decision 1](#risks-and-open-decisions)).
- **Fixtures:** CI hashes the save schema; when it changes, CI writes a fixture with the previous main's build and
  commits it. Every fixture loads forever. The `save, load, run N = run N` property runs through the real envelope and
  serializer and compares canonical dumps, not root hashes.

## Worker bridge and frames

Comlink goes. `core/protocol/messages.ts` defines the messages, and each side has one `send` that collects
transferables:

```ts
export type ToWorker =
  | { readonly id: number; readonly kind: "create"; readonly request: WorldRequest }
  | { readonly base: WorldBase | null; readonly id: number; readonly kind: "load"; readonly save: SaveEnvelope }
  | { readonly id: number; readonly kind: "save" }
  | { readonly commands: readonly SimulationCommand[]; readonly kind: "advance"; readonly realMilliseconds: number }
  | { readonly id: number; readonly kind: "inspect"; readonly target: InspectionTarget }
  | { readonly kind: "dispose" };

export type ToMain =
  | { readonly id: number; readonly kind: "progress"; readonly share: number }
  | { readonly id: number; readonly kind: "world" | "saved" | "inspected"; readonly payload: ReplyPayload }
  | { readonly frame: Frame; readonly kind: "frame" }
  | { readonly id: number; readonly kind: "failed"; readonly reason: MessageDescriptor };
```

- **Pull model** as today: one `advance` in flight. The worker's `TickSource` stamps commands.
- **Validation:** `zod/mini` checks commands only, since under lockstep they arrive from peers. Frames are trusted.
- **Frames:** `Frame = { step, tick, sections: Partial<SectionPayloads> }`, with `SectionPayloads` mapped from the
  assembled frame keys. A missing key means unchanged. A frame is built once per advance (up to 40 ticks): sections
  accumulate dirty state across ticks and clear it when built. Building a frame never mutates state that is saved or
  hashed.
- **Fire** goes as ignited and extinguished deltas into a mirror bitset, not the whole burning set every frame.
- **Transfers** come from each section's `transfer` list. `buffersWithin` stays as a test oracle, and a development
  check fails when a transferred buffer belongs to a live store.
- **No SharedArrayBuffer.** COOP/COEP would break Whop's embedded checkout, sign-in popups and portal embeds, and
  Safari lacks `credentialless`. Transport stays internal to each section, so one can switch later.
- **Rendering stays on the main thread.** `engine/render` uses no DOM globals, enforced, so a worker renderer stays
  possible.

## Engine side

### Rendering

```ts
export const RENDER_STAGES = ["sky", "ground", "water", "cover", "figures", "overlays", "effects"] as const;

export interface RenderLayer {
  readonly changed: ((changes: WorldChanges) => void) | null;
  readonly dispose: () => void;
  readonly object: Object3D;
  readonly stage: (typeof RENDER_STAGES)[number];
  readonly update: (frame: RenderFrame) => void;
}

export type LayerFactory = (services: RenderServices) => RenderLayer;
```

- `WorldRenderer` loops over stages. Today's constraints become stage order: atmosphere before vegetation (shadow
  frustum), water after terrain patch levels. A browser test pins the order.
- Shared outputs (plant chunks, plant weather, patch levels, height sampling, shake) go through `RenderServices`,
  never from layer to layer.
- **Terrain and water layers** receive a channel node from the cell-state pages, not their own texture, so the terrain
  shader stays under WebGPU's default 16 sampled textures. Every registered layer is compiled in from the start and
  gated by a uniform, so a field appearing mid-game never compiles a pipeline. The patch-step rule lives in one shared
  `neighborSample` node, and every layer is cut by the island outline. A browser test counts samplers.
- No layer allocates per frame. Fire picks its nearest cells through block culling, not a sort of all burning cells.

### Presenters

- **`THING_PRESENTERS`**, keyed by every kind manifest with a packed frame: layer, pick candidates, hover and selection
  rings, spot, heading, footing, hand pose, visual-state channels (tint, pose overrides) that modules may claim.
- **`SkinnedFigures<Visual>`** holds the draw loop people and animals duplicate today (rest position, hand pose,
  footing, LOD, frustum, marker, palette). A new figure kind supplies `visualFor`, `parts`, `writePose` and `marker`.
- **`EFFECT_PRESENTERS`**, keyed by presented event: `{ clock, look, cue }`. One channel feeds rendering and audio,
  which replaces the two switches in `effect-view.ts` and `effect-sounds.ts`.
- Picking reads the mirror's `WorldReader`, not rendering's vegetation chunks.

### Models

`PLANT_LOOKS` and `ANIMAL_LOOKS` are keyed by name and replace `VARIANT_COUNTS`, `TREE_LOOKS`, `FOLIAGE_KEYS`,
`APPEARANCES` and `ANIMAL_MARKERS`. A module contributes looks for its own kinds. Material slots become a named list
with a derived count. `HUMAN_PARTS` and the bone lists stay order-coupled, guarded by a test.

### Audio

`AudioPart { hearFrame, hearCommand, hearRender, dispose }` and `EmitterSource { sound, collect }`. Cues sit with their
owner: a power's in its module, a chronicle cue with its category, an ambience group with its biome tag. The sound
catalog is generated from file stems, and a test fails on any sound nothing references. Ambience measures the mirror
through the same area query as the simulation, so the snow rule exists once.

## Interface

- **`design`**: primitives, `island.tsx`, `game-icon.tsx`, `settings-group` (out of a feature), backdrops (out of
  `app`). `GameIcon` takes an `IconSource`: a core name or a module's `new URL("./icon.webp", import.meta.url).href`.
  Records carry `icon` fields, which retires the eight icon maps.
- **`stores`**: engine, launch, preferences, world, interface, guide, saves, sound, focus. Panels read the engine
  through the handle and narrow selectors, never through `app`.
- **`panels`**: each a folder importing only `stores`, `design`, `core` and manifests. `PANELS` entries are
  `{ id, placement, label, icon, load, connect, store }` with placements `menu`, `settings`, `journal` and `dock`;
  `load` is a dynamic import, so the HUD chunk doesn't carry every panel. `PANELS` derives the tab unions, both menus
  and the store resets. `INSPECTORS` is keyed by inspection kind, and modules add `inspectorRows`.
- **`pages`**: `pages.ts` feeds Vite's inputs. The privacy page becomes TSX.
- **`app`**: the shell, the launcher, and the hand-written `WideHud` and `CompactHud`, because placement is design.
- **Strings**: typed message tables per module (`{ en, ru } satisfies Record<Locale, Record<MessageId, string>>`) and
  plurals through `Intl.PluralRules`. The worker sends `{ id, values }`. `tsc` catches a missing Russian line.
  Message ids are explicit and stable, because saved chronicles refer to them; old entries keep their English `text`.

## Packages

| Action | Package | Reason |
| --- | --- | --- |
| Remove | `comlink` | Last release 2024-11; its last fix never shipped. Lockstep needs messages, not a proxy. Saves 3.9 kB in each of two chunks. |
| Remove | `react-markdown`, `remark-gfm` | 100 of 122 runtime packages and a 50 kB gzip chunk that every player precaches, for one page. |
| Switch | `zod` → `zod/mini` | Same package; about 19 kB gzip less per chunk, 37 kB in all. Keeps `looseObject`, `codec`, `toJSONSchema`. |
| Add (dev) | `fast-check` | Save round trips, `save, load, run N = run N`, catalog reordering, the water rule. Depends only on `pure-rand`. |
| Add (dev, temporary) | `ts-morph` | Re-runnable moves; bundles its own TS 6, so TS 7 is fine. Removed when the moves end. |
| Later | `msgpackr` or `cbor-x` | Cloud saves, resync and replay export. Not before. |
| Optional | `idb` | If the save database grows beyond today's 304 lines of wrappers. |
| Keep | `pure-rand`, `simplex-noise` (exact already), `three`, `react`, `zustand`, Base UI, `tailwind-merge`, `clsx`, `lucide-react`, `vite-plugin-pwa`, Babel and the React Compiler | Each still earns its place. |
| Don't add | ECS libraries | 10–18× the memory per entity, 150–490× slower spawn, and snapshot loaders that remap ids. |
| Don't add | kdbush, flatbush, rbush, spatial hashes | A grid aligned to the cells is faster to rebuild and query, and deterministic. |
| Don't add | dependency-cruiser and `@swc/core` | All imports are relative, so a 150-line Bun script resolves the graph; 18 dependencies and a native binary buy nothing more. |
| Don't add | Bun workspaces, Nx, Turborepo, Sheriff | A module spans threads; packages would split it and add a lockfile edit per power. |
| Don't add | Lingui, i18next, Paraglide | Typed tables do it with `tsc` checks; revisit for outside translators or mod catalogs ([open decision](#risks-and-open-decisions)). |
| Don't add | Event buses, DI, RxJS, XState, immer, a router, wasm hashers, `fflate`, `valibot`, `@stdlib/*`, fixed point | No need found. |

## Migration

### Rules for every PR

- Every PR passes `check`, `typecheck`, `knip`, `test` and `boundaries`, and keeps saves from 0.10 loading.
- **Hash-neutral by default.** CI computes the canonical digests at the merge base and at the head, for seeds 3, 7 and
  11 on small grids over 10 game days at the shortest day length, with a scripted log that casts every power and saves
  and loads halfway. A PR without a `Hash-Change:` trailer must match. A hash-changing PR states the reason; CI logs it
  to `docs/hash-changes.md`. Hash-changing PRs merge one at a time.
- **Generation-changing PRs** (including terrain realism v2 and the crossings rework) wait until `WorldBase` has
  shipped ([S3](#phase-s-saves)).
- **World-changing releases.** Every merge deploys, so PRs can't be batched into a release. Simulation-only hash
  changes break no save and need only a line in the next notes. A release that changes worlds raises the minor
  version, as CONTRIBUTING says. Where several PRs must land at once, they go through an integration branch
  (`migration/<phase>`) merged as one PR.
- **Merge protection** for the migration: required status checks and a GitHub merge queue on `main` (an owner action),
  so a new file importing an old path can't turn main red.
- **Benches.** Gated PRs (kernel, fields, queries, rules) run the bench project and fail on a regression over 10%.

Budgets, from the measured baseline (640², seed 7, about 1,000 agents: 0.7–1.2 ms per tick, 4.6–8.8 ms per advance
at speed 16, worst advance 300–520 ms, frames 76–372 KB):

| Measure | Budget |
| --- | --- |
| p95 tick, 5,000 agents, 2,000 burning cells, 640², V8 and JSC | ≤ 2 ms |
| Advance at speed 16, mean | ≤ 8 ms |
| Worst advance (hydrology and navigation sliced) | ≤ 50 ms |
| Frame transfer, median | ≤ 128 KB |
| Frame apply on the main thread | ≤ 1 ms, no allocation in layers |
| Hash per turn, when consumed | ≤ 0.3 ms |
| Worker heap at 768² | ≤ 250 MB |
| Tornado at radius 140 m | ≤ 25 µs per tick |

### The codemod

- `scripts/moves/moves.json` maps old paths to final paths. `bun run apply-moves` (ts-morph `sourceFile.move()`) is
  idempotent: an agent runs it on its own branch, then rebases. It also rewrites the 118 `new URL(…, import.meta.url)`
  literals, which ts-morph doesn't touch, and a test checks that each one resolves.
- **Each file moves once, to its final path.** `tornadoes.ts` goes straight to
  `modules/tornado/simulation/tornado-system.ts`, even before the module contract exists.
- The same PR updates `.claude/workflows/ship.js` (its core and look path routing), `.claude/agents`, `biome.jsonc`,
  `vite.config.ts` (test globs, `setupFiles`), knip, `tsconfig.*`, AGENTS.md, CONTRIBUTING and the README code map. A
  guard test fails if a file appears under an old folder, and another checks that ship.js and Biome globs each match
  at least one file.
- CI verifies a move PR by re-running the move script on the merge base and diffing against the PR tree; hand edits
  are listed explicitly.
- Move PRs merge in the 02:00–06:00 window, when `gh pr list` is empty, with a lock label that a required check
  enforces. AGENTS.md gets a rebase recipe: merge the pre-move commit, run `apply-moves`, merge main.
- The exact-math rewrite is a Grit rewrite, so new code is written exact from the start.

### Phases

Impact: **H** changes hashes, **S** changes saves compatibly, **–** neither. Sizes: S under 400 changed lines, M up to
1,500, L above.

#### Phase 0: safety net

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| 0.1 | Canonical dump and digest harness: layout-independent (entities by serial, float64, fields by cell), per-seed hash files regenerated by `bun run hashes`, the merge-base comparison in CI | M | A 1% change to an erosion constant fails | – |
| 0.2 | Save fixtures per shape epoch (before the fingerprint, before the plant name table, 0.10), the schema-hash ratchet, the `save, load, run N` property as a ratchet with a list of known failures | M | Fixtures load | – |
| 0.3 | Bench project with the budgets above, nightly and on labeled PRs | M | Baseline recorded | – |
| 0.4 | `bun run boundaries` in report mode with the target table; Grit in warn mode with the offender list; `exact-math.ts`, `hash.ts` and the ratchet that new files comply; the `Hash-Change:` convention | M | CI green | – |
| 0.5 | Spike on a throwaway branch: the five composite projects with module sides, editor speed, `tsc --build` time, Vitest projects, knip; a written result | – | Nothing merges | – |

#### Phase M: moves

Folder by folder, leaves first, each file once, by `apply-moves`.

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| M1 | Untangle in place (18 files, one retyped import): mirror below rendering, stores and launch state out of `app`, shared stores out of features, `settings-group` to design, `chronicle`, `identifiers`, `effects` out of the simulation root, render helpers out of the render root | M | Top-level and feature graphs acyclic; screenshots identical | – |
| M2 | `core`: foundation, catalog, world (hydrology moves from generation, `Waypoint`, `agent-poses`, island shape and size), protocol (frame and command types, `tornadoPositionAt`, grab predicates, the save schema) | 2× L, mechanical | Boundaries zero for `core` | – |
| M3 | `engine`: bridge, mirror, models, render, audio, input | L, mechanical | Screenshots at three sizes, near and far, headless GPU Chrome | – |
| M4 | `interface`: design, stores, panels, pages, app | L, mechanical | Browser tests, Playwright smoke | – |
| M5 | `simulation`: kernel and runtime split from `simulation.ts` as files only, nature, life, generation; powers straight into `modules/*/simulation` | 2× L, mechanical | Digests identical | – |
| M6 | Composite projects switch on; boundaries leaves report mode | S | `tsc --build` | – |

#### Phase S: saves

Runs alongside M from 0.2 on; S3 must ship before any generation change.

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| S1 | Name tables for every catalog stored by index, `formerNames`, `catalogRef` codecs, per-catalog unknown-name policy | M | Reordering a catalog in a test still loads every fixture | S |
| S2 | The logical envelope and section registry; sections write logical forms through adapters over today's classes; `legacy-snapshot-1.ts`; unknown sections kept; core sections refuse; the loader keeps parsed output | 2–3× L | Every fixture loads; forward-compatibility test against the previous release's schema | S |
| S3 | `WorldBase`: lossless, written for new worlds, stored in `ashfolk-bases`, attached at next load on a fingerprint match, orphans collected; loading reads the base | M | Base hash equals stored bytes; load skips generation | S |
| S4 | Saved jobs (`JobDefinition` schemas for the 22 job files), paths, claimed plants, transients, grabs, tasks as data; `snapshot()` never null | L, 3 PRs | `save, load, run N` known failures shrink to zero | S |

#### Phase K: kernel (the critical lane)

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| K1 | Bridge: the message protocol replaces Comlink; frame and mirror sections hold today's fields; one frame per advance; `transfer` lists | L, 3 PRs | Frame time within noise; `bun run shots` identical | – |
| K2 | Kernel shell: today's systems as `SimulationModule` adapters in today's exact order under one transitional phase, sharing the root `RandomSource`; `simulation.ts` shrinks to the runtime; the system-order fingerprint | M, 3 PRs | Digests identical | – |
| K3 | Commands only: `StampedCommand` with step and sequence; the step clock; `strokeStep` samples; tasks and water settling in steps; lightning at a seeded site weighted by height and canopy, no `setViewFocus`; pause as a command | L, 3 PRs | Browser test: terraform and brush while paused, water updates | H |
| K4 | Field store, tier one: `FieldWriter` with exactly today's semantics per field (lazy removal, insertion order, no new clamps), raw kernels with bulk marks, dirty chunks; the 40 raw writes and 25 manual `mark*` calls go | M, 2 PRs | Digests identical | – |

#### Phase Q: queries (the owner's headline, early)

Starts after K2, alongside K3 and K4.

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| Q1 | Read-only `Surroundings` over today's stores: cell properties, `ThingSource` adapters for plants, people, animals and buildings, mover buckets at phase boundaries, the radial pattern, a compatibility iterator (row-major, `hypot` distance) for ports that must keep order | M | No callers changed; digests identical; bench | – |
| Q2 | Ports that keep order: `inspectCell`, picking through the mirror's reader, the shared snow rule for rendering and ambience, `livingWithin`, `nearestPerson`, `hunterNear`, `answerFoes` (about 14% of non-generation CPU today, growing with the square of agents) | M, 3 PRs | Digests identical; interleaved-inspect test | – |
| Q3 | Filters with multi-word masks and flags, area queries, `tally`, `CellFilter`, capsules and regions | M | Bench budget for the tornado | – |

#### Phase D: determinism (simulation first)

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| D1 | Cross-engine CI: Vitest browser instances for Firefox and WebKit, Bun, a nightly macOS runner for Apple's libm; golden math tests | M | Engines agree on exact-math goldens | – |
| D2 | Simulation and world: the `hypot` codemod, exact math, `unitHash`, named streams with saved states, power streams; Grit becomes an error there | 3× M | Engines agree on the 10-day digests | H |
| D3 | Canonical orders: bitset active sets, sorted plant lists, saved free lists; derived links no longer saved | M | `save, load, run N` holds | H S |
| D4 | Order-changing query ports: radial `nearest` with squared compares, `nearestShore` as a true nearest without random probes | M | Behavior tests | H |
| D5 | Generation: exact math, `unitHash`, named streams, the `seed * 19 + 7` collision; only after S3 | M, 2 PRs | Engines agree on generation hashes | H, fingerprint |

#### Phase R: rules

After K4 and Q1.

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| R1 | Adopt `PHASES`; every system that will become a module sits at its final slot (end of its phase), so extraction is hash-neutral; floors move into decay passes; clamping per field | M | Order fingerprint updated on purpose | H |
| R2 | Exposures, the batch reaction pass, transitions; the first rules (`soak-douses-fire`, `wind-blows-out-fire`, `molten-beside-water`, `heat-source-melts-snow`, embers and burning buildings adding heat); rain and snow stop calling `fire.douse`, the tornado loses its `blowOut` loops | L, 3 PRs | #242 tests unchanged; one test per rule; lava at a river stops and steams near and far | H |
| R3 | `strike` and `Blow`: first a facade that calls today's `damageArea`, `scare` and `addZone` exactly (–), then unified constants and mass and resistance scaling, then the `danger` field | 3× M | Design sign-off per behavior change (earthquakes now hurt animals); behavior tests per power; screenshots | H |
| R4 | Lava as a field in memory (the logical schema already has it); volcano ownership as a side table; the lava terrain layer reads the cell-state channel | M | Volcano tests; far view | H |
| R5 | Events: the typed queue drained at settle; chronicle message ids; one fire discovery path; presented events as effects | M, 2 PRs | Chronicle tests | H |
| R6 | The compiled kind table, open thing properties, flags, traits with driver contracts (`flammable`, `grabbable`, `uprootable`), the transient store; the grab chain collapses into the `grabbable` trait and `THING_PRESENTERS` | L, 3 PRs | Hand tests; pick tests | H S |

#### Phase T: tribe and fauna extension points

After R3 and R5. Announce a short society freeze for T1.

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| T1 | `JobDefinition` registry with bands; `decideJob` ported so bands reproduce today's order | L, 2 PRs | Digests identical | – |
| T2 | Columns, stats with folded modifiers, considerations | M | Inspector explains a stat | – |
| T3 | Tribe store with columns, relations, `TribeRelation` filters, the `claim` field, lifecycle events | M | Rivalry tests | H |
| T4 | Fauna brains by kind tag; world-layer contributions to hydrology and walkability (`barsFlow`, `blocksMovement`, `bridges`) | M | A test dam raises a lake after load | – |

#### Phase X: module extraction

After K2, R1–R3, E1 and I1. The tornado goes alone first as the pilot; its touched-file count is recorded against the
walkthrough. Then one PR per module, one agent and worktree each: volcano, rain, snow, fire brush, lightning, meteor,
earthquake, terraform, forest and life spawns. Each is hash-neutral, because R1 put its systems at their final slots.
Only sorted registration lines can collide.

#### Phase E: engine

After M3 and K1.

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| E1 | Render stages, `RenderLayer`, `RenderServices`; cell-state pages and terrain layer channels; the sampler test | L, 3 PRs | Screenshots at three sizes, near and far; stage order test | – |
| E2 | Effect presenters on one channel; thing presenters; `SkinnedFigures` | L, 3 PRs | Screenshots; pick tests | – |
| E3 | Audio parts, emitter sources, cues next to owners, the generated sound catalog | M, 2 PRs | Unreferenced-sound test; each cue by ear in Chrome, Safari, Firefox | – |
| E4 | Looks keyed by name; named material slots | M | Screenshots | – |

#### Phase I: interface

After M4. Runs in parallel with everything above.

| # | Step | Size | Verify | Impact |
| --- | --- | --- | --- | --- |
| I1 | `PANELS` and `INSPECTORS` registries, lazy panels, `IconSource` | M, 2 PRs | Browser tests; HUD chunk size | – |
| I2 | Message tables per module and in the core catalog; the worker sends `{ id, values }` | L, 3 PRs | `tsc` catches a missing Russian line; old chronicles read | S |
| I3 | `zod/mini` (about 280 `z.` calls in 15 files) | M | Bundle sizes | – |
| I4 | Privacy page in TSX; react-markdown and remark-gfm removed | S | Privacy screenshots | – |

#### Phase L: lockstep readiness

Later, when online play enters Now: the lockstep `TickSource`, wall-time turns, the relay, replay export with the
embedded base, versioned build URLs, desync dumps, two workers in lockstep in a test.

### Lanes and the critical path

| Lane | Steps | Starts after |
| --- | --- | --- |
| 0 | 0.1–0.5 | — |
| Moves | M1–M6, in windows | 0.1, 0.4 |
| Saves | S1–S4 | 0.2 |
| Kernel | K1 → K2 → K3 → K4 | M5 |
| Queries | Q1 → Q2 → Q3 | K2 |
| Determinism | D1 any time; D2–D4 after K3; D5 after S3 | — |
| Rules | R1 → R2 → R3 → R4 → R5 → R6 | K4, Q1 |
| Tribes | T1–T4 | R3, R5 |
| Modules | X, fanned out | R1–R3, E1, I1 |
| Engine | E1–E4 | M3, K1 |
| Interface | I1–I4 | M4 |

Critical path: 0 → M5 → K1 → K2 → K4 → R1 → R2 → R3 → X. Honest size: 100–130 PRs, 50–70k changed lines with tests,
8–12 weeks at agent pace. Feature work continues throughout; only `simulation.ts` and society see short freezes, for
K2 and T1.

## Checklists

### A new power or hazard

1. Make `modules/<name>/module.ts` with `defineModule`: sides, `requires`, powers, catalog rows, death causes, icon.
2. Write `simulation/`: a system that writes fields or exposures, calls `strike`, or emits catalog events. Never call
   another system. If it should affect something, write a reaction against a field or tag.
3. Lasting state is a transient thing or a field; give anything else a save section with `reset`.
4. Add `engine/` (layer, presenter, cue) and `interface/` only if it has them; strings go in `messages.ts`.
5. Add the module to `MODULES` and `POWER_ORDER`; `tsc` names the side records to fill.
6. One test per rule; check that the system order and digests change only as meant, and say so in a `Hash-Change:`
   trailer if they do.
7. Look at near and far scenes; add a scene to the scenes list if the change only shows by eye.

### A new thing kind

1. `defineThingKind` in the owning module: group, tags, properties, traits.
2. If it needs behavior no trait has, define a trait in the module; promote it to core when a second kind uses it.
3. Fill the `THING_PRESENTERS` entry `tsc` asks for.
4. Saved references go through `thingRef`; randomness through its serial.
5. Test that `strike`, fire and the hand treat it by its properties.

### A tribe system

1. State: columns on existing groups, fields for anything spatial, side tables keyed by serial for the rest.
2. Behavior: `JobDefinition`s, considerations and stat modifiers; never import society.
3. Facts: catalog events, or events in the module's `shared/`.
4. Panel: a frame section, a mirror section, a store and a `PANELS` entry with `load`.

### A page

1. `interface/pages/<name>/` with the page and its entry, and the HTML shell at the URL path.
2. Add it to `PAGES` and to `public/sitemap.xml`.

### A change to generation

1. Check that `WorldBase` has shipped.
2. Update the generation hash files with a `Hash-Change:` trailer.
3. Say in the release notes that new islands differ; saved worlds keep their land through their base.

## What we deliberately don't do

- **No ECS library and no generic column store for agents.** People and animals stay objects behind `ThingSource`.
- **No workspace packages.** Layers are composite projects; a module stays one folder across threads.
- **No closures per cell in the reaction pass, and no dense drivers.**
- **No state hash in single-player frames.**
- **No lazy index built by a query, and no presentation stream in the simulation.**
- **No per-version save migrations.** One frozen reader for the pre-envelope shape, then names and defaults.
- **No globs, no declaration merging, no topological sort.**
- **No event bus semantics.** Events are facts drained once per tick; changes to the world go through cells.
- **No SharedArrayBuffer, no OffscreenCanvas renderer, no router.**
- **No GPU compute for reactions.** Active sets keep the pass small.
- **No block counts, data mods or scenario goals until a bench or a roadmap item needs them.** The query API and the
  catalog rounds leave room for them.
- **Catalogs stay catalogs.** A species or building is a row with properties, not a module.

## Risks and open decisions

### Risks

| Risk | Mitigation |
| --- | --- |
| Hash churn re-rolls promo seeds and pinned scenes | Hash changes are labeled and logged; re-pick seeds after D2 and R3 |
| Agents re-pin digests by reflex | Merge-base comparison instead of pinned files; the `Hash-Change:` trailer; the ship reviewer flags re-pins without cause |
| Generic paths slower than today's kernels | Two write tiers, batch reactions, inline query loops; bench gates on K, Q and R |
| Events become hidden coupling | Facts only; listeners write only their own state; the list is reviewed |
| Move conflicts with in-flight agent work | Moves in empty windows, `apply-moves` on branches, a rebase recipe |
| `WorldBase` size on phones | 5.7 MB per world lossless at 640²; check `navigator.storage.estimate()` before writing |
| Exact math speed | `exp` measured at 1.3–1.8× native; lookup tables for per-cell factors |
| Water settling counted in steps settles faster in real time at high speed | Accepted; a constant per speed if players notice |

### Open decisions for the owner

1. **Frozen generator copy.** Keep a self-contained copy of today's generator, loaded only for saves without a base,
   until a published sunset date, so saves not opened after S3 still load after generator changes? Or accept the
   land-changed dialog for them? Recommendation: keep the copy for one minor release.
2. **The one legacy reader.** It is a single frozen adapter, not a remap table that grows. Confirm it fits the rule
   against per-version migrations.
3. **Lingui or typed tables.** Typed tables are recommended until outside translators or mod catalogs arrive.
4. **Merge queue and required checks** on `main` for the migration. They need the owner's repository settings.
5. **Rivalry** as a core system or a module once T3 lands.
6. **Lockstep timing.** Phase L before or after deeper tribes.
7. **Mods.** Data only (a declarative tier of power archetypes and reactions over the same runtime objects) or code
   too; code mods can't be held to the determinism rules in lockstep.

## Sources

Research for this plan (in the architecture run's scratch folder): `research/coupling.md`, `research/things.md`,
`research/queries.md`, `research/boundaries.md`, `research/registration.md`, `research/determinism-saves.md`,
`research/engine-ui-structure.md`, `research/ecs.md`, `research/games.md`, `research/modules-ts.md`,
`research/spatial-queries.md`, `research/determinism.md`, `research/worker-bridge.md`, `research/packages.md`; the three
proposals in `proposals/`; the critics' benches in `bench/`, `critic-perf/` and `critic-migration/`.

- [ECMA-262: properties of the Math object](https://tc39.es/ecma262/#sec-function-properties-of-the-math-object)
- [Floating point determinism, Glenn Fiedler](https://gafferongames.com/post/floating_point_determinism/)
- [Factorio Friday Facts #55, desyncs](https://factorio.com/blog/post/fff-55)
- [1500 archers on a 28.8: networking in Age of Empires](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)
- [Hash prospector (lowbias32)](https://github.com/skeeto/hash-prospector)
- [pure-rand](https://github.com/dubzzz/pure-rand)
- [Factorio: data lifecycle](https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html)
- [Factorio: migrations](https://lua-api.factorio.com/latest/auxiliary/migrations.html)
- [Factorio: LuaSurface queries](https://lua-api.factorio.com/latest/classes/LuaSurface.html)
- [RimWorld: ThingComp](https://www.rimworldwiki.com/wiki/Modding_Tutorials/ThingComp)
- [RimWorld: stats](https://rimworldwiki.com/wiki/Stat)
- [Minecraft: tags](https://minecraft.wiki/w/Tag_(Java_Edition))
- [Noita: reactions](https://noita.wiki.gg/wiki/Documentation:_Reaction)
- [The Powder Toy: WATR element](https://github.com/The-Powder-Toy/The-Powder-Toy/blob/master/src/simulation/elements/WATR.cpp)
- [Dwarf Fortress: syndromes](https://dwarffortresswiki.org/index.php/v0.34:Syndrome)
- [Game Programming Patterns: spatial partition](https://gameprogrammingpatterns.com/spatial-partition.html)
- [Game Programming Patterns: Type Object](https://gameprogrammingpatterns.com/type-object.html)
- [bitECS](https://github.com/NateTheGreatt/bitECS), [Koota](https://github.com/pmndrs/koota), [apecs benchmark report](https://github.com/diffusionstudio/apecs/blob/main/bench/compare/REPORT.md)
- [Bevy: Plugin](https://docs.rs/bevy/latest/bevy/app/trait.Plugin.html)
- [TypeScript: project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Biome: plugins](https://biomejs.dev/linter/plugins/), [noRestrictedImports](https://biomejs.dev/linter/rules/no-restricted-imports/)
- [Bun: Transpiler](https://bun.com/docs/api/transpiler)
- [Zod Mini](https://zod.dev/packages/mini), [Zod codecs](https://zod.dev/codecs)
- [fast-check: model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)
- [Vitest: browser instances](https://vitest.dev/config/browser/instances)
- [Is postMessage slow?, surma.dev](https://surma.dev/things/is-postmessage-slow/)
- [COOP and COEP, web.dev](https://web.dev/articles/coop-coep)
- [Cloudflare Durable Objects: WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [MDN: CompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream)
- [MDN: Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)
