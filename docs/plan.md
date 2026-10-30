# Architecture plan

This plan restructures Dawnfolk so that a new power, hazard, grabbable kind or page is one folder and a few typed
registry entries, and so that elements meet through declared properties instead of hand-written calls between
features. It keeps the rules in [AGENTS.md](../AGENTS.md#rules-that-are-easy-to-miss): the engine never imports
React, the simulation never imports rendering, generation and the simulation stay deterministic, commands are
validated at the worker boundary, saves stay loadable, and large stores stay in typed arrays.

It is written against `main` after #243. Saves and determinism come first, because every later step leans on them.
The detail is in [Migration](#migration).

## Contents

- [What is there today](#what-is-there-today)
- [Saves come first](#saves-come-first)
- [Determinism](#determinism)
- [What the research says](#what-the-research-says)
- [Target structure](#target-structure)
- [Modules and registries](#modules-and-registries)
- [Properties and reactions](#properties-and-reactions)
- [Sound](#sound)
- [Pages, tests and limits](#pages-tests-and-limits)
- [Migration](#migration)
- [Checklists](#checklists)
- [What we deliberately don't do](#what-we-deliberately-dont-do)
- [Sources](#sources)

## What is there today

The source is 469 files and about 81 000 lines, with 249 test files next to them.

### What works and stays

- **Typed-array fields with active sets.** Cell state lives in `Float32Array` fields on `WorldState`
  (`fire`, `fuel`, `heat`, `wetness`, `snow`, `scorch`, `crop`, `trodden` in
  `src/simulation/world/world-state.ts`). `FireSystem` walks only burning and heated cells through `CellSet`
  (`src/simulation/world/cell-set.ts`). This is the base of the property model.
- **Content as typed records.** `POWERS`, `BUILDINGS`, `GROUNDS`, `PLANT_SPECIES` and `TECHNOLOGIES` in
  `src/content` are plain data, and `Record<PowerId, …>` maps make TypeScript catch a missing entry.
- **The worker boundary.** Commands are parsed with zod in `src/simulation/commands.ts`, and frames carry packed
  typed arrays that are transferred, not copied (`src/workers/simulation-worker-api.ts`).
- **Saves by name for plants.** `PLANT_SPECIES_NAMES` in `src/simulation/saved-world.ts` maps species on load.
- **Colocated tests.** `water.ts` sits next to `water.test.ts`; the suffix picks Node or Chromium; shared fixtures
  live in each area's `testing` folder.
- **Boundaries in Biome.** The `noRestrictedImports` overrides in `biome.jsonc` keep React out of the engine and
  rendering out of the simulation.

### What hurts

1. **Every feature is wired by hand in many places.** The volcano merge (`24c94d3`) touched 35 files, the hand tool
   (`ea1a434`) 41, the hand polish (#243) 23, including a new `src/rendering/hand-motion.ts`. A power is
   registered in four places: `src/content/powers.ts`, the handler and schema maps in
   `src/simulation/powers/power-registry.ts`, `src/features/powers/power-icons.tsx` and
   `src/design/game-icon-sources.ts`. A grabbable kind needs `GRABBABLE_KINDS` in
   `src/simulation/hand/grab-target.ts`, a handler in `grab-handlers.ts`, picking in
   `src/game/input/entity-picker.ts`, lifting in `hand-motion.ts` and drawing in each view.
2. **Element interactions are per pair.** Rain and snow call `fire.douse` (`element-powers.ts` lines 87 and 115).
   Lava stops at water, remembers the water cell as `quenchedCell`, douses the tongue head and shows steam
   (`volcanoes.ts` around line 297); it adds heat to the neighbors once, when it covers a cell. Embers land
   through `#landEmber` in `simulation.ts`. Burning buildings heat their neighbors directly (`buildings.ts`).
   The tornado learned to blow out fire only in #242, with its own `blowOut` loop over cells
   (`tornadoes.ts` line 162) and a second one over buildings (`BuildingSystem.blowOut`). Each new element has to
   know every element it should affect.
3. **`Simulation` is a god object.** `src/simulation/simulation.ts` (919 lines) builds about twenty systems, lists
   every snapshot field in `snapshot()` and `restore()`, and holds the command table, strokes, grabs, tasks,
   splashes, incidents and notices.
4. **The frame is one interface.** `src/simulation/frame.ts` declares every field, `FrameBuilder` fills it, and
   `frameBuffers` in the worker API lists every buffer to transfer: three edits per frame field.
5. **Layers leak.** `rendering` imports `game/world-mirror.ts` 33 times while `game` imports `rendering`.
   `features` imports `app` about 20 times and other features about 60 times.
6. **Odd places.** The privacy page is split over `privacy/index.html`, `src/privacy.tsx` and
   `src/features/privacy`. The root `worker/` is the Cloudflare Worker while `src/workers/` is the simulation
   worker. `tests/` mixes Playwright specs, the screenshot script and the Chromium helper `vite.config.ts` imports.
7. **Large files.** 43 source files are over 400 lines, led by `generation/hydrology.ts` (1304),
   `simulation/fauna/fauna.ts` (1081), `models/mesh/shapes.ts` (1018) and
   `simulation/society/rivalry/rivalry-system.ts` (1003). Functions are mostly fine; the longest are
   `createGrassMaterial` (119 lines) and `WorldRenderer.render` (100).
8. **Saves depend on generation, and nothing guards it.** See the next section.
9. **No sound.** There was no audio code or asset. Sound landed in 0.9; see [Sound](#sound).

## Saves come first

Loading a save does not read the world from the save. `loadWorld` in `simulation-worker-api.ts` regenerates the
island from the saved seed and options, then `WorldState.restore` applies sparse differences against the
regenerated layers (`sparseDifference` and `applySparse` in `world-state.ts`). Height, water surface, ground, fuel
and canopy are all stored as changes from what generation makes.

So any change to generation silently corrupts old saves: the differences land on a different island. This has
already happened. The river work merged after 0.6.4 (`b832fd7` and the fixes after it) changes the islands, so a
0.6.4 save now restores its edits onto new rivers.

The plan:

- **Generation fingerprint.** After generation, hash the base layers (height, ground, water surface, river
  strength, carving, base temperature, vegetation) with an integer hash. Save it as `generation`, a field with a
  default of `null` for old saves. On load, regenerate, hash, and compare. A mismatch marks the save as not
  loadable with the reason "made with an older island", the way `isLoadable` already treats another
  `SAVE_VERSION`. This is a guard, not a migration.
- **The rule.** A pull request that changes generation hashes breaks saves. It must keep the fingerprint guard
  working and say so in the release notes.
- **Long term.** Store the base layers in the save, compressed, so loading no longer depends on generation. It
  costs a few megabytes per save in IndexedDB; decide when saves need to survive generator changes.

Rules for every save change:

- Keep the flat top-level keys of `SimulationSnapshot` and `SAVE_VERSION = 1`. A new key has a default.
- Shape checks stay loose (`z.looseObject`), as in `snapshotShapeSchema` today.
- Restore in an explicit order: world, water recomputation, navigation, then sections in registry order, then
  rules. Sections that need the others restored first use `afterRestore`.
- A section whose saved value fails its schema calls `reset()` and logs a warning. The rest of the save loads.
- Section keys are unique; a test checks it.
- A section never returns live buffers. Transfer detaches them, and the world would lose its fields after a save.
- Saved names, not numbers. Grounds get a name table like plants: `groundNames`, defaulting to today's order,
  with a fallback ground for an unknown name, and a test that `GROUNDS[index].index === index`. The loader
  accepts a layer saved dense or sparse.
- Lava stays in the volcano's section. Fields derived from it, such as `molten`, are rebuilt on restore and not
  saved twice.

Tests that guard it, in step 1:

- Fixtures written by v0.6.4 (`3bced5b`) and by current `main`, serialized with `node:v8`, which keeps typed
  arrays and maps the way IndexedDB does. The v0.6.4 fixture must now be refused by the fingerprint; the `main`
  fixture must load, and its regenerated base hash must equal the stored one.
- Save, load, run N ticks equals running N ticks without the save.
- After a save, the world's buffers are not detached.

## Determinism

What the plan fixes:

- **Streams that don't depend on order.** `RandomSource.derive` draws from its parent, so a derived stream depends
  on how many draws came before. Per-system streams are made with
  `createRandom(mix32(worldSeed, fnv1a32(system.id)))` instead. The root `random` stays for generation, populating
  and saves. A new saved map, `randomStreams`, holds each stream's state; a missing entry is re-derived from the
  seed. Powers and scheduled tasks share one stream, `powers`.
- **An integer hash for chance.** `hashToUnit` is a `Math.sin` hash: it has lattice collisions and depends on the
  engine's `Math.sin`. Reactions use `unitHash(seed, tick, cell, fnv1a32(rule.id))`, built from `Math.imul` and the
  `fmix32` finalizer, in `src/shared/hash.ts`.
- **One explicit order.** Systems run in the order of their list. Rules run in one ordered list per phase, written
  by hand and pinned by a test. No topological sort: rules read and write each other's fields in cycles.
- **Real time stays real time.** Strokes keep running on real seconds, so they work while paused and don't run 16
  times at speed 16. Only element brushes (rain, snow) change: they accumulate exposures with real seconds, and
  the next tick consumes them. Water settling stays frame-driven. Exposures are cleared once, after the tick that
  consumed them.
- **One engine.** Determinism means "within V8". CI pins Node with `.nvmrc` and `actions/setup-node`, and tests
  never run under `bun --bun`.

Steps that change hashes on purpose (per-system streams, new phases, the first reactions) are grouped into one or
two pull requests merged the same day, before one minor release.

## What the research says

**Element interactions.** In the GDC 2017 talk on Breath of the Wild, Takuhiro Dohta describes the chemistry
engine as a rule-based state calculator over elements (fire, water, ice, wind, electricity) and materials (trees,
rocks, the player): elements change materials, elements change each other, and materials don't change materials.
Noita declares reactions in `materials.xml` with input and output cells and a probability, and a reaction may name
a tag such as `[fire]` so one rule covers every material with that tag; it updates only dirty rectangles of 64×64
chunks. The Powder Toy gives each element fields like `Flammable`, `HeatConduct` and `HighTemperatureTransition`,
plus an update function for special cases. Divinity: Original Sin does the same with surfaces: fire on water makes
steam. The lesson: write rules against properties and tags, run them only where something is active, and let
things meet through the cells they stand on.

**ECS libraries.** bitECS 0.4 lets components be any shape, typed arrays included. Koota (0.6.6, active) uses
structure-of-arrays traits with React bindings. Miniplex stores plain objects and has been quiet since July 2023.
Becsy has no multithreading yet. All of them model entities; Dawnfolk's heavy data is a grid of up to millions of
cells, already in typed arrays. We take the ideas (data-only definitions, systems in a fixed order, properties as
data) and keep our stores.

**Frontend structure.** Feature-Sliced Design orders layers `app → pages → widgets → features → entities → shared`
and allows imports only downward, never between slices of one layer. bulletproof-react says the same in fewer
layers, composes features in the app, and avoids barrel files. Both keep tests next to code.

**Modules.** Bevy builds every engine feature as a plugin that adds its systems in one `build` function. Factorio
mods add prototypes to one `data` table before the game starts. The Type Object pattern makes kinds data instead
of classes. The shape for us: a typed record per thread, fixed before the first tick.

**Tooling.** Biome 2.6 has `noRestrictedImports`, `suspicious/noImportCycles`, `style/noExcessiveLinesPerFile` and
`complexity/noExcessiveLinesPerFunction`, both size rules with `skipBlankLines`; the ultracite preset turns some
off, so they are enabled explicitly. dependency-cruiser can forbid one module folder from importing another with a
captured group, as in its `no-inter-ubc` example. Knip finds unused files, exports and dependencies; it resolves
`import.meta.glob` as entries but skips their export analysis, and it does not find cycles.

## Target structure

```
src/
  shared/        math, seeded random, integer hashes, noise, cell sets
  content/       catalogs: biomes, seasons, eras, technologies, resources, plants, animals, buildings, grounds
  world/         grid, terrain, the water rule, coast, footing, island shape
  elements/      fields and their operations, exposures, thing properties, the reaction pass
  generation/    island generation
  simulation/
    core/        Simulation, system runner, save and frame sections, strokes, grabs, scheduler
    nature/      fire, water settling, wetness, snow, wind, weather, embers, succession
    agents/ fauna/ society/ hand/
  mirror/        frame payload types and the world mirror, shared by the engine and the interface
  modules/       optional powers and hazards: tornado, volcano, meteor, earthquake, terraform, wildlife, …
  models/        procedural meshes and animation
  rendering/     renderer, terrain and water layers, vegetation, agents, atmosphere, effects
  audio/         audio context, buses, voices, cues, ambience
  game/          session, camera, input, tools
  stores/        Zustand stores that app, pages and features share (moved out of app)
  design/        design system, with game-aware pieces in design/game
  features/      HUD panels; never import each other
  pages/         game and privacy pages, and the page list
  app/           shell, providers, launch
```

Fire, water, wetness, snow, wind and weather are core: they live in `elements` and `simulation/nature`, because
everything else reacts to them. Modules are the optional powers and hazards on top.

| Layer | May import |
| --- | --- |
| `app`, `pages` | everything below |
| `features` | `stores`, `design`, `mirror`, module `module.ts`, `content` |
| `stores`, `design` | `mirror`, `content`, `shared` |
| `game`, `rendering`, `audio`, `models` | module `engine/` parts, `mirror`, `world`, `content`, `shared` |
| `simulation` | module `simulation/` parts, `elements`, `generation`, `mirror` types, `world`, `content`, `shared` |
| `mirror` | `world`, `content`, `shared` |
| `elements`, `generation` | `world`, `content`, `shared` |
| `world`, `content` | `shared` |

`elements` does not import `WorldState`. It owns the field store, and `WorldState` holds one. Frame payload types
move from `simulation/frame.ts` to `mirror/` before `world-mirror.ts` moves there, so rendering stops importing
`game`. Biome's `noRestrictedImports` enforces this table.

## Modules and registries

### A module folder

```
src/modules/volcano/
  module.ts                  id, power definitions, grounds, icon names; UI-safe metadata only
  simulation/
    volcano-system.ts        the system, the power handler, save and frame sections
    lava-reactions.ts        its reactions
    volcano-system.test.ts
  engine/
    lava-layer.ts            terrain layer: data texture and TSL look
    volcano-cues.ts          sounds
    lava-layer.browser.test.ts
  interface/
    icon.webp
```

The subfolders match `tsconfig` and Biome. `tsconfig.engine.json` includes `src/modules/*/simulation` and
`src/modules/*/engine` (with `noUncheckedIndexedAccess` off for typed arrays). `tsconfig.app.json` includes
`src/modules/*/interface` and `module.ts` files (with it on). Biome overrides give `simulation/` the simulation
rules, `engine/` the engine rules, and `module.ts` only `shared` and `content`. Features may import `module.ts`.
Reactions live on the simulation side, so the interface never sees them.

### Typed registries

Each thread has one record keyed by `ModuleId`, so `tsc` fails when a line is missing:

```ts
// src/modules/module-ids.ts
export const MODULE_IDS = ["tornado", "volcano"] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

// src/modules/simulation-modules.ts
export const SIMULATION_MODULES: { readonly [Id in ModuleId]: SimulationModule<Id> | null } = {
  tornado: tornadoSimulation,
  volcano: volcanoSimulation,
};
```

The same goes for `ENGINE_MODULES` and `INTERFACE_MODULES`. Iteration follows `MODULE_IDS`, never object key
order, so the run order is the order of that list.

```ts
// src/modules/module.ts
export function defineModule<const Definition extends ModuleDefinition>(definition: Definition): Definition {
  return definition;
}

export interface ModuleDefinition {
  readonly id: ModuleId;
  readonly powers?: Readonly<Record<string, PowerDefinition>>;
  readonly grounds?: readonly GroundDefinition[];
}

// src/content/powers.ts
export const POWERS = {
  ...ELEMENT_POWERS,
  ...LAND_POWERS,
  ...LIFE_POWERS,
  ...tornadoModule.powers,
  ...volcanoModule.powers,
} as const satisfies Readonly<Record<string, PowerDefinition>>;

export const POWER_ORDER: readonly PowerId[] = ["fire", "lightning", "rain", "snow", "tornado", "volcano"];
```

`POWER_ORDER` stays explicit, because the dock order is a design choice.

```ts
// src/simulation/core/simulation-module.ts
export interface SimulationModule<Id extends ModuleId, Saved = null, Frame = null> {
  readonly id: Id;
  readonly create: (context: SimulationContext) => ModuleRuntime<Saved, Frame>;
}

export interface ModuleRuntime<Saved, Frame> {
  readonly systems: readonly SimulationSystem[];
  readonly powers: Partial<PowerHandlers>;
  readonly save: SaveSection<Saved> | null;
  readonly frame: FrameSection<Frame> | null;
}

export interface SaveSection<Saved> {
  readonly key: string;
  readonly schema: z.ZodType<Saved>;
  readonly snapshot: () => Saved;
  readonly restore: (saved: Saved) => void;
  readonly reset: () => void;
  readonly afterRestore?: () => void;
}

export interface FrameSection<Frame> {
  readonly key: string;
  readonly build: () => Frame | null;
}
```

- The frame type is derived from `SIMULATION_MODULES` with a mapped type, not by global declaration merging.
- `build` returns `null` when nothing changed. Buffers to transfer are collected with `buffersWithin`, and a
  development check fails when a transferred buffer belongs to a live store.
- `SimulationContext` is narrow: the field store, the world for reading, a random stream, effect and hazard sinks,
  `schedule` and the rules. `PowerServices` stops growing.
- Modules add no commands at first. Powers go through `usePower` and `beginStroke` as now.

### Thing kinds

People, animals, plants and buildings get one core registry, because the hand, the inspector and reactions all
need the same answers about them:

```ts
// src/content/thing-kinds.ts
export const THING_KINDS = ["person", "animal", "plant", "building"] as const;

export type ThingKind = (typeof THING_KINDS)[number];

export const GRABBABLE_KINDS = ["person", "animal", "plant"] as const satisfies readonly ThingKind[];

// src/simulation/hand/thing-simulation.ts
export const THING_SIMULATION: { readonly [Kind in ThingKind]: ThingSimulation } = { … };

export interface ThingSimulation {
  readonly grab: GrabHandler | null;
  readonly inspect: (context: SimulationContext, id: number) => Inspection | null;
}

// src/game/input/thing-engine.ts
export const THING_ENGINE: { readonly [Kind in ThingKind]: ThingEngine } = { … };

export interface ThingEngine {
  readonly candidates: (mirror: WorldMirror, ray: PickRay, out: PickList) => void;
  readonly hoverSpot: (mirror: WorldMirror, id: number) => GroundPoint | null;
  readonly liftPose: LiftPose;
  readonly highlight: (views: WorldViews, id: number | null) => void;
}
```

`grabTargetSchema` uses `z.enum(GRABBABLE_KINDS)`. To make buildings grabbable: add `"building"` to the tuple;
`tsc` then asks for a `grab` handler in `THING_SIMULATION.building` (lift clears occupancy, `canPlace` checks the
footprint with `canStandOn` and `hasRoomFromCoast`, `putBack` restores it), and for `candidates`, `hoverSpot`,
`liftPose` from `hand-motion.ts` and `highlight` in `THING_ENGINE.building`. Nothing else changes.

### Rendering extension points

The renderer gets two extension points, so a module's look does not edit the terrain material:

```ts
export interface TerrainLayer {
  readonly id: string;
  readonly update: (mirror: WorldMirror) => void;
  readonly look: (ground: Node, coordinates: Node) => { readonly color: Node; readonly glow: Node };
}
```

Layers own their data texture and compose in registry order in `terrain-material.ts`. Lava becomes a terrain
layer, and `fire-glow.ts` reads its texture. `WaterLayer` does the same for the water shader. The surface texture
is a fixed RGBA8, so a new field gets its own texture rather than a channel there.

## Properties and reactions

### The model

- **Fields.** One value per cell, persistent: `fire`, `heat`, `wetness`, `snow`, `fuel`, `scorch`, and `molten`
  derived from lava. Each field owns its values, its active `CellSet` and its operations. Ash and basalt are
  grounds, not fields.
- **Exposures.** Per-tick values that emitters stamp: `windX` and `windZ` as a vector, `soak`, `chill`, `blast`.
  They are not saved and are cleared once a tick.
- **Pseudo-inputs.** `water`, through `hasWater` (the one water rule), and `ground`, through `GroundDefinition`
  (`flammability`, `fertility`). A flood that adds water needs no change to a lava rule.
- **Weather** stays one global value per tick, not stamped per cell. Rules read it from the tick.
- **Tags.** Fields carry tags such as `heat-source`, `wet` and `wind`. A rule may read "all fields tagged
  `heat-source`", so a new hot element melts snow by declaring the tag.
- **Thing properties.** Plant, building and animal rows and people declare `flammability`, `windResistance`,
  `heatResistance`.

Emitters only stamp. A tornado stamps a wind vector that swirls around its center. A rain brush stamps `soak`.
Lava sets `molten` and adds heat once when it covers a cell. Scaring animals and danger zones stay emitter calls to
the hazard map; they are not chemistry.

### Fields own their operations

Rules never touch raw arrays. A field's `scale`, `add` and `set` do the clamping, snap fire below the extinguish
threshold to zero, keep the active set right and mark surface rows dirty. `douse` is ported exactly: heat times
`1 - amount`, fire times the same, snapped at `EXTINGUISHED_INTENSITY`. Each field's active set is saved, in its
order, wherever the field is saved, as `FireSnapshot` saves `burning` and `heated` today.

```ts
// src/elements/field.ts
export interface Field {
  readonly name: FieldName;
  readonly tags: readonly FieldTag[];
  readonly active: CellSet;
  readonly value: (cell: number) => number;
  readonly scale: (cell: number, factor: number) => void;
  readonly add: (cell: number, amount: number) => void;
  readonly set: (cell: number, value: number) => void;
}

// src/elements/reaction.ts
export interface Reaction {
  readonly id: string;
  readonly drivenBy: FieldName;
  readonly when: (cells: CellInputs, cell: number) => boolean;
  readonly apply: (cells: CellInputs, cell: number, tick: ReactionTick) => void;
  readonly event: ElementEventKind | null;
}

export interface CellInputs {
  readonly field: (name: FieldName) => Field;
  readonly tagged: (tag: FieldTag) => readonly Field[];
  readonly hasWater: (cell: number) => boolean;
  readonly ground: (cell: number) => GroundDefinition;
}
```

```ts
export const WIND_BLOWS_OUT_FIRE: Reaction = {
  id: "wind-blows-out-fire",
  drivenBy: "windX",
  when: (cells, cell) => {
    return cells.field("fire").value(cell) > 0 && windSpeedAt(cells, cell) > STRONG_WIND;
  },
  apply: (cells, cell, tick) => {
    const remaining = Math.max(0, 1 - BLOWING_OUT_PER_SECOND * windSpeedAt(cells, cell) * tick.seconds);

    cells.field("fire").scale(cell, remaining);
    cells.field("heat").scale(cell, remaining);
  },
  event: "extinguished",
};
```

The first rules: `soak-douses-fire` (rain and snow brushes), `wind-blows-out-fire` (#242's cell loop),
`molten-beside-water` (steam event; replaces `quenchedCell` bookkeeping, and works for any new water),
`heat-source-melts-snow`, and embers and burning buildings adding to `heat`.

### Things respond to their cells

Things are not visited by rules. Each store samples the fields at its things' cells in its own update and calls
one shared helper:

```ts
// src/elements/respond.ts
export function respond(properties: ThingProperties, sample: CellSample, out: ThingResponse): void;

export interface ThingResponse {
  ignite: number;
  douse: number;
  pushX: number;
  pushZ: number;
  isUprooted: boolean;
  damage: number;
}
```

The store applies the standard effects. Held things are skipped in one place, the store's iteration helper.
People and animals have no spatial grid, so they are filtered linearly, which is fine for a few thousand.
Vegetation and buildings walk only the active cells of the exposure, through `plantsInCell` (changed to a visitor
that does not allocate) and `occupancy`. #242's building rule ("a building stays alight while its cell still
burns") becomes `respond` reading `fire` at the building's cell. Thing affects thing only through cells: a burning
hut raises `heat`, the next hut reads it.

### Where, when and how fast

All of it runs in the worker. Today's order stays until one later step adopts the phases:

1. `weather`: calendar and weather.
2. `emit`: brushes, tornadoes, volcanoes stamp fields and exposures.
3. `react`: the reaction pass.
4. `nature`: fire spread, embers, surface, vegetation growth.
5. `life`: buildings, society, rivalry, fauna, hazards; stores call `respond`.
6. `settle`: incidents, splashes; exposures are cleared.

The rule list is compiled once into one array per driving field, and the pass walks only that field's active set.
`when` rejects most cells in one or two reads. Nothing is allocated per tick. Events go into a preallocated buffer
and are merged per kind and 16×16 cell block, and the effect log is bounded at frame build, so a forest fire makes
a few events, not thousands.

Rules apply at once, in list order, as the code does today, so ports can match today's results. Accumulating all
changes and committing them at the end of the pass would make rules independent of their order, but no port
would match; we don't do it.

## Sound

Sound landed in 0.9. It lives on the main thread in `src/audio`; the worker never plays sound. Cues read what
frames, commands and the camera already carry: `frame.effects`, the chronicle, notices, `held`, burning cells, lava,
volcanoes, weather, the calendar and people's poses. Cues move into modules later.

- **Plain Web Audio, no library.** One `AudioContext` in `sound-engine.ts`, created and `resume()`d on the first
  `pointerdown`, `pointerup`, `touchend` or `keydown`; not on `pointermove` or `wheel`, which don't count as
  gestures. Until then, nothing loads. A hidden tab or muted sound suspends the context. The default `ambient`
  audio session is kept, so the iPhone mute switch silences the game.
- **Buses.** `GainNode`s: `master` feeds `effects`, `ambience`, `music` and `interface`. Levels are saved in
  preferences, set in the Sound section of settings and squared, so a slider feels even. A button in the menu
  mutes.
- **Voices.** `AudioBufferSourceNode` into a `PannerNode` (`inverse` distance, `equalpower` panning), capped at 24;
  a new sound takes the weakest voice if its priority times loudness is higher (`voices.ts`). Sounds too quiet to
  hear are skipped. The listener sits on the camera ray, closer to the ground than the camera, and follows it
  through its `AudioParam`s, with `setPosition` as the Firefox fallback. Effects vary their pitch slightly.
- **Layers.** Every sound is one isolated layer and the game mixes them: rain has no thunder, thunder has no rain,
  wind has no birds. `ambience-levels.ts` sets fifteen beds (winds, rain, birds by biome and hour, crickets, frogs,
  cicadas, waves, streams) from biome shares, water and brooks sampled on a 7×7 grid around the view, the weather
  with the renderer's snow rule, the hour, the season and the view distance. Levels are smoothed over seconds; a
  silent bed stops after half a minute.
- **Positional loops.** Burning cells and hot lava group into at most four and three emitters per received frame;
  active craters are emitters too. Tornadoes follow their path; brushes play a loop at the brush.
- **Cues.** `effect-sounds.ts` for effects, with thunder delayed by distance; `power-sounds.ts` for casts, which
  wait for the next frame and stay silent when the power was refused; `story-sounds.ts` for the chronicle, one
  jingle at a time; `work-sounds.ts` for the closest three people chopping, mining, building, digging or fighting,
  timed to their animation's strike; `interface-sounds.ts` for clicks, tabs, panels and the chosen power.
- **Music.** `music-player.ts` streams one track at a time through `MediaElementAudioSourceNode`, picked by the
  hour, never the same twice, with a fade in and a rest of 45 to 120 seconds between tracks.
- **Assets.** Opus in WebM only; WebGPU already needs Safari 26, which decodes it. A sound that fails to decode
  stays silent. One-shots are mono at 48 kbps, music stereo at 64 kbps. Masters and their prompts stay outside the
  repository; `bun run sounds <folder>` trims, levels by loudness and encodes them with `ffmpeg`, and the catalog in
  `sound-catalog.ts` uses `new URL("./sounds/x.webm", import.meta.url).href`, so Vite hashes the files. The sounds
  are not under the MIT license.

```ts
export interface SoundDefinition {
  readonly bus: SoundBus;
  readonly files: readonly string[];
  readonly isLoop: boolean;
  readonly priority: number;
  readonly referenceDistance: number;
  readonly volume: number;
}
```

`play` takes the definition object, so a typo is a type error. A `referenceDistance` of zero means the sound is not
placed. Variations are picked with `Math.random`, which effects may use.

Not three.js `PositionalAudio`: it ties sounds to scene-graph objects. Not Howler.js: its unlock and HTML5 fallback
are not needed for short buffers, and it has no voice cap. Not Tone.js: it is for synthesized music.

## Pages, tests and limits

### Pages

Vite stays multi-page. `src/pages/pages.ts` lists the pages, and `vite.config.ts` builds
`rollupOptions.input` from that list:

```ts
export const PAGES = [
  { html: "index.html", name: "main" },
  { html: "privacy/index.html", name: "privacy" },
] as const;
```

`src/privacy.tsx` and `src/features/privacy` move to `src/pages/privacy/`. The HTML shell stays at
`privacy/index.html`, because Vite writes each page at its source path and the URL is `/privacy/`. `base: "./"`
has been there since the first commit (`a0cb83b`) and stays; it only matters if we ever turn into a single-page
app, which we don't.

### Tests

- Tests stay next to the code, with the same suffixes.
- New in step 1: `world-hashes.test.ts`, `saved-worlds.test.ts` and the fixtures (see
  [Saves](#saves-come-first)).
- Renaming `worker/` to `server/` and `tests/` to `e2e/` and `scripts/` is optional. If it happens, it happens in
  a quiet hour, as one pull request merged at once.

### Limits that stop the dump

They start as errors, with an override in `biome.jsonc` listing today's offenders. The list is the to-do list; a
file leaves it when it is split, and nothing new joins it.

| Limit | Tool |
| --- | --- |
| A source file has at most 400 lines, blank lines not counted; catalogs 600; tests 800 | `style/noExcessiveLinesPerFile` |
| A function has at most 60 lines, blank lines not counted; tests excluded | `complexity/noExcessiveLinesPerFunction` |
| No import cycles | `suspicious/noImportCycles` |
| Layers import only downward | `noRestrictedImports` per folder |
| A module folder never imports another | dependency-cruiser with a captured group, once a second module exists |
| A folder has at most 12 non-test files; then it gets subfolders by concept | a small Node test |
| No unused files, exports or dependencies | Knip |
| Every module and thing kind is registered | `tsc`, through the typed records |

## Migration

Each step is one pull request that passes `check`, `typecheck`, `knip` and `test`, and keeps world hashes unless
it says otherwise. The repository merges 30 to 100 pull requests a day, so move pull requests are short-lived and
merged the same day. Moves use a ts-morph script (`sourceFile.move()` rewrites imports) that stays re-runnable: on
a conflict, rebase and run it again instead of resolving by hand.

Honest size: about 38 pull requests and 20 000 to 35 000 changed lines, 4 to 6 weeks at agent pace. The numbered
steps below are the main ones; splits and power moves add the rest.

### First: the safety net

1. **Pinned hashes and save fixtures.** M. Hash every generated layer, the vegetation store, water features and
   crossings for seeds 3, 7 and 11 on both shapes on small grids, plus one slow 640-cell world. Hash the snapshot
   after 600 ticks of scripted commands. Add the v0.6.4 and `main` save fixtures and the save tests. Verify: a 1%
   change to an erosion constant fails the test.
2. **Generation fingerprint.** S. Save `generation`, compare on load, refuse with a reason. Verify: the v0.6.4
   fixture is refused, the `main` fixture loads.
3. **Pin Node and the limits.** S. `.nvmrc`, `actions/setup-node` in CI, and the Biome rules as errors with the
   offender overrides.

### Then: one power registry, saves, systems, first reactions

4. **One power registry without moving files.** M. `POWERS` spread from per-family `as const` records, with icon
   names and handlers keyed the same way; `power-icons.tsx` and the separate schema map go away. Verify: the dock
   tests; hashes unchanged.
5. **Save sections.** M. Systems return `SaveSection`s; `snapshot()` and `restore()` loop in the explicit order;
   invalid sections reset. Verify: fixtures load; the unique-key test.
6. **Ground name table.** S. Verify: fixtures load; `GROUNDS[index].index === index`.
7. **Systems runner.** M. `Simulation.step` runs a list in today's exact order: weather, fire, embers, tornadoes,
   volcanoes, surface, vegetation growth, buildings, society, rivalry, fauna, hazards, crowding, incidents,
   splashes. Verify: hashes unchanged.
8. **Order-independent streams.** S. `shared/hash.ts`, per-system streams, `randomStreams` in saves. Hashes change.
9. **Field operations.** M. Fields own `scale`, `add`, `set` and their active sets; `douse` is ported exactly.
   Verify: hashes unchanged.
10. **Phases and the first reactions.** L. Adopt the phases, add exposures, the pass and the event buffer, and
    port rain and snow dousing and the tornado (#242's cell loop and its building rule through `respond`). The
    #242 tests must pass unchanged. Hashes change.

Steps 8 and 10 are merged the same day and released as one minor version, with release notes that say worlds play
out differently from the same seed.

### Then, as they pay off

11. **Lava, embers, building heat.** M to L. `molten` derived from the volcano section, the steam event, embers and
    buildings adding to `heat`. Verify: lava at a river still stops and steams near and far; volcano tests pass.
12. **Frame sections.** M. Lava, volcanoes and `held` first. Verify: frame time at seed 7 unchanged within noise.
13. **The `mirror` layer.** M. Frame payload types, then `world-mirror.ts`; Biome rules for the new table.
14. **Stores out of `app`, features apart.** M. Shared stores to `stores`; game-aware pieces such as `tribe-dot`
    and `stock-list` to `design/game`.
15. **Pages list.** S. Verify: `/` and `/privacy/` on `bun run preview`; privacy screenshots at the three sizes.
16. **Sound, first version.** Done in 0.9: core, buses, settings, unlock, cues, beds and music. Verify: no
    `AudioContext` before a gesture (a browser test); each cue in Chrome, Safari and Firefox; first-load size
    unchanged.
17. **Thing kinds.** M. When the next grabbable kind arrives, not before.
18. **Module folders.** New powers go into `src/modules` from now on. The tornado and the volcano move when they are
    next changed. dependency-cruiser's module rule lands with the second module.
19. **Terrain and water layers.** M. Lava as the first terrain layer.
20. **Positional sound loops.** Fire, lava and craters done in 0.9; rivers and waterfalls are left. Verify: a
    burning forest stays under the voice cap; no allocation per frame.
21. **Split large files.** S each, when a file is next changed; the override list tracks what is left.

## Checklists

### A new power or hazard

1. Make `src/modules/<name>/module.ts` with `defineModule`: powers, grounds, icon names.
2. Write `simulation/`: a system that stamps fields or exposures in `emit`, and its reactions. Don't call other
   systems. If it should affect something, write a rule against a property or a tag.
3. Add `engine/` (terrain or water layer, effects, cues) and `interface/icon.webp`.
4. Add the id to `MODULE_IDS`; `tsc` lists the records to fill.
5. If it saves state, give it a `SaveSection` with a `reset()` default.
6. Write tests next to the files, one per rule. Check that the pinned rule order and hashes change only as meant.
7. Look at a near and a far scene; add a scene to `tests/scenes.ts` if the change shows only by eye.

### A new grabbable kind

1. Add the kind to `GRABBABLE_KINDS` (and to `THING_KINDS` if it is new).
2. Fill what `tsc` asks for in `THING_SIMULATION` and `THING_ENGINE`.
3. Give it `ThingProperties`, so wind, fire and water affect it.
4. Write a grab test like those in `grab-handlers.test.ts`.

### A new page

1. Make `src/pages/<name>/` with the page and its entry, and the HTML shell at the URL path.
2. Add it to `PAGES` and to `public/sitemap.xml`.

### A change to generation

1. The hash test fails; update it on purpose.
2. Keep the fingerprint guard working, and say in the release notes that older saves won't load.

## What we deliberately don't do

- **No ECS library and no full rewrite.** The grid is already structure-of-arrays.
- **No event bus inside the worker.** Interactions go through fields and rules in a known order. Events flow one
  way, to the main thread.
- **No registration by file glob, no topological rule order.** The order is in lists people read.
- **No per-version save migrations.** Saves keep names, new state has a default, and generation changes are
  refused by the fingerprint instead of patched.
- **No single-page app and no router.** Two pages don't need one.
- **No module commands yet.** Powers use the existing commands.
- **No big-bang moves.** Old powers move into modules when they are next touched; folder renames are optional.
- **No Howler, no Tone, no AAC until someone needs it.**
- **No GPU compute for reactions.** The active sets keep the pass small.
- **Catalogs stay catalogs.** A plant species or building kind is a row with properties, not a module.

## Sources

- [Change and Constant: Breaking Conventions with The Legend of Zelda: Breath of the Wild, GDC 2017, recording](https://www.youtube.com/watch?v=QyMsF31NdNc)
- [GDC 17: Breath of the Wild, science and lies, Thumbsticks](https://www.thumbsticks.com/gdc-17-breath-of-the-wild-science-lies)
- [Exploring the Tech and Design of Noita, Petri Purho, GDC 2019](https://www.gdcvault.com/play/1025695/Exploring-the-Tech-and-Design)
- [Noita, a game based on falling sand simulation, 80.lv](https://80.lv/articles/noita-a-game-based-on-falling-sand-simulation/)
- [Noita Wiki: Making a custom material](https://noita.wiki.gg/wiki/Modding:_Making_a_custom_material)
- [Noita Wiki: Reaction](https://noita.wiki.gg/wiki/Documentation:_Reaction)
- [The Powder Toy: WATR element source](https://github.com/The-Powder-Toy/The-Powder-Toy/blob/master/src/simulation/elements/WATR.cpp)
- [Divinity: Original Sin environmental effects](https://divinity-archive.fandom.com/wiki/Divinity:_Original_Sin_environmental_effects?oldid=4396)
- [bitECS](https://github.com/NateTheGreatt/bitECS)
- [Koota](https://github.com/pmndrs/koota)
- [Miniplex](https://github.com/hmans/miniplex)
- [Becsy guide](https://lastolivegames.github.io/becsy/guide/introduction)
- [Bevy: Plugins](https://bevy.org/learn/quick-start/getting-started/plugins/)
- [Factorio: Data lifecycle](https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html)
- [Game Programming Patterns: Type Object](https://gameprogrammingpatterns.com/type-object.html)
- [Feature-Sliced Design: Overview](https://feature-sliced.design/docs/get-started/overview)
- [bulletproof-react: Project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [Biome: noRestrictedImports](https://biomejs.dev/linter/rules/no-restricted-imports/)
- [Biome: noImportCycles](https://biomejs.dev/linter/rules/no-import-cycles/)
- [Biome: noExcessiveLinesPerFile](https://biomejs.dev/linter/rules/no-excessive-lines-per-file/)
- [Biome: noExcessiveLinesPerFunction](https://biomejs.dev/linter/rules/no-excessive-lines-per-function/)
- [dependency-cruiser: Rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
- [Knip: Configuration](https://knip.dev/reference/configuration)
- [Vite: Multi-page app](https://vite.dev/guide/build#multi-page-app)
- [Cloudflare Workers: Single-page application routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [React: title](https://react.dev/reference/react-dom/components/title)
- [MDN: Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [MDN: Web audio codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)
- [Can I use: Opus](https://caniuse.com/opus)
- [WebKit bug 226922](https://bugs.webkit.org/show_bug.cgi?id=226922)
- [WebKit bug 245428](https://bugs.webkit.org/show_bug.cgi?id=245428)
- [three.js: PositionalAudio](https://threejs.org/docs/#api/en/audio/PositionalAudio)
- [howler.js](https://github.com/goldfire/howler.js)
- [Tone.js](https://github.com/Tonejs/Tone.js)
