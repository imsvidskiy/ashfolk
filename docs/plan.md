# Architecture plan

This plan rewrites Ashfolk's structure so that a power, hazard, thing kind, tribe system or page is one folder plus a
few typed registry lines, so that every thing and every cell exposes declared properties, and so that any system can
ask "what is around here" through one typed, fast, deterministic API. It keeps the rules in
[AGENTS.md](../AGENTS.md#rules-that-are-easy-to-miss): the engine never imports React, the simulation never imports
rendering, generation and the simulation are deterministic for a seed, commands are validated at the worker boundary,
saves keep loading, and large stores stay in typed arrays.

It replaces the previous plan. It was chosen from three competing designs (data-oriented evolution, ECS-first and
workspace packages), each attacked by five critics on determinism, performance, extensibility, migration and
simplicity, then checked by four validators against `main` at v0.10.0. When it lands in the repository it splits in
two: [Plan on a page](#plan-on-a-page) becomes `docs/plan.md`, and each later section becomes a file in
`docs/architecture/`, with migration steps as PR cards that `/ship` and agents cite by id.

## Contents

- [Plan on a page](#plan-on-a-page)
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
- [Deleted by the end](#deleted-by-the-end)
- [What we deliberately don't do](#what-we-deliberately-dont-do)
- [Risks and open decisions](#risks-and-open-decisions)
- [Sources](#sources)

## Plan on a page

**Layers.** Four layers, an assembly list and modules. Imports only go down.

```
interface    design → stores → panels → app → pages
engine       bridge → mirror → models → render, audio → input → runtime
simulation   kernel → state → queries → rules → api → systems → runtime
core         foundation → catalog → world → protocol
assembly     MODULES, the base catalog compile, POWER_ORDER
modules      <domain>/<name>/ with module.ts, shared/, simulation/, engine/, interface/
server       the Cloudflare worker
```

`interface` is the React HUD; `engine` is the main thread without React; `simulation` is the deterministic worker;
`core` is pure TypeScript for both threads; `server` imports only `core/foundation` and `core/protocol`.

**Five concepts.**

1. **Fields and cell properties.** Every cell value (fire, heat, wetness, acid) is a declared field; derived values
   (effective biome, walkable, flammability) are compiled cell properties.
2. **Things with kinds.** Plants, animals, buildings, people, transients (tornadoes, meteors, embers) and features
   (crossings, deposits, bridges) answer one `ThingSource` interface. Kinds carry tags, numeric properties and traits.
3. **Three effect channels.** Cells (fields and reactions), `strike` (force and harm on an area) and events (facts).
   Module code reaches core only through typed `ModuleContext` services.
4. **One query API.** `Surroundings` answers "what is here" with a fixed order and no allocation.
5. **Commands in, frames out, saves by section.** Stamped commands drive the worker; frames and saves are built from
   sections that modules contribute; saves describe themselves with name tables.

**The tornado in one breath.** Each tick it measures its disc once (`dominantBiome`, trees by species, fire, people
by tribe), grows over water and slows in forest, stamps a gust that blows fires out through a reaction, and strikes
movers and buildings scaled by their mass and wind resistance. It edits nothing outside `modules/hazards/tornado`.

**Phases.** 0 safety net → S saves (newer-save guard and `WorldBase` first) → M moves → K kernel → Q queries with C
catalog → R rules → T tribes → X module extraction, with D determinism, E engine, I interface and G goals alongside.
About 110–140 PRs over 9–13 weeks at agent pace; main deploys green through every step.

## Goals

Each goal answers one of the owner's asks and names the test that shows it is met.

| Ask | Goal | Done when |
| --- | --- | --- |
| Modular | A power, hazard, thing kind, tribe system or page is one folder plus typed registration lines. Only the assembly lists name modules. | The four [walkthroughs](#walkthroughs) hold with the outside edits they state; a test boots every module and fails on an unregistered handle. |
| Properties everywhere | Cells expose fields and derived properties; things expose kinds, tags, flags, properties and traits. Effects go through cells, `strike` and events, never per-pair calls. | No `fire.douse`, `buildings.blowOut`, `damageArea` or `isTreeSpecies` call outside their owners; one test per rule. |
| Context queries | One `Surroundings` API answers cell reads, area measures and thing queries with a fixed tie order and no allocation, in the worker, with a mirrored subset on the main thread. | The tornado's whole `rage()` reads biome, trees by species, fire and people for under 25 µs at radius 140 m (bench). |
| Not flat and huge | Four layers with a few sublayers each, modules grouped by domain, at most four folders deep under `src/`. | The tree below; a boundaries check that fails on a wrong import, type-only imports and `new URL` included. |
| Packages | Drop what earns nothing, add only what removes work. | Comlink, react-markdown and remark-gfm gone; `zod/mini`; no new runtime dependency. |
| Deep rewrite | The kernel, saves, frames, queries, rules and composition are rewritten; leaf code moves once by script. | Main deploys green through every step; saves from 0.8 load at every step. |

## Why this design

The base is the data-oriented evolution. It scored highest (mean 5.2, against 5.0 for ECS-first and 4.8 for
packages), and it was the strongest on determinism and saves. Its weakest lenses were migration (4) and simplicity
(5), so most grafts fix those.

| Taken from | What |
| --- | --- |
| Evolve | Typed-array fields with active sets; the SoA `VegetationStore`; layers plus modules; the field / cell property / exposure split; `Surroundings` with a fixed tie order; `strike`; save and frame sections; name tables with `formerNames`; `WorldBase`; exact math; commands only; a typed event queue. |
| ECS-first | One compiled kind catalog with per-kind property arrays; the generational slot for plants; event-driven thing responses; the kind manifest that both threads read; the rule that state is either saved or derived. |
| Packages | A throwaway spike before risky moves; one ordered list of systems pinned by a test; module-owned standard events in the catalog; generic events with a `cause`; the worker-closure check; fields and exposures merged into one concept. |
| Critics and validators | Canonical iteration orders; a logical save schema behind one frozen legacy reader; lossless `WorldBase`; batch reaction kernels; no dense drivers; numeric bench gates; typed handles; an assembly layer; declarations apart from behavior; erased runtimes instead of generic arrays; facades before storage changes; each file moves once; turns in wall time; a step counter apart from game time. |

Rejected: workspace packages (about 90 tsconfigs and a lockfile edit per module, for nothing that composite projects
and a boundaries check don't give), a generic column store for people and animals (a rewrite of the busiest folder
with no measured need), and closures per cell in the reaction pass (4.5–12× slower than a direct loop,
`bench/critic-perf/evolve-perf.mjs` section A).

### From plan.md to this plan

| plan.md | This plan | Why |
| --- | --- | --- |
| 17 top-level folders (`shared`, `content`, `world`, `elements`, `generation`, `simulation`, `mirror`, `modules`, `models`, `rendering`, `audio`, `game`, `stores`, `design`, `features`, `pages`, `app`) | `core`, `simulation`, `engine`, `interface`, plus `assembly`, `modules` and `server` | The owner found the flat list huge |
| `elements/` for fields, exposures and the reaction pass | Field declarations in `core/catalog`; stores and passes in `simulation/state` and `rules` | Declarations are data both threads need; passes are worker-only |
| `mirror/` shared by engine and interface | `engine/mirror` with typed section readers; frame shapes in `core/protocol` | The interface subscribes to readers instead of importing engine internals |
| `features/` | `interface/panels` with a `PANELS` registry | Tabs, menus and resets derive from one list |
| Layers enforced by `noRestrictedImports` | Composite projects plus `bun run boundaries` | The table needs type-only imports and `new URL` edges |
| Comlink kept | Removed | Lockstep needs messages, not a proxy |
| Save sections and a ground name table | Logical schema, name tables for every index-coded catalog, `WorldBase` | No per-version remaps; generator changes stop breaking saves |
| A systems runner in today's order | Phases with a pinned order and a step clock apart from game time | Pause, replays and lockstep |
| No event bus in the worker | A typed queue of facts, drained once per step | Chronicle, effects, sounds and listeners need one channel; facts are never requests |
| Out: renaming folders that work | Every file moves once, to its final path | The layer graph needs it |
| Kept | No ECS, no globs, no topological sort, no router, no GPU compute for reactions, facades first, moves by a ts-morph script | Still right |
| About 38 PRs, 4–6 weeks | 110–140 PRs, 9–13 weeks | Saves, kernel, queries and modules are in scope |

## Principles

1. **Four layers, the assembly list and modules.** `core` at the bottom, `simulation` and `engine` above it,
   `interface` on top. A module cuts across them with one folder per side. Imports only go down, and sublayers only
   import lower sublayers.
2. **Data in typed arrays, behavior in systems, meaning in the catalog.** A kind is a row with tags and numbers. Code
   reads properties and tags, never lists of kinds.
3. **Three effect channels between modules, typed services with core.**
   - **Cells:** emitters write fields; reactions turn fields into fields; things respond to the cells they stand on.
   - **`strike`:** force and harm on the things in an area, scaled by their properties.
   - **Events:** facts for the chronicle, effects, sounds and other modules' listeners. An event is never a request.

   Core actions (`strikeLightning`, `explode`, `shakeLand`, `kill`, `spawn`, terrain edits) are `ModuleContext`
   services. Every other hook is one of the named extension points in [Choosing a mechanism](#choosing-a-mechanism).
4. **Declarations are data; behavior binds to them.** Fields, kinds, tags, flags, properties, traits, columns, events,
   commands, damage types and death causes are declared as data in `core/catalog`, a `module.ts` or a module's
   `shared/`, so both threads see them. Simulation code binds behavior by handle: `respondTo`, `handleCommand`,
   `listen`, reactions.
5. **One way to ask "what is here".** `Surroundings`, with a fixed order, no random draws and no allocation.
6. **Commands in, frames out.** The simulation takes stamped commands. Real time lives in the tick source only.
7. **Every engine gives the same result.** Exact math, order-free hashes, named streams, canonical iteration orders.
8. **State is saved or derived.** Every structure says which. Derived means a pure function of saved state, rebuilt
   the same way live and after a load. Saves describe themselves: name tables, defaults, no per-version remaps.
9. **Explicit, typed lists.** No globs, no declaration merging, no topological sort. Order lives in lists people read,
   precedence lives in data, and tests pin both.
10. **Facades first, storage later.** A new interface lands over today's stores without changing hashes. Storage and
    behavior change in labeled PRs.

Names mean one thing each. `core` is only the bottom layer; the systems everything reacts to are **built-in systems**
(`BUILT_IN_SYSTEMS`). `step` is only the clock counter; a system's method is `run`. "Outside edits" are edits to files
outside the module.

## Target structure

### The tree

```
src/
  core/                            pure TypeScript for both threads; no DOM, three, React or zustand
    foundation/                    exact-math, hash (unitHash), random streams, noise, cell-set, bitset, buffers, ignore
    catalog/                       handles/ (define-field, define-tag, declare-trait…), land/ (biomes, grounds,
                                   weather, seasons, world-rules, deposits, landmarks), beings/ (plant species,
                                   animals, life stages, names), making/ (buildings, crops, cultivated plants, recipes,
                                   weapons, monuments), culture/ (technologies, eras, resources, parameters), names/
    world/                         terrain/ (grid, sampling, footing, coast, outline, island shape, climate rules),
                                   water/ (hasWater, brooks, ponds, the hydrology cluster, crossings),
                                   vegetation/ (store, planting rules), spatial/ (radial pattern, waypoint),
                                   queries/ (cell reader, cell properties, cell filters, area query descriptors),
                                   world-reader.ts, generation-fingerprint.ts
    protocol/                      generic message, frame and save envelope shapes; codecs; view types the main
                                   thread reads (inspection, calendar, rivalry, relations, raids, speeds)
    testing/
  assembly/                        MODULES, the base catalog compile, POWER_ORDER, the assembled protocol types
  simulation/                      worker only, deterministic
    kernel/                        clock, phases, tick source, event queue, sections, hasher, streams, tasks
    state/                         cells/ (field store), things/ (sources, transients, features, columns),
                                   tribes/, derived/ (water, walkability, navigation, crossings), world-state.ts
    queries/                       thing queries, mover buckets, the assembled Surroundings
    rules/                         reaction pass, strike, trait responses, core actions (explode, shakeLand,
                                   strikeLightning)
    api/                           ModuleContext, SimulationModule, ModuleRuntime: all a module side sees
    systems/
      nature/                      calendar, weather, wind, fire, embers, surface, water settling, growth
      agents/                      movement, navigation, crowding, mover
      fauna/                       herds, brains by kind tag
      society/                     tribe/, camp/, economy/, construction/, farming/, needs/, jobs/
      rivalry/                     relations/, territory/, raids/, combat/
      hand/  chronicle/
    generation/                    generateWorld and its stages
    runtime/                       composition, BUILT_IN_SYSTEMS, worker entry
    testing/
  engine/                          main thread, no React
    bridge/                        protocol client, session
    mirror/                        WorldMirror (a WorldReader), mirror sections, typed section readers
    models/                        mesh/, rig/, plants/, animals/, people/, structures/
    render/                        base/ (renderer, stages, node helpers, hashToUnit), layers/, presenters/
    audio/                         engine, buses, voices, ambience, parts, generated sound catalog
    input/                         camera, pointer, picking, tools
    runtime/                       GameEngine, ENGINE_MODULES, presenter records, frame pacer, resolution governor,
                                   filming, landmarks, label projector, dev handle
    testing/
  interface/                       React; noUncheckedIndexedAccess on
    design/                        primitives, islands, game-icon, settings-group, backdrops
    stores/                        every store more than one panel reads
    panels/                        dock, journal, inspector, minimap, settings, tribes, time, notices…
    app/                           shell, launcher, HUD layouts, PANELS, INSPECTORS, message-table aggregate
    pages/                         game, privacy, pages.ts
    testing/
  modules/
    elements/                      fire-brush, lightning, rain, snow
    hazards/                       explosion, meteor, earthquake, volcano, tornado
    land/                          terraform, forest, paint
    life/                          tribe-spawn, wildlife, blessings
    tribes/                        sickness, trade, beliefs (later)
    things/                        boat, bridges (later)
server/                            the Cloudflare worker: redirects, media ranges, later sign-in, relay, cloud saves
tests/                             Playwright and the `shots` scenes
```

A module folder holds only the sides it has. `<module>` below means `modules/<domain>/<name>`:

```
modules/hazards/tornado/
  module.ts            manifest: id, sides, requires, powers, catalog contribution, commands, icon URL, message ids
  messages.ts          { en, ru } message tables
  shared/              tornado-path.ts (pure, both threads), tornado-frame.ts (payload type), tornado-catalog.ts
  simulation/          tornado-system.ts, tornado-power.ts, tornado-simulation.ts, tests
  engine/              tornado-funnel-layer.ts, tornado-cue.ts, tornado.webm, tornado-engine.ts
```

**Built-in or module.** Built-in is what everything reacts to or acts on and cannot be removed: calendar, weather,
wind, fire, embers, surface (wetness, snow, scorch), water settling, vegetation growth and succession, movement and
navigation, crowding, fauna, society, rivalry, the hand and the chronicle. A module is anything you can delete without
breaking a built-in rule: every power, hazard and spawn, and later sickness, trade, beliefs, boats and bridges.
Natural lightning stays in weather and calls the core action `strikeLightning`, which the lightning module calls too.
Rivalry may become a module once tribe extension points exist ([open decision 5](#open-decisions-for-the-owner)). A
data-only species stays a catalog row.

### Old to new

| Today | Target |
| --- | --- |
| `src/shared` | `core/foundation`; the `Math.sin` `hashToUnit` goes to `engine/render/base` for rendering and models |
| `src/content` | `core/catalog/*`; `powers.ts` splits into module manifests and `assembly` `POWER_ORDER` |
| `src/world` | `core/world` |
| `src/generation` | `simulation/generation`; rules the runtime also calls go to `core/world` (below) |
| `src/simulation/{simulation,tick,commands,command-handlers,saved-world,identifiers,effects}.ts` | `simulation/kernel` and `runtime`; view types to `core/protocol` |
| `src/simulation/{frame,frame-builder,frame-packing,inspection,chronicle}.ts` | `core/protocol`, `simulation/kernel`, `systems/chronicle` |
| `src/simulation/world` | `simulation/state` and `state/derived` |
| `src/simulation/{nature,agents,fauna,society,hand}` | `simulation/systems/*`; `society/rivalry` to `systems/rivalry` |
| `src/simulation/powers` | `modules/*/*/simulation`, after the split PRs (M5) |
| `src/workers` | `simulation/runtime`; `island-sketch` to `simulation/generation` |
| `src/game` | `engine/bridge` (session, connection), `engine/mirror`, `engine/input` (camera, input, tools), `engine/runtime` (the rest) |
| `src/rendering`, `src/models`, `src/audio` | `engine/render`, `engine/models` (with `rig`), `engine/audio` |
| `src/design`, `src/features`, `src/app` | `interface/design`, `interface/panels` (shared stores to `interface/stores`), `interface/app` (backdrops to `design`) |
| `src/main.tsx`, `src/privacy.tsx`, `index.html`, `privacy/index.html` | `interface/pages`; the HTML entries are rewritten by the move script |
| every `testing/` folder | `<layer>/testing` |
| `worker/` | `server/` |

The rules generation and the runtime share move to `core/world`: `plantHeight`, `clearingAt` and `plantingChance`
(today `generation/vegetation.ts`), `pondShoreReach`, `altitudeChill`, `generationFingerprint`, and the hydrology
cluster that `computeHydrology` and `refreshCrossings` pull in: `hydrology`, `drainage`, `river-carving`,
`river-chains`, `river-paths`, `river-spacing`, `springs`, `ponds`, `crossings` and `bank-regions` (about 1,570 lines
in the first three alone). All of it is reachable from `generateWorld`, so it changes only in D5.

### Powers to modules

| Power ids | Module | Today |
| --- | --- | --- |
| `fire` | `elements/fire-brush` | `element-powers.ts` |
| `lightning` | `elements/lightning` | `element-powers.ts`; `strikeLightning` in `catastrophes.ts` becomes a core action |
| `rain`, `snow` | `elements/rain`, `elements/snow` | `element-powers.ts` |
| `explosion`, `meteor` | `hazards/explosion`, `hazards/meteor` | `element-powers.ts`; `explode` becomes a core action both use |
| `earthquake` | `hazards/earthquake` | `element-powers.ts`; `shakeLand` becomes a core action |
| `volcano`, `tornado` | `hazards/volcano`, `hazards/tornado` | `element-powers.ts`, `volcanoes.ts`, `tornadoes.ts` |
| `raise`, `lower`, `flatten`, `smooth` | `land/terraform` | `land-powers.ts` |
| `forest`, `paint` | `land/forest`, `land/paint` | `land-powers.ts` |
| `tribe` | `life/tribe-spawn` | `life-powers.ts` |
| `deer`, `mammoth`, `ibex`, `hare`, `wolf` | `life/wildlife` | `life-powers.ts` |
| `abundance`, `inspiration`, `healing` | `life/blessings` | `life-powers.ts` |

### Layers

| Code | May import |
| --- | --- |
| `core/foundation` | nothing in `src` |
| `core/catalog` | `foundation` |
| `core/world` | `foundation`, `catalog` |
| `core/protocol` | `foundation`, `catalog`, `world` types; generic shapes only |
| `<module>/module.ts`, `<module>/shared` | `core`, the `shared/` of modules it `requires` |
| `assembly` | `core`, every `module.ts` and `shared/` |
| `simulation/kernel` → `state` → `queries` → `rules` → `api` | lower sublayers, `core`, `assembly` |
| `simulation/generation` | `core` |
| `simulation/systems/*` | `api` and below; another system only through its `*-api.ts`; `generation` only for `world-generator` |
| `<module>/simulation` | `simulation/api` and below, own `module.ts` and `shared/`, required modules' `shared/` |
| `simulation/runtime` | all of `simulation`, every `<module>/simulation` |
| `engine/bridge` → `mirror` → `models` → `render`, `audio` → `input` | lower sublayers, `core`, `assembly` |
| `<module>/engine` | `engine/{mirror,models,render,audio}`, own manifest and `shared/` |
| `engine/runtime` | all of `engine`, every `<module>/engine` |
| `interface/design` → `stores` → `panels` | lower sublayers, `core`, `assembly`, `engine/bridge` handle types, `engine/mirror` readers |
| `<module>/interface` | `interface/{design,stores}`, `engine/mirror` readers, own manifest and `shared/` |
| `interface/app` → `pages` | all of `interface`, `engine/runtime`, every `<module>/interface` |
| `server` | `core/foundation`, `core/protocol` |
| `<layer>/testing` | its layer and lower layers; imported only by test files |

Panels never import panels. About 70 imports cross system folders today, 66 of them inside what plan.md called life
(47 society → agents, mostly `Waypoint` and `Mover`); `Waypoint` moves to `core/world`, and the rest go through
`*-api.ts` files that M6 creates.

### How it is enforced

Each rule has one owner.

1. **Composite tsconfig projects**: `core` (with `assembly`, `module.ts` and `shared/`), `simulation` (with
   `<module>/simulation`), `engine` (with `<module>/engine`), `interface` (with `<module>/interface`), `server` (with
   Workers types) and `node` (scripts, `tests/`, `vite.config.ts`). Tests stay in their layer's project, as today, so
   `core`, `simulation` and `engine` tests keep `noUncheckedIndexedAccess` off and `interface` tests keep it on.
   References follow the table, and TS6202 rejects a cycle.
2. **`bun run boundaries`** owns imports. It reads every file with `ts.preProcessFile`, which reports type-only
   imports and re-exports, plus a pass for `new URL("…", import.meta.url)`; it strips `?raw` and other query suffixes
   before resolving. `Bun.Transpiler.scanImports` drops `import type` and never reports `new URL`, so it serves only
   the worker-reachability check, where type imports really are erased. The script checks the layer table, `requires`
   between modules (acyclic), panels apart, `*-api.ts` between systems, that nothing reachable from the worker entry
   reaches `three`, `react` or `zustand`, and that every file reachable from the worker entry sits inside Grit's
   scope. A test plants a type-only import and a `new URL` edge and expects both reported. It starts in report mode
   with an allowlist file that may only shrink.
3. **Biome and Grit** own syntax. `deterministic.grit`, scoped to `core/{foundation,catalog,world}`, `simulation/**`,
   `<module>/{module.ts,shared,simulation}` and `assembly`, allows only the `Math` calls `abs`, `ceil`, `floor`,
   `round`, `trunc`, `sign`, `min`, `max`, `sqrt`, `fround`, `imul` and `clz32` plus the `Math` value properties
   (`PI`, `E`, `SQRT2`, `SQRT1_2`, `LN2`, `LN10`, `LOG2E`, `LOG10E`), and bans `**`, `Math.random`, `Date`,
   `performance`, timers, `Intl` and `toLocale*`. A second rule bans module-scope tables built from catalogs
   (`Float64Array.from(GROUNDS, …)`, `PLANT_SPECIES.map(…)`) in `core`, `simulation` and `engine` code.
   `noRestrictedGlobals` keeps DOM globals out of `engine/render`. `noRestrictedImports` stays only for bare-package
   feedback in the editor.
4. **Tests** for what types can't see: every registered handle resolves (`modules.test.ts` boots every module), the
   system order fingerprint, frame and mirror keys match, save section keys are unique, every `JobKind` has a
   definition, sounds are all referenced, and a catalog with one extra ground and one extra species runs a day with no
   `NaN` and no undefined lookup.

## Core model

### Choosing a mechanism

| You want | Use | Example |
| --- | --- | --- |
| A value per cell that lasts | Persistent field | fire, acid, germs |
| A push on cells for one tick | Exposure (a field with `lifetime: "tick"`) | gust, soak, blast |
| A value per cell computed from others | Cell property; materialized when hot | `EFFECTIVE_BIOME`, `WALKABLE` |
| One field turning into another | Reaction | `soak-douses-fire` |
| A thing hurt or changed by the cell it stands on | Trait response | `flammable`, `heat-sensitive` |
| Force or harm on things in an area | `strike` | the tornado's core |
| A fact others may react to | Event | `thingKilled`, `powerUsed` |
| A fixed group of kinds | Kind tag | `tree`, `wooden` |
| A per-thing on/off state | Flag | `held`, `sick` |
| A number per kind, optionally modified | Property | `mass`, `windResistance` |
| A number per thing in a group you don't own | Column | `infection` |
| Non-numeric per-thing data | Side table keyed by serial, with its own save section | paths |
| Behavior shared by kinds | Trait: `declareTrait` in `shared/`, `respondTo` in `simulation/` | `grabbable` |
| A tribe decision | `JobDefinition` or a consideration | `healer`, rest when sick |
| A change to land or water | `TerrainEditor`, world-layer contributions | terraform, a dam |
| A core action | A `ModuleContext` service | `strikeLightning`, `explode`, `kill` |
| Something on screen | Render layer, thing presenter, effect presenter | the funnel |
| Something in the HUD | Mirror section, store, `PANELS` entry | sickness journal |

Extension points, closed list: fields, cell-property contributions, reactions, trait responses, property modifiers,
considerations, jobs, relation modifiers, world-layer contributions, listeners, commands, tasks, save, frame and mirror
sections, presenters, panels, inspector rows. A new one is an architecture change.

### Kernel: steps, ticks and phases

The clock has two counters. `step` advances on every simulation step, paused or not. `tick` is game time and
advances only when the world runs. Commands and hashes are keyed by step; nature runs on ticks.

`simulation/kernel/run-step.ts`:

```ts
export const TICK_PHASES = ["weather", "emit", "react", "nature", "life", "settle"] as const;

export type TickPhase = (typeof TICK_PHASES)[number];

export interface Tick {
  readonly day: number;
  readonly index: number;
  readonly seconds: number;
  readonly step: number;
}

export interface System {
  readonly cadence?: number;
  readonly id: string;
  readonly phase: TickPhase;
  readonly run: (tick: Tick) => void;
}

export function runStep(kernel: Kernel, commands: readonly StampedCommand[]): void {
  const { clock, events, indexes } = kernel;

  indexes.refresh(clock.current);
  runIntake(kernel, commands);

  if (!clock.isPaused) {
    for (const phase of TICK_PHASES) {
      indexes.refresh(clock.current);
      runPhase(kernel, phase);
    }
  }

  indexes.refresh(clock.current);
  events.drain(clock.current);
  clock.advance();
}
```

- **Intake** runs on every step: commands, due step tasks, the held stroke. Terrain edits and the hand act at once
  while paused; exposures a brush stamps while paused use `max` and act at the next running tick.
- **Events drain on every step**, paused or not, so casting while paused shows its effect in the next frame. The queue
  is empty between steps (asserted). Events emitted during the drain join it; a fifth round fails a development
  assertion and in production carries over to the next step through the saved `pendingEvents` section.
- **Order.** Within a phase: built-in systems in `BUILT_IN_SYSTEMS` order, then module systems in `MODULES` order,
  then registration order. `system-order.test.ts` prints the whole order and fails on any change; a change is a hash
  change and is labeled. A pair that must run in opposite orders in two phases is pinned in `phase-pins.ts`.
- **Cadence.** `cadence: 50` runs a system every 50th tick, offset by a hash of its id.
- **Derived layers** (water, walkability, navigation, coast, crossings) are double-buffered. An input edit records its
  region diff in a pending list and starts a rebuild of a fixed number of steps, in work units, never wall time; at
  the end the buffers swap. The derived section saves the pending list and the slice offset. After a load the runtime
  builds the active buffer from the inputs with the pending diffs reverted and resumes the slice, so a loaded run swaps
  at the same step as the live one. Today's 50-tick navigation check against an immediate rebuild on restore has this
  bug; D3 fixes it.
- **No context bag.** Systems close over the `ModuleContext` they got at creation. `run` receives only `Tick`.
- **Indexes** are refreshed at phase boundaries when dirty, never by a query.

### Cell fields and cell properties

A **field** is stored per cell. With `lifetime: "persistent"` it is saved; with `lifetime: "tick"` (an exposure:
gust, soak, blast) it is cleared at `settle` and never saved. A **cell property** is derived and never saved.
Field definitions are pure data, declared in `core/catalog` or a module's catalog contribution, so the main thread
knows every mirror channel at startup.

`core/catalog/land/fire-field.ts`:

```ts
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

`core/catalog/handles/define-field.ts`:

```ts
export type FieldStorage = "f32" | "u16" | "u8";

export type FieldRest =
  | { readonly kind: "constant"; readonly value: number }
  | { readonly kind: "ground"; readonly property: GroundPropertyHandle };

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
  readonly tags: readonly CellTagHandle[];
}

export function defineField<const Name extends string, const Storage extends FieldStorage>(
  definition: FieldDefinition<Name, Storage>,
): FieldDefinition<Name, Storage> {
  return definition;
}
```

- **Storage.** `dense` fields (wetness, snow) are full arrays tracked by 32-cell segment bitsets. `sparse` fields
  (fire, heat, lava, germs) carry an active set. `tiled` fields allocate 64×64 tiles on first write (acid, a module's
  rare field). Exposures are sparse stamps cleared through a touched list, never with `fill`.
- **`rest`** is the value a cell returns to and the value an old save without the field loads at. Fuel's rest comes
  from a ground property, as `sparseDifference(fuel, groundFuel(...))` does today.
- **Floors** are applied in the field's own decay pass, never in `add` or `set`, so weak contributions from several
  sources still add up (fire's `HEAT_FLOOR` works this way today).
- **Two write tiers.** The owning kernel (fire spread, the surface sweep, growth) takes raw arrays once at creation
  and calls `markRows` or `markChunk` in bulk; it keeps today's bit tricks. `kernel(handle)` succeeds only for fields
  the caller declared, checked at creation; other fields come as read-only arrays through `read(handle)`. Everyone
  else writes through one concrete `FieldWriter` class with the policy as data, so call sites stay monomorphic.
- **Dirty chunks and digests.** Every write path sets a bit per 64×64 chunk and folds the change into the chunk's
  order-free digest (see [Hashing](#hashing)). The frame builder and the base diff each keep their own copy of the
  bits and clear only their own. A debug verifier recomputes digests from raw data in tests.
- **Mirroring** is opt-in. A field with `mirror` gets a byte channel in a shared RGBA8 cell-state page that feeds both
  the frame diff and the GPU textures. Its handle is a `MirroredField`; the main thread's reader accepts only those,
  so a main-thread query can't name an unmirrored field.

`simulation/state/cells/field-store.ts`:

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

**Cell properties** compile once per world into one function over resolved arrays: a base plus contributions from
modules, merged in ascending `priority` (ties in `MODULES` order), each able to override the value so far. A test
pins the merged order. Properties read per cell on hot paths are **materialized** as derived u8 layers refreshed from
their inputs' change bits: `EFFECTIVE_BIOME`, `HAS_WATER` and `WALKABLE`. Fire reads `FLAMMABILITY` through the same
compiled function, so the rule exists once.

`core/world/queries/effective-biome.ts`, then `modules/hazards/volcano/shared/lava-biome.ts`:

```ts
export const EFFECTIVE_BIOME = defineCellProperty({
  create: (cells) => {
    const biome = cells.terrain.biome;
    const hasWater = cells.compiled(HAS_WATER);

    return (cell) => {
      if (hasWater(cell)) {
        return WATER_BIOME;
      }

      return biome[cell];
    };
  },
  isMaterialized: true,
  name: "biome",
});

export const LAVA_BIOME = contributeToCellProperty(EFFECTIVE_BIOME, {
  create: (cells) => {
    const lava = cells.field(LAVA);
    const lavaFields = cells.catalog.biome("lava-fields");

    return (cell, value) => {
      if (lava.at(cell) > 0) {
        return lavaFields;
      }

      return value;
    };
  },
  id: "volcano.lava-biome",
  priority: 10,
});
```

Built-in properties: `HEIGHT`, `SLOPE`, `GROUND`, `HAS_WATER`, `WATER_DEPTH`, `EFFECTIVE_BIOME`, `AIR_TEMPERATURE`
(base, altitude, season, weather), `FLAMMABILITY` (ground, canopy fuel, wetness), `WALKABLE` (footing plus
contributions from dams, ice and bridges). `HAS_WATER` is backed by the one water rule, `hasWater` in
`core/world/water`. Walkability contributions have hysteresis (ice freezes walkable above one thickness and thaws
below a lower one); navigation rebuilds only the areas whose walkability flipped, at a saved step cadence.

### Things, kinds, tags, flags and properties

Things stay in their stores, and every store answers one interface. People, animals and buildings stay objects with
their monotonic `id` from `IdentifierSource` (herds draw from the same source; the new API calls it `serial`). Plants
stay in the SoA `VegetationStore`. A new `TransientStore` holds tornadoes, meteors, embers, arrows, craters and danger
sources as column blocks per kind behind one `ThingSource` view, so they are saved, framed and queryable. Features
(crossings, deposits, later tribe-built bridges and perhaps monuments) are anchored things in their own group.

`core/world/things/thing-source.ts`:

```ts
export const ThingGroup = {
  Animal: 1,
  Building: 2,
  Feature: 5,
  Person: 3,
  Plant: 0,
  Transient: 4,
} as const;

export interface ThingSource {
  readonly group: ThingGroupIndex;
  readonly slotCount: number;
  cell(slot: number): number;
  flags(slot: number, word: number): number;
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
- **Kinds.** Each group has its own dense local index range; module rows append inside their group's range when the
  catalog compiles, so `PLANT_SPECIES[species]`-style lookups keep working. Base local indices are pinned per group
  by a test, because `PlantSpecies.X`, `Biome.X` and `Ground.X` appear about 890 times in 86 files (600 in 43 non-test
  files). Names and `formerNames` share one namespace across groups. The plant species column widens to `Uint16`
  before mods. Rocks and monument pieces stay plant rows, so plant slots never renumber; `rock` and `monument` are
  kind tags. Monument damage moves out of the piece's `seed` into the monument section, keyed by monument id.
- **Every per-kind, per-ground and per-species table** is built from the compiled catalog when a world is created and
  reaches code through `ModuleContext.catalog` on the worker and the mirror's catalog on the main thread. Free
  `core/world` helpers take a `CatalogTables` argument. Today's module-scope tables (`GROUND_FUEL` in `surface.ts`,
  `obstacles.ts`, `vegetation-chunks.ts`, `vegetation-view.ts`) would read `undefined` for a module ground and write
  `NaN` into saved fuel.
- **Tags** are static per kind (`tree`, `conifer`, `wooden`, `uprootable`, `movable`), compiled into multi-word masks.
  `WOODED_BIOMES` and the three other conflicting biome groups become one `wooded` biome tag.
- **Flags** are dynamic per thing (`held`, `burning`, `sick`), registered by their owners and stored in multi-word
  flag masks per store. `held` is excluded from every query by default, in one place.
- **Properties** are open and every property can take modifiers: `defineProperty({ name: "windResistance", rest:
  0.5 })` compiles to one `Float32Array` per property indexed by kind. Catalog rows set values by handle,
  `values: [value(MASS, 300), value(WIND_RESISTANCE, 0.5)]`. Modifiers that depend on kind and world state (season,
  rules) fold into a per-kind array; technology modifiers fold per tribe and kind for people and buildings (eight
  tribes or fewer); per-thing modifiers are column reads compiled into the property. When no modifier exists, a read
  is one array index. `explain` runs only for the inspector.
- **Damage types** are handles, each with its resistance property: `defineDamage({ name: "wind", resistance:
  WIND_RESISTANCE })`. Wind damage and forest drag are separate properties (`WIND_RESISTANCE`, `WIND_HOLD`).
- **Columns** are per-thing data a module adds to a group it doesn't own:
  `defineColumn({ group: ThingGroup.Person, name: "infection", rest: 0, storage: "f32" })`. Columns are saved by name,
  cleared on spawn and mirrored only on opt-in. Non-numeric per-thing data lives in side tables keyed by serial, each
  with its own save section.
- **Traits** are behavior with configuration. The owner declares the trait (`declareTrait({ id, config })`, a zod/mini
  schema) in `core/catalog` or its module's `shared/`, and binds the response on the simulation side with
  `respondTo(FLAMMABLE, response)`, listed in `ModuleRuntime.traitResponses`. `flammable` belongs to fire, `grabbable`
  to the hand, `uprootable` to vegetation. Configs are validated when the catalog compiles, and catalog patches may
  attach a trait to another module's kind by name.

**Trait responses have a driver contract.** Anchored things (plants, buildings) respond from a field's active set
through the per-cell list, so a response costs nothing where nothing burns. Movers and transients respond per thing.
A response declares which, and the catalog compiler rejects a per-thing sweep over plants. Plants keep burning as a
per-cell aggregate (`canopyFuel` and a state flip), with no per-plant heat. Harm from the cell a thing stands on (fire,
heat, lava) belongs to trait responses only; `strike` is for area blows.

**Tribes** get a store with columns and properties like any group, without a position index:
`TribeQuery.relation(a, b)` reads the relation book, and modules add relation modifiers. Tribe stock is columns keyed
by the resource catalog. A membership API moves people between tribes and emits `personJoinedTribe`, for marriages
and tribute. A territory `claim` field (tribe slot per cell) makes "whose land is this" a cell read; it is derived
from today's saved `Claim` circles, which stay the saved form.

### Reactions

A reaction is a batch kernel called once per tick over the active cells of its driving field. Field arrays are
resolved at creation, so nothing looks up a field by handle inside the loop.

`simulation/systems/nature/soak-douses-fire.ts`:

```ts
export const SOAK_DOUSES_FIRE = defineReaction({
  create: (cells) => {
    const fire = cells.kernel(FIRE);
    const heat = cells.kernel(HEAT);
    const soak = cells.read(SOAK);

    return {
      run: (tick, active, count) => {
        for (let index = 0; index < count; index += 1) {
          const cell = active[index];

          if (fire.values[cell] > 0) {
            const remaining = 1 - Math.min(1, soak.values[cell] * tick.seconds);

            fire.values[cell] *= remaining;
            heat.values[cell] *= remaining;
            fire.markChunk(cell);
            heat.markChunk(cell);
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
  its rate scaled by the sweep period. Global weather stays a scalar in `Environment` (renamed `EnvironmentReading`)
  and is never stamped on every cell.
- **Order.** Built-in reactions, then module reactions in `MODULES` order. Rules apply at once, in list order. A test
  pins the order. Reaction tests run the digest verifier, so a missed mark fails.
- **Chance** comes from `unitHash(seed, tick, cell, ruleHash)`, so it doesn't depend on order.
- **Transitions as data.** Grounds and fields declare thresholds (`quenchesInto: "basalt"`, `meltsInto`,
  `ignitesAt`). The `transition()` helper turns each into an explicit reaction listed in `REACTIONS`, so every rule can
  be found with grep.
- **Iteration.** The pass walks a copy of the active cells taken at the start of the pass, in ascending cell order.
  Cells added during the pass are visited next tick.

### Strike

`strike` is the one way area force and harm reach things. It replaces 14 `damageArea`, 5 `scare` and 5 `addZone`
calls.

`simulation/rules/strike.ts`:

```ts
export interface Blow {
  readonly cause: DeathCauseHandle;
  readonly damage: DamageHandle;
  readonly dangerSeconds: number;
  readonly filter: PreparedFilter;
  fright: number;
  harm: number;
  push: number;
  swirl: number;
  uproot: number;
}

export function strike(context: StrikeContext, area: QueryShape, blow: Blow): void;
```

- `harm` is scaled by the thing's resistance to `damage`; `push` (outward) and `swirl` (around the center) are divided
  by `mass`; `uproot` goes to plants through the `uprootable` trait (trees fall, shrubs go, rocks and monuments have no
  trait). A hot caller keeps one `Blow` per kind of blow and sets its numbers each tick.
- Health is a share from 0 to 1 everywhere, in memory and in the logical save schema; the legacy reader converts
  today's absolute building and animal health with the maxima frozen inside it.
- Candidates are visited in ascending serial (plants by slot), so kills, chronicle lines and draws keep today's order.
- A hazard that hurts in its core and frightens wider strikes twice.
- `strike` adds a danger source (a transient with center, radius and expiry) that replaces `DangerZone[]`; agents
  find it with `nearest` and flee from its center. Diffuse dangers (fire, lava) stay fields. It emits `thingKilled`
  for deaths and accumulates harm in columns; it never emits per-hit events.

### Context queries

The cell side lives in `core/world/queries` and works on both threads: `CellReader`, compiled cell properties,
`CellFilter`, area query descriptors and the cell part of `measure`, written against `WorldReader` plus a list of
`ThingSource`s. The worker adds thing queries over its stores and mover buckets in `simulation/queries`. The main
thread gets `MirrorSurroundings`: cells over mirrored fields, and plant and agent tallies from the mirror's buffers.
Mirrored thresholds compare in channel units on both threads, so rendering, audio and the simulation agree at the
edge; main-thread measures of anything else are approximate by design.

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

Filters and area queries are descriptors at module scope, resolved per world in `create`, so a world with mods
resolves against its own catalog. A filter is immutable once prepared; the tribe is a query argument.

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
`CellFilter` covers cell tags and field thresholds, and `findCell` answers "nearest shore" or "nearest dry spot" in
radial order without random probes.

Guarantees:

- **Order.** Distances are compared squared. Cells come in radial order `(distanceSquared, dz, dx)` from a
  precomputed pattern. Things come in ascending serial (plants by slot); ties go to the lower `(group, serial)`.
- **Indexes.** Movers sit in 40 m CSR buckets (about 30 µs to rebuild for 5,000 movers, `critic-perf/bench.mjs`),
  rebuilt at phase boundaries when dirty. Things spawned since the last refresh sit in a tail list that queries scan
  linearly. Searches pad by the largest step a mover takes in a tick and test live positions. Plants, buildings and
  features use per-cell lists. Block counts (16×16 cells, 160 m) are added only for a caller a bench shows over
  budget; at tornado radii (5–140 m, default 45) at most one whole block fits, and only near alignment.
- **No side effects.** No random draws, no allocation, no cache built by a query. Inspection and picking between
  steps read without building anything, and a test checks that hashes don't change when inspect queries are
  interleaved.
- **Hot paths** use `count`, `hasAny`, `nearest` and `collect` (inline loops per store, chosen by the filter's group
  bits). `visit` is for rare queries and early exit. Scratch lists and visitors belong to a system instance, never a
  module constant, and a debug-only guard throws when a query is re-entered with the same scratch.

### Modules and registries

`core/catalog/handles/define-module.ts` and `assembly/modules.ts`:

```ts
export interface ModuleManifest<Id extends string = string> {
  readonly catalog: CatalogContribution;
  readonly commands: readonly AnyCommandDeclaration[];
  readonly hasEngine: boolean;
  readonly hasInterface: boolean;
  readonly hasSimulation: boolean;
  readonly icon: IconSource;
  readonly id: Id;
  readonly powers: readonly PowerDefinition[];
  readonly requires: readonly string[];
}

export function defineModule<const Manifest extends ModuleManifest>(manifest: Manifest): Manifest {
  return manifest;
}

export const MODULES = [rainModule, snowModule, lightningModule, tornadoModule, volcanoModule] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export type ModuleSide = "hasEngine" | "hasInterface" | "hasSimulation";

export type ModuleIdWith<Side extends ModuleSide> = Extract<
  (typeof MODULES)[number],
  { readonly [Key in Side]: true }
>["id"];

export const SIMULATION_MODULES = {
  lightning: lightningSimulation,
  rain: rainSimulation,
  snow: snowSimulation,
  tornado: tornadoSimulation,
  volcano: volcanoSimulation,
} as const satisfies { readonly [Id in ModuleIdWith<"hasSimulation">]: SimulationModule<Id> };
```

- A side record lists exactly the modules that declare that side, so `tsc` names a missing or extra one. Side records
  are keyed objects, sorted to cut merge conflicts; iteration always follows `MODULES`.
- **`MODULES` order means something**: it orders module systems, reactions, listeners and catalog rows within a
  group. A new module is appended at the end; inserting elsewhere is a hash change. Precedence that matters (cell
  property contributions) is explicit `priority` data, never list position. `POWER_ORDER` is the dock order.
- `requires` lets a module import the `shared/` of another; `modules.test.ts` checks that the graph is acyclic and
  that each required module comes earlier in `MODULES`. An optional dependency resolves a handle at creation and gets
  `null` when the module is absent.
- `module.ts` carries ids, numbers, zod/mini schemas, the catalog contribution (fields, kinds, tags, trait
  declarations, columns, properties, damage types, death causes, events, grounds, biomes), command declarations, an
  icon URL and message ids. Message text lives in `messages.ts`, which only the interface imports, so the worker bundle
  carries no strings.
- **The catalog is a per-world value**: `compileCatalog(MODULES, scenario, mods)` runs base rows, then module
  contributions in `MODULES` order, then scenario and mod rounds when those exist. It is frozen and hashed into
  replays and the lockstep handshake, and passed to `generateWorld` and every `create()`, so generation places module
  species and grounds too. `assembly` keeps the module list and the base compile.
- A per-world **registry by name** for every handle kind is compiled with the catalog. Save name tables, scenarios
  and data packs name handles through it.

`simulation/api/module-runtime.ts`:

```ts
export interface SimulationModule<Id extends string> {
  readonly create: (context: ModuleContext) => ModuleRuntime;
  readonly id: Id;
}

export interface ModuleRuntime {
  readonly commands: readonly CommandHandler[];
  readonly frames: readonly FrameSection[];
  readonly jobs: readonly JobDefinition[];
  readonly listeners: readonly EventListener[];
  readonly powers: Partial<PowerHandlers>;
  readonly propertyModifiers: readonly PropertyModifier[];
  readonly reactions: readonly ReactionDefinition[];
  readonly saves: readonly SaveSection[];
  readonly systems: readonly System[];
  readonly tasks: readonly TaskHandler[];
  readonly traitResponses: readonly TraitResponse[];
}

export interface ModuleContext {
  readonly actions: CoreActions;
  readonly catalog: FrozenCatalog;
  readonly cells: CellWriter;
  readonly events: EventSink;
  readonly properties: PropertyReader;
  readonly query: Surroundings;
  readonly random: (streamId: string) => RandomStream;
  readonly rules: RulesReader;
  readonly schedule: Scheduler;
  readonly strike: (area: QueryShape, blow: Blow) => void;
  readonly terrain: TerrainEditor;
  readonly things: ThingWriter;
}
```

`CoreActions` holds `strikeLightning`, `explode`, `shakeLand`, `kill` and `spawn`. `defineRuntime({ systems: [...] })`
fills empty lists, so a module lists only what it uses. Built-in systems use the same contract and register in
`BUILT_IN_SYSTEMS` in `simulation/runtime`. `TerrainEditor` batches height and ground edits and feeds the derived
layers' pending lists.

Every list holds **erased runtimes**. `defineSaveSection<Saved>`, `handleCommand`, `listen`, `defineFrameSection` and
`defineTask` take a typed spec and return a non-generic object that parses with its own schema inside, so a module's
typed section fits `readonly SaveSection[]` under `strictFunctionTypes` with no `as`.

**Society and fauna extension points**, so tribe systems don't edit society:

- `JobDefinition { kind, band: "survive" | "duty" | "work" | "leisure", schema, score, start, update,
  isInterruptible }` covers all 28 job kinds: 21 in `society/jobs`, `defend`, `envoy`, `fight`, `hide` and `mourn` in
  `rivalry/defense-jobs.ts`, `raid` in `rivalry/raid-job.ts`, `pick` in `era-work.ts`, and `idle`. Decisions pick the
  best proposal per band in band order, replacing the `decideJob` ladder and the `NIGHT_JOBS`, `UNWAVERING_JOBS` and
  `STEADFAST_JOBS` sets. Jobs save as `{ kind, data }`; an unknown kind loads as idle.
- Considerations: a module adds a weight to an existing job's score ("rest when sick") without importing society.
- Animal brains by kind tag in fauna, so a beaver brain is a registration.
- Lifecycle events: `personBorn`, `personDied`, `personJoinedTribe`, `tribeFounded`, `tribeExtinct`.

### Commands

`core/protocol/commands.ts`:

```ts
export interface StampedCommand<Command> {
  readonly command: Command;
  readonly player: number;
  readonly sequence: number;
  readonly step: number;
}

export function declareCommand<const Kind extends string, Payload>(
  kind: Kind,
  schema: ZodMiniType<Payload>,
): CommandDeclaration<Kind, Payload> {
  return { kind, schema };
}
```

- A command's kind and schema are declared in `module.ts` or `shared/`, so both threads see them and `assembly`
  composes the command union. The simulation binds `handleCommand(SPAWN_BOAT, (payload, issuer, tick) => …)`; a test
  checks every declaration has exactly one handler.
- Payloads carry quantized integers: centimeters, whole milliseconds. Every command, the local player's included, is
  applied only after the same encode and decode, so `-0` and float noise can't split peers.
- Powers go through `usePower { power, x, z, parameters }`. A brush is clock state: `strokeBegin`, `strokeMove`
  (quantized, at most 20 per second) and `strokeEnd`. Each step the kernel applies the held stroke at its rate times
  the step's share of real time, which the tick source fixes per turn, so speed 16 doesn't multiply it and exposures
  are stamped on every step the stroke is held.
- `setPaused` and `setSpeed` are commands today. Pause moves from a flag into clock state keyed by step; speed moves
  from saved simulation state into tick-source state and changes how many steps run per real second, never what a
  step does.
- Validation is a pure function of the command and the state. A refusal becomes a notice event with a message id.
- Inspection is a query message, not a command.

### Events

`core/catalog/events.ts`, then `modules/tribes/sickness/simulation/sickness-listeners.ts`:

```ts
export const THING_KILLED = defineEvent<ThingKilled>({ id: "thingKilled", isPresented: true });

export const POWER_USED = defineEvent<PowerUsed>({ id: "powerUsed", isPresented: false });

export const MOURN_THE_SICK = listen(THING_KILLED, (tick, killed) => {
  recordLoss(killed.cause, killed.tribe, tick.day);
});
```

- Each handle owns one typed channel per world, so `emit` and `listen` are typed with no cast; the queue records the
  emission order across channels. Listeners run in `MODULES` order, then registration order.
- A listener writes only its own module's state. If something must change the world in the same tick, it is a field.
- Shared facts live in the catalog as generic events with a `cause` (`thingKilled`, `hazardStruckCamp`,
  `lightningStruck`, `fireSeen`, `waterChanged`, `powerUsed`), so society listens once for every hazard, and beliefs
  can answer powers. A module's private events live in its `shared/`.
- High-volume facts (plants burning) are merged per 16×16 block before they are emitted, never per plant. A thing
  that would repeat a fact every tick keeps a cooldown column.
- `isPresented` events also go into the frame as effects, coalesced per frame by kind and block. The chronicle stores
  `{ id, values }`, never English text.

### Save sections

`simulation/kernel/save-section.ts`:

```ts
export interface SaveSection {
  readonly isEssential: boolean;
  readonly key: string;
  readonly requires: readonly string[];
  readonly reset: () => void;
  readonly restore: (raw: unknown, names: NameReader) => RestoreOutcome;
  readonly write: (names: NameWriter) => unknown;
}

export function defineSaveSection<Saved>(spec: SaveSectionSpec<Saved>): SaveSection;
```

`restore` runs `spec.schema.safeParse(raw)` and hands the parsed value to the typed `spec.read`, so the narrowing comes
from zod/mini and needs no cast.

- Every field, store, built-in system and module that holds state contributes sections. The logical form is designed
  once and does not follow the memory layout (see [Saves](#saves)).
- A section that fails its schema resets, together with the sections that `require` it. An essential section
  (terrain, society, vegetation) refuses to load instead. In a lockstep resync any failure is fatal.

### Frame sections

`core/protocol/frame.ts` and `engine/mirror/mirror-section.ts`:

```ts
export interface Frame<Sections> {
  readonly sections: Partial<Sections>;
  readonly step: number;
  readonly tick: number;
}

export interface FramePart<Payload> {
  readonly payload: Payload;
  readonly transfer: readonly ArrayBuffer[];
}

export interface MirrorSection {
  readonly apply: (mirror: MirrorWriter, raw: unknown) => WorldChanges;
  readonly key: string;
}
```

The payload type lives in the module's `shared/`; `defineFrameSection` and `defineMirrorSection` erase it the same
way save sections do. Section kinds: `rows` (cell-state pages), `regions` (height and water), `patch` (vegetation and
dirty thing slots), `packed` (people, animals, transients, features). `apply` returns the change kinds, which replaces
the hand-kept `hasLandChanged` list. Each mirror section exposes a typed subscribable reader; interface stores
subscribe to readers, and the engine never imports zustand. Lasting effects (tornadoes, embers, meteors) are transient
things with frame rows, so a reload or a late joiner sees them; only instant effects stay events.

## Walkthroughs

Each walkthrough states its outside edits. That count is the acceptance test for the architecture. The tornado sketch
typechecks against the declarations above in a scratch file.

### The tornado, one tick

The tornado is a transient thing in phase `emit`. It measures its surroundings once, reacts to the biome and the
forest, writes the gust exposure, and strikes.

`modules/hazards/tornado/simulation/tornado-system.ts`:

```ts
const SWEPT = defineFilter({ all: [MOVABLE], groups: [ThingGroup.Animal, ThingGroup.Person] });

const STANDING = defineFilter({ groups: [ThingGroup.Building] });

interface TornadoParts {
  readonly area: Disc;
  readonly cells: CellList;
  readonly center: Point;
  readonly context: ModuleContext;
  readonly core: Disc;
  readonly gust: GustWriters;
  readonly result: AreaResult;
  readonly standingBlow: Blow;
  readonly sweptBlow: Blow;
  readonly view: PreparedAreaQuery;
}

export function createTornadoSystem(context: ModuleContext, tornadoes: TornadoColumns): System {
  const { cells, query } = context;
  const parts: TornadoParts = {
    area: createDisc(),
    cells: createCellList(TORNADO_CELL_LIMIT),
    center: { x: 0, z: 0 },
    context,
    core: createDisc(),
    gust: { x: cells.writer(GUST_X), z: cells.writer(GUST_Z) },
    result: createAreaResult(TORNADO_VIEW),
    standingBlow: createBlow(query.filter(STANDING)),
    sweptBlow: createBlow(query.filter(SWEPT)),
    view: query.prepare(TORNADO_VIEW),
  };

  return {
    id: "tornado",
    phase: "emit",
    run: (tick) => {
      for (let slot = 0; slot < tornadoes.count; slot += 1) {
        rage(parts, tornadoes, slot, tick);
      }
    },
  };
}

function rage(parts: TornadoParts, tornadoes: TornadoColumns, slot: number, tick: Tick): void {
  const { area, center, context, core, result } = parts;
  const radius = tornadoes.radius[slot];

  tornadoPositionAt(tornadoes, slot, center);
  setDisc(area, center.x, center.z, radius);
  setDisc(core, center.x, center.z, radius * CORE_SHARE);
  context.query.measure(parts.view, area, result);

  const target = targetStrength(result);
  const current = tornadoes.strength[slot];
  const strength = Math.min(MAXIMUM_STRENGTH, current + (target - current) * STRENGTH_RATE * tick.seconds);
  const force = strength * tick.seconds;
  const count = context.query.collectCells(area, parts.cells);

  tornadoes.strength[slot] = strength;
  stampSwirl(parts.gust, parts.cells, count, center, force);
  parts.sweptBlow.harm = PEOPLE_HARM * force;
  parts.sweptBlow.push = FLUNG * force;
  parts.sweptBlow.swirl = SWIRL * force;
  parts.sweptBlow.uproot = force;
  context.strike(core, parts.sweptBlow);
  parts.standingBlow.harm = BUILDING_HARM * force;
  context.strike(area, parts.standingBlow);
  noticeSurroundings(parts, tornadoes, slot, tick);
}

function targetStrength(result: AreaResult): number {
  if (result.dominantBiome === WATER_BIOME || result.waterShare > WATERSPOUT_SHARE) {
    return MAXIMUM_STRENGTH;
  }

  if (result.dominantBiome === LAVA_FIELDS_BIOME) {
    return ASH_STRENGTH;
  }

  return 1 - FOREST_DRAG * windHoldOf(result.things(TREES).tally, WIND_HOLD);
}

function noticeSurroundings(parts: TornadoParts, tornadoes: TornadoColumns, slot: number, tick: Tick): void {
  const { center, context, result } = parts;
  const fire = result.field(FIRE);
  const people = result.things(PEOPLE);

  if (tornadoes.calmUntil[slot] > tick.index) {
    return;
  }

  if (fire.countAbove > 0) {
    context.events.emit(FIRE_WHIRL, { cell: context.query.cellAt(center.x, center.z), strength: fire.maximum });
  }

  if (people.count > 0) {
    const struck = { cause: TORNADO_CAUSE, tribe: people.dominantTribe, x: center.x, z: center.z };

    context.events.emit(HAZARD_STRUCK_CAMP, struck);
  }

  if (fire.countAbove > 0 || people.count > 0) {
    tornadoes.calmUntil[slot] = tick.index + NOTICE_SECONDS / tick.seconds;
  }
}
```

`TornadoColumns` is the tornado's column block in the `TransientStore` (path origin, heading and seed, age, radius,
strength, `calmUntil`), so the loop visits only tornadoes. `tornadoPositionAt` lives in `shared/` and writes into a
scratch point.

What it learns: the dominant effective biome (water over lakes, lava fields over lava), trees by species weighted by
each species' `WIND_HOLD`, fire (maximum and burning cells), people by tribe. A waterspout grows toward the maximum
over water; over lava fields it carries ash at a fixed strength; a forest drags it down. Strength moves toward its
target at a rate times `tick.seconds`, clamped. Events fire on entry, then wait out a cooldown. Who reacts:

- **`react`:** `wind-blows-out-fire` reads the gust and replaces the tornado's `blowOut` loop; burning buildings go
  out through fire's `flammable` response reading the lower cell fire, which removes `buildings.blowOut`.
- **`strike`:** movers are pushed and swirled by mass (a mammoth no longer swirls like a hare), harmed by wind
  resistance; trees fall with an angle from `unitHash`, shrubs go; held things are skipped by the filter's default.
- **`settle`:** `thingKilled` and `hazardStruckCamp` become chronicle lines from the module's death message.

Cost at radius 140 m: about 615 cells for the measure and the swirl stamp (two `FieldWriter` writes each), two short
mover bucket walks, the uproot pass over the plants under the core, and two `strike` scans, with no allocation.
Today it makes two allocating disc walks, five linear agent scans, and seven temporary arrays per tick plus two per
uprooted cell. The 25 µs budget applies to the whole `rage()`. Outside edits: none.

### A new power: acid rain

The brush stamps the `soak` exposure and a tiled persistent field `acid` (tags `wet`, `corrosive`, `decayPerDay`).

```
modules/elements/acid-rain/
  module.ts                       power (zod/mini radius, strength), sides, icon URL, death cause, command
                                  declarations; catalog: ACID field, grounds patch { barren },
                                  trait patch corrodes → wooden kinds, the corrodes trait declaration
  messages.ts
  simulation/acid-simulation.ts   two reactions (acid-sears-ground, meadow or steppe → barren),
                                  respondTo(CORRODES), the stroke handler
  simulation/acid-simulation.test.ts
  engine/acid-tint-layer.ts       TerrainLayer reading the acid channel of the cell-state pages
  engine/acid-rain-cue.ts, acid-hiss.webm, acid-engine.ts
  engine/acid-tint-layer.browser.test.ts
  interface/icon.webp
```

Fires go out for free through `soak-douses-fire`. The rain look's tint goes through the precipitation look slot that
weather owns. Registration: `MODULES` (appended), `POWER_ORDER`, `SIMULATION_MODULES`, `ENGINE_MODULES`: four lines,
two of them order-significant (`MODULES`, `POWER_ORDER`).

Outside edits: none. The `barren` ground is a catalog contribution appended to the ground range and named in the
ground name table; every ground table is built from the compiled catalog, so fuel reads its rest for `barren` instead
of `NaN`. An old save has no `acid` and loads it at rest. A build without the module keeps the unknown section verbatim
and writes it back, and loads `barren` cells through the ground fallback.

### A new thing kind: boat

`modules/things/boat/shared/boat-kind.ts`:

```ts
export const BOAT = defineThingKind({
  formerNames: [],
  group: ThingGroup.Transient,
  name: "boat",
  tags: [WOODEN, MOVABLE],
  traits: [
    useTrait(FLAMMABLE, { burnSeconds: 45, ignitesAt: 0.25 }),
    useTrait(GRABBABLE, { liftHeight: 3, settlesOn: "water" }),
    useTrait(FLOATS, { draft: 0.4 }),
  ],
  values: [value(FIRE_RESISTANCE, 0.1), value(MASS, 300), value(RADIUS, 2.5), value(WIND_RESISTANCE, 0.5)],
});
```

- **The kind and the `floats` declaration** live in `shared/`, so the engine's presenter record and the frame see
  them. The `floats` response is a `life`-phase system in `simulation/` that moves boats down the water surface
  gradient and with the gust, and beaches them where `HAS_WATER` is false. It moves to core when a second kind floats.
- **Fire, hand, tornado, lava** need no code: `flammable` heats and burns movers per thing, lava included;
  `grabbable` with `settlesOn: "water"` lets the hand set it on water; `strike` pushes it by mass.
- **Files:** `module.ts`, `messages.ts`, `shared/boat-kind.ts`, `simulation/boat-simulation.ts` (the `floats`
  response, the `spawnBoat` handler) and its test, `engine/boat-model.ts`, `engine/boat-presenter.ts` (a
  `ThingPresenter`: layer, pick volume, rings, hand pose), `engine/boat-engine.ts`, `interface/icon.webp`. Inspection
  comes from the generic kind rows. Four registration lines; `tsc` asks for the presenter because `THING_PRESENTERS`
  in `engine/runtime` is keyed by every kind manifest with a packed frame.

Outside edits: none.

### A new tribe system: sickness with a journal panel

- **State.** `germs`, a sparse field tagged `contagion`, and columns `infection` and `immunity` on the person group,
  all declared in the module's catalog contribution with the disease rows (routes, affected tags, an onset–peak–end
  curve, lethality).
- **Simulation.**
  - Reactions on `germs`: fade in sun, thrive on `swamp` and `bog` ground.
  - `sickness.catch` (phase `life`, cadence 10) samples germs at each person's cell, counts sick neighbors with
    `count(contactDisc, sickPeople)` (filter on the `sick` flag), and compares with the `RESISTANCE` property, which
    warmth, hunger and a future herbalism technology modify per tribe. Providers never write code for sickness.
  - Progress follows the curve; death goes through `actions.kill` with the module's death cause.
  - A consideration raises the score of `rest` for sick people. A `healer` job is a `JobDefinition` in the module.
  - Events `fellIll` and `recovered` in its `shared/`; `thingKilled` with cause `sickness` from the catalog.
- **Panel.** `shared/sickness-frame.ts` (per-tribe counts, built once per game hour), a mirror section whose reader
  `useSicknessStore` subscribes to, and `interface/sickness-journal.tsx` registered as `{ id: "sickness", placement:
  "journal", label, icon, load }` in `PANELS` in `interface/app`. The journal derives its tabs from `PANELS`; test
  setup resets registered stores.
- **Look.** Pale sick people through a person visual-state channel that the people presenter exposes to modules.

About 14 files, five registration lines. Outside edits: none once the society extension points and the visual-state
channel exist ([phase T](#phase-t-tribe-and-fauna-extension-points)).

## Determinism, replays, lockstep and saves

### Exact math and randomness

- `core/foundation/exact-math.ts` holds `sin`, `cos`, `atan2`, `exp`, `log`, `log2`, `pow`, `tanh`, `asin` and
  `acos`, ported from fdlibm with exact operations only, pinned by golden tests. A port of `exp` costs 1.3–1.8× native
  in a fire-spread loop (`bench/critic-perf/evolve-perf.mjs` section E) and about 3× per call
  (`critic-perf/exp-bench.mjs`). Per-cell factors (fire's slope and wind terms) use clamped lookup tables.
- A codemod rewrites about 150 `Math.hypot` calls in simulation, generation and world as `Math.sqrt(dx * dx + dz * dz)`
  or squared comparisons. 185 other transcendental calls (including `shared/astronomy` and content) and 13 lines with
  `**` follow. The codemod reports its own counts.
- `unitHash(seed, a, b, c)` (`Math.imul` and lowbias32) replaces the `Math.sin` `hashToUnit` at its 43 deterministic
  sites. Its seed parameter is a branded `WorldSeed`, so a seedless call fails typecheck. About 25 of the 43 are
  seedless today (succession, volcanoes, plots, drainage, deposits, springs, crossings, footing), so the same cell gets
  the same choice on every island; the generation ones change worlds and belong to D5. `hashToUnit` itself stays for
  rendering and models in `engine/render/base`.
- Named streams: `stream(worldSeed, "fauna.instincts")`, seeded through splitmix32 into the full xoroshiro128plus
  state, with no draws from a parent. Each module gets `power:<id>` for its powers. States are saved in
  `randomStreams`; a missing one is re-derived. Generation gets named streams too, which fixes the shared
  `seed * 19 + 7` in `wetlands.ts` and `rock-strength.ts`.
- There is no presentation stream in the simulation. Ember durations look visual but decide where embers land, so they
  are state. Visual-only randomness is derived on the main thread from `hash(serial, tick)`.
- Sort comparators in simulation code break ties by serial (`sortBy` helper).
- **Everything reachable from `generateWorld` changes only in D5.** The boundaries graph already computes
  reachability, so CI rejects a D2-labeled edit to such a file. Runtime hydrology and crossings stay non-exact until
  D5, which is why lockstep needs D5.

### Canonical orders

Iteration order must be a function of saved state, or save, load and N ticks diverges from N ticks.

- Active sets become bitsets scanned in ascending order over a snapshot taken at the start of each pass (about 12,800
  words at 640², microseconds). Today `CellSet` keeps insertion order and `FireSnapshot` saves it; the logical form of
  a sparse field carries an optional `order` that keeps it until D3, and loaders after D3 ignore it.
- Each cell's plant list is kept sorted by slot, so `nextInCell` becomes derivable. The free list is state, saved and
  hashed.
- Lazy indexes refresh at phase boundaries, never on a query.
- Change trackers that feed simulation decisions are saved; frame trackers never feed the simulation. Derived layers
  swap at the same step live and after a load (see [Kernel](#kernel-steps-ticks-and-phases)).

### Hashing

- **Field digests are order-free.** Each 64×64 chunk keeps a multiset hash over `(cell, value bits)`. Owner kernels
  fold `mix(cell, oldBits) ^ mix(cell, newBits)` at write time, and `FieldWriter` does the same, so a full recompute
  equals the incremental digest by construction and nothing rereads dirty chunks. Plant columns hash per 1,024-slot
  page the same way; movers and transients are small and rehash in full.
- A section digest combines its chunk and page digests in a fixed order; the root hash folds section digests, so a
  desync points at a section and then at a chunk. The logical canonical dump is a debug artifact compared by property
  tests, not by hash.
- A rolling pass recomputes 1/K of chunks from raw data every turn in debug and test builds, so a missed fold is caught
  within K turns.
- Hashes are computed only when something consumes them: a lockstep peer, the replay recorder, a test or debug mode.
  Single-player frames carry none. Rereading costs 7.9 µs per 64×64 chunk of one f32 field under Bun
  (`bench/hash-bench.mjs`), so a rain sweep at speed 16 would cost 1.3–2.4 ms per turn reread; write-time folding
  keeps it inside the budget below.

### Replays and lockstep

- **`TickSource`** lives in the worker. The local one accumulates real time with speed, pause, the backlog and the
  40-step cap, and stamps commands. The lockstep one hands out confirmed turns. The kernel doesn't know which it runs.
- **Turns** are 100–200 ms of real time holding `speed` ticks each, so speed 16 doesn't mean 80 turns a second.
  Speed and pause are relay-ordered commands applied at turn boundaries.
- **Tasks** run in steps: `{ dueStep, kind, data }`, dispatched to the `TaskHandler` of that kind in
  `ModuleRuntime.tasks` and saved by kind; an unknown kind is kept. Anything with a visible flight (the meteor) is a
  transient whose flight advances in ticks, so its look and its impact share one clock.
- **Replay:** a header (build, catalog hash, seed, base hash, name tables), the command log, root hashes per turn, and
  optional keyframes. Exports and resync payloads embed the compressed base. The kernel runs headless in Bun and in
  workerd, so the server can verify replays.
- **Relay:** one Cloudflare Durable Object per match orders and broadcasts commands and never simulates. The socket
  lives in the worker. The handshake compares the build id, the catalog hash and the module list. Each build is served
  at an immutable versioned URL (Workers versions or R2), and a lobby pins one.
- **Desync:** root hashes differ, peers swap section digests, both dump the first bad turn, the host sends a snapshot.

### Saves

- **Envelope:** `{ format: 2, base: { id, hash }, names, sections }`.
- **Index-coded catalogs** get name tables: grounds, biomes, plant species, plant states, crops, eras and monument
  damage. Columns and fields declare catalog references through `catalogRef(...)` codecs, and the name tables are
  collected from the codecs used, so a missing table is a type error.
- **Name-coded catalogs** are saved as names already: animal kinds, buildings, weapons, resources, technologies and
  weather. Each gets `formerNames` and a policy for unknown names. Power ids are not saved.
- **Unknown names:** each catalog declares `fallback(name)` or `drop`. A row with an unknown name in a slot- or
  cell-addressed store (a module plant, a module building) loads as an inert placeholder: it keeps its slot, serial,
  occupancy and generation, carries its original name in a side table, is excluded from every query, from rendering
  and from simulation, and is written back unchanged. Renames are `formerNames`, never dropped.
- **The logical schema** is designed once, before any memory refactor: things as records keyed by kind name with
  serials; health as a share; fields by name; lava as per-volcano cell runs in their saved order plus the tongues,
  which after R4 assigns a cell listed by two volcanoes to the later one; jobs and transients as records. Later steps
  change memory and section code, never what is on disk.
- **Shape changes are additive.** A new key has a default. A key never changes meaning: a new meaning gets a new key,
  and the reader keeps reading the old key as a fallback forever.
- **One frozen legacy reader**, `legacy-snapshot-1.ts`, maps today's `SAVE_VERSION = 1` snapshot into the logical
  schema, with copies of every implicit index order frozen inside it (`OLDER_SAVE_PLANT_SPECIES`, ground and biome
  orders, crop codes, plant states, eras, health maxima). It is written once and never grows. This is not a
  per-version remap table: there is exactly one, for the shape that predates self-describing saves.
- **Schemas** are `zod/mini` `looseObject` with per-field defaults, and the loader keeps the parsed output (today
  `z.custom` in `saved-world.ts` throws it away). The worlds listing record and the journal get their own versioned
  schemas; the journal folds into the chronicle section as `{ id, values }`, and an unknown category falls back per
  entry instead of dropping the whole journal.
- **Older and newer builds.** Every merge deploys, and the PWA's `skipWaiting` and `clientsClaim` keep old tabs
  running old code, so version skew is routine. A build never autosaves over a save of an unknown or newer format and
  shows a "newer build" notice (S0, first). After S2, saves also carry today's v1 snapshot for one release, so a
  revert keeps every save loadable. Unknown sections are kept verbatim and written back. A save that loaded with
  losses is never autosaved over; the game writes a copy and marks it.
- **Saved now that wasn't:** jobs, paths through `pathRef`, `claimedPlants`, tornadoes, meteors, arrows, grabs, tasks
  in steps, water settling counted in steps, derived-layer pending lists. `snapshot()` never returns `null`.
- **`WorldBase`**: when a world is created, its 12 terrain layers, water features, springs with their evaluated pond
  outline radii, crossings, monuments and deposits are stored once, losslessly (row delta, byte-plane shuffle, gzip
  through `CompressionStream`: 5.7 MB against 16 MB raw for seed 7 at 640²), with name tables for its index planes in
  its header. It lives in its own IndexedDB database, `ashfolk-bases`, so the saves database never needs a version
  bump. Loading reads the base instead of regenerating, which saves 3.5–9 s, and the runtime reads pond radii instead
  of recomputing them from the seed.
- **Base and save ordering.** No transaction spans two databases, so the first save of a world waits for its base
  commit, or embeds the base when it is missing. Orphan collection deletes only bases unreferenced for seven days and
  not open in a live session, under a `navigator.locks` lock shared across tabs. On load the stored bytes are checked
  against `hash`; on a mismatch or a missing base the game regenerates, checks the fingerprint and says so.
- **Old saves** attach a base at their next load: loading regenerates the island anyway, and on a fingerprint match the
  base is written. Saves without a fingerprint keep regenerating on every load until the player confirms the land.
- **Generator changes** wait until `WorldBase` has shipped (S3, fast-tracked). Saves never opened since then hit the
  land-changed dialog, unless the owner keeps a frozen copy of the generator ([open decision
  1](#open-decisions-for-the-owner)).
- **Fixtures:** every save shape shipped from 0.8 on has a fixture. The author runs `bun run fixtures` when the save
  schema hash changes, and CI fails when it changed without a new fixture. Every fixture loads; a fixture without a
  base loads through the frozen generator while it exists and through the land-changed dialog after. The
  `save, load, run N = run N` property runs through the real envelope and serializer and compares section digests.

## Worker bridge and frames

Comlink goes. `core/protocol/messages.ts` defines generic message shapes, `assembly/protocol.ts` instantiates them
with the assembled command union and frame keys, and each side has one `send` that collects transferables:

```ts
export type ToWorker<Command> =
  | { readonly id: number; readonly kind: "create"; readonly request: WorldRequest }
  | { readonly base: WorldBase | null; readonly id: number; readonly kind: "load"; readonly save: SaveEnvelope }
  | { readonly id: number; readonly kind: "save" }
  | { readonly commands: readonly Command[]; readonly kind: "advance"; readonly realMilliseconds: number }
  | { readonly id: number; readonly kind: "inspect"; readonly target: InspectionTarget }
  | { readonly kind: "dispose" };

export type ToMain<Sections> =
  | { readonly id: number; readonly kind: "progress"; readonly share: number }
  | { readonly id: number; readonly kind: "world"; readonly payload: WorldReply }
  | { readonly id: number; readonly kind: "saved"; readonly payload: SaveEnvelope }
  | { readonly id: number; readonly kind: "inspected"; readonly payload: Inspection }
  | { readonly frame: Frame<Sections>; readonly kind: "frame" }
  | { readonly id: number; readonly kind: "failed"; readonly reason: MessageDescriptor };
```

- **Pull model** as today: one `advance` in flight. The worker's `TickSource` stamps commands.
- **Validation:** `zod/mini` checks commands only, since under lockstep they arrive from peers. Frames are trusted.
- **Frames:** `Frame<Sections>` with `Sections` mapped from the assembled frame keys. A missing key means unchanged.
  One frame per advance (up to 40 ticks) stays as today; what changes is that sections accumulate dirty state across
  ticks and clear it when built. Building a frame never mutates state that is saved or hashed.
- **Fire** goes as ignited and extinguished deltas into a mirror bitset, not the whole burning set every frame.
- **Transfers** come from each section's `transfer` list. `buffersWithin` stays as a test oracle, and a development
  check fails when a transferred buffer belongs to a live store.
- **No SharedArrayBuffer.** COOP/COEP would block the planned Whop sign-in popup and any embedded checkout, and Safari
  lacks `credentialless`. Transport stays internal to each section, so one can switch later.
- **Rendering stays on the main thread.** `engine/render` uses no DOM globals, enforced, so a worker renderer stays
  possible.

## Engine side

### Rendering

`engine/render/base/render-layer.ts`:

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

- **`THING_PRESENTERS`** in `engine/runtime`, keyed by every kind manifest with a packed frame: layer, pick
  candidates, hover and selection rings, spot, heading, footing, hand pose, visual-state channels (tint, pose
  overrides) that modules may claim.
- **`SkinnedFigures<Visual>`** holds the draw loop people and animals duplicate today (rest position, hand pose,
  footing, LOD, frustum, marker, palette). A new figure kind supplies `visualFor`, `parts`, `writePose` and `marker`.
- **`EFFECT_PRESENTERS`**, keyed by presented event: `{ clock, look, cue }`. One channel feeds rendering and audio,
  which replaces the two switches in `effect-view.ts` and `effect-sounds.ts`.
- Picking reads the mirror's `WorldReader`, not rendering's vegetation chunks.

### Models

`PLANT_LOOKS` and `ANIMAL_LOOKS` are keyed by name and replace `VARIANT_COUNTS`, `TREE_LOOKS`, `FOLIAGE_KEYS`,
`APPEARANCES` and `ANIMAL_MARKERS`. A module contributes looks for its own kinds; a look may be overridden (a paid
look) with the default as fallback. Material slots become a named list with a derived count. `HUMAN_PARTS`, the rig's
bone lists and the animation clips stay order-coupled, guarded by a test.

### Audio

`AudioPart { hearFrame, hearCommand, hearRender, dispose }` and `EmitterSource { sound, collect }`. Cues sit with their
owner: a power's in its module, a chronicle cue with its category, an ambience group with its biome tag. `cues.json`
gives each cue its owner, output path, bus, priority and volume, and `scripts/encode-sounds.ts` writes each file next
to its owner. The sound catalog is generated from the cue list, and a test fails on any sound nothing references.
Ambience measures the mirror through `MirrorSurroundings` with the snow rule from `core/world/queries`, so the rule
exists once.

## Interface

- **`design`**: primitives, `island.tsx`, `game-icon.tsx`, `settings-group` (out of a feature), backdrops (out of
  `app`). `GameIcon` takes an `IconSource`: a core name or a module's `new URL("./icon.webp", import.meta.url).href`.
  Records carry `icon` fields, which retires the eight icon maps.
- **`stores`**: engine, launch, preferences, world, interface, guide, saves, sound, focus. Stores subscribe to mirror
  section readers; panels read the engine through the handle and narrow selectors, never through `app`.
- **`panels`**: each a folder importing only `stores`, `design`, `core` and manifests. `PANELS` (in `interface/app`)
  entries are `{ id, placement, label, icon, load, connect, store }` with placements `menu`, `settings`, `journal` and
  `dock`; HUD overlays (labels, notices, guide tips, minimap, time, filming) stay wired by hand in `app`, because
  placement is design. `load` is a dynamic import, so the HUD chunk doesn't carry every panel; a chunk-load failure
  after a deploy offers a reload through `reload-page.ts`. `PANELS` derives the tab unions, both menus and the store
  resets. `INSPECTORS` is keyed by inspection kind, and modules add `inspectorRows`.
- **`app`**: the shell, the launcher, the hand-written `WideHud` and `CompactHud`, and the registries.
- **`pages`**: `pages.ts` feeds Vite's inputs. The privacy page is TSX already; its `privacy.md` text becomes JSX in
  `privacy-page.tsx`.
- **Strings**: typed message tables per module (`{ en, ru } satisfies Record<Locale, Record<MessageId, string>>`) and
  plurals through `Intl.PluralRules`. The worker sends `{ id, values }`. `tsc` catches a missing Russian line.
  Message ids are explicit and stable, because saved chronicles refer to them; old entries keep their English `text`.

## Packages

| Action | Package | Reason |
| --- | --- | --- |
| Remove | `comlink` | Last release 2024-11; its last fix never shipped. Lockstep needs messages, not a proxy. Saves 3.9 kB in each of two chunks. |
| Remove | `react-markdown`, `remark-gfm` | 100 of 122 runtime packages and a 50 kB gzip chunk that every player precaches, for one page. |
| Switch | `zod` → `zod/mini` | Same package; about 19 kB gzip less per chunk, 37 kB in all. Keeps `looseObject`, `codec`, `toJSONSchema`. |
| Add (dev) | `fast-check` | Save round trips, `save, load, run N = run N`, catalog reordering, the water rule, version skew. Depends only on `pure-rand`. |
| Add (dev, temporary) | `ts-morph` | Re-runnable moves; bundles its own TS 6, so TS 7 is fine. Removed when the moves end. |
| Later | `msgpackr` or `cbor-x` | Cloud saves, resync and replay export. Not before. |
| Optional | `idb` | If the save database grows beyond today's 304 lines of wrappers. |
| Keep | `pure-rand`, `simplex-noise` (exact already), `three`, `react`, `zustand`, Base UI, `tailwind-merge`, `clsx`, `lucide-react`, `vite-plugin-pwa`, `@fontsource-variable/nunito`, Babel and the React Compiler | Each still earns its place. |
| Keep (dev) | `@tailwindcss/typography` | Its `prose` classes still style the privacy page after I4; drop it if that page moves to plain styles. |
| Don't add | ECS libraries | 10–18× the memory per entity, 150–490× slower spawn, and snapshot loaders that remap ids. |
| Don't add | kdbush, flatbush, rbush, spatial hashes | A grid aligned to the cells is faster to rebuild and query, and deterministic. |
| Don't add | dependency-cruiser and `@swc/core` | All imports are relative, so a short Bun script over `ts.preProcessFile` resolves the graph; 18 dependencies and a native binary buy nothing more. |
| Don't add | Bun workspaces, Nx, Turborepo, Sheriff | A module spans threads; packages would split it and add a lockfile edit per power. |
| Don't add | Lingui, i18next, Paraglide | Typed tables do it with `tsc` checks; revisit for outside translators or mod catalogs ([open decision 3](#open-decisions-for-the-owner)). |
| Don't add | Event buses, DI, RxJS, XState, immer, a router, wasm hashers, `fflate`, `valibot`, `@stdlib/*`, fixed point | No need found. |

## Migration

### Rules for every PR

- Every PR passes `check`, `typecheck`, `knip`, `test` and `boundaries`, and keeps saves from 0.8 loading. Each step's
  definition of done includes its docs and tooling: AGENTS.md, CONTRIBUTING, the README code map, `.claude/agents`,
  review rules and `ship.js`.
- **Hash-neutral by default.** CI computes section digests at the merge base and at the head, for seeds 3, 7 and 11
  on small grids over 10 game days at the shortest day length, with a scripted log that casts every power and saves
  and loads halfway. It compares only sections and keys present at both; new keys must hold their defaults. A PR that
  changes digests carries the `hash-change` label and a "Hash change:" sentence in its body before `Verified:`, which
  becomes the merge commit body. CONTRIBUTING gets that line in 0.4. Hash-changing PRs merge one at a time. A
  push-to-main job compares `main^1` and `main` digests against the merged PR's label.
- **Committed hash files** exist only for generation fingerprints, re-pinned under the `hash-change` label.
- **Generation-changing PRs** (relief phases, terrain realism v2, the crossings rework) wait for S3, which ships right
  after 0.2 ([open decision 8](#open-decisions-for-the-owner)).
- **World-changing releases.** Every merge deploys, so PRs can't be batched into a release. Simulation-only hash
  changes break no save and need only a line in the next notes. A release that changes worlds raises the minor
  version, as CONTRIBUTING says. Where several PRs must land at once, they go through an integration branch
  (`migration/<phase>`) merged as one PR.
- **Merge protection.** The repository is user-owned, so GitHub's merge queue is not available. The migration uses
  required status checks, "require branches to be up to date" and a lock-label check (an owner action, [open decision
  4](#open-decisions-for-the-owner)), so a new file importing an old path can't turn main red.
- **Benches.** Gated PRs (kernel, fields, queries, rules) run allocation counts and a same-runner A/B of merge base
  and head, gated on the median of N runs. Absolute budgets run nightly, on a fixed runner and in JSC through Bun.

### Budgets

From the measured baseline (640², seed 7, about 1,000 agents: 0.7–1.2 ms per tick, 4.6–8.8 ms per advance at speed
16, worst advance 300–520 ms, frames 76–372 KB):

| Measure | Budget |
| --- | --- |
| p95 tick, 5,000 agents, 2,000 burning cells, 640², V8 and JSC | ≤ 2 ms |
| Advance at speed 16, mean | ≤ 8 ms |
| Worst advance (derived-layer rebuilds sliced) | ≤ 50 ms |
| Frame transfer, median | ≤ 128 KB |
| Frame apply on the main thread | ≤ 1 ms, no allocation in layers |
| Hash per turn, when consumed | ≤ 0.3 ms at speed 1, ≤ 1 ms at speed 16 in rain (bench case) |
| Worker heap at 768² | ≤ 250 MB |
| Tornado `rage()` at radius 140 m | ≤ 25 µs per tick |
| A winter lake freezing at speed 16 | no full navigation rebuild per tick |

### The codemod

- `scripts/moves/moves.json` maps old paths to final paths, generated from the [old to new](#old-to-new) and
  [powers](#powers-to-modules) tables. `bun run apply-moves` (ts-morph `sourceFile.move()`) is idempotent: an agent
  runs it on its own branch, then rebases. It also rewrites the 118 `new URL(…, import.meta.url)` literals and the
  HTML entry scripts, which ts-morph doesn't touch, and a test checks that each one resolves.
- **Each file moves once, to its final path.** `tornadoes.ts` goes straight to
  `modules/hazards/tornado/simulation/tornado-system.ts`, and `tornadoPositionAt` and `VolcanoView` straight to their
  modules' `shared/`, even before the module contract exists. Files that hold several future modules are split first,
  in hash-neutral hand-edit PRs (M5).
- The same PR updates `.claude/workflows/ship.js` (routing: `core/` and `<module>/simulation` to the core lens,
  `engine/`, `interface/`, `<module>/engine` and `<module>/interface` to the look lens), `.claude/agents`,
  `biome.jsonc`, `vite.config.ts` (test globs, `setupFiles`), knip, `tsconfig.*`, AGENTS.md, CONTRIBUTING and the
  README code map. A guard test fails if a file appears under an old folder, and another checks that ship.js and Biome
  globs each match at least one file.
- CI verifies a move PR by re-running the move script on the merge base and diffing against the PR tree; hand edits
  are listed explicitly.
- Move PRs run under an announced move freeze: a `move-freeze` label with a required check, and the owner merges.
  AGENTS.md gets a rebase recipe: merge the pre-move commit, run `apply-moves`, merge main.
- The exact-math rewrite is a Grit rewrite, so new code is written exact from the start.

### Phases

Impact: **H** changes hashes, **S** changes saves compatibly, **–** neither. Sizes: S under 400 changed lines, M up to
1,500, L above. "Needs" lists the steps that must merge first.

#### Phase 0: safety net

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| 0.1 | Canonical dump and section digest harness: layout-independent (entities by serial, float64, fields by cell), keys present at both sides only, the merge-base comparison in CI, generation fingerprint files | M | — | A 1% change to an erosion constant fails | – |
| 0.2 | Save fixtures per shape epoch from 0.8 (before the plant name table, 0.10), the schema-hash ratchet, `bun run fixtures`, the `save, load, run N` property as a ratchet with known failures (fire insertion order included) | M | — | Fixtures load | – |
| 0.3 | Bench project: budgets nightly, A/B and allocation counts on labeled PRs; cases for rain at speed 16 and a freezing lake | M | — | Baseline recorded | – |
| 0.4 | `bun run boundaries` in report mode with the shrink-only allowlist; Grit in warn mode; `exact-math.ts`, `hash.ts` and the ratchet that new files comply; the `hash-change` label and CONTRIBUTING line; ship gate runs `boundaries` and the digest check; AGENTS.md lists five commands | M | — | CI green; planted type-only import and `new URL` edge reported | – |
| 0.5 | Spike on a throwaway branch: the composite projects with module sides, editor speed, `tsc --build` time, Vitest projects, knip; a written result | – | — | Nothing merges | – |

#### Phase S: saves

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| S0 | Newer-save guard: never autosave over an unknown or newer format; "newer build" notice; versioned schema for the worlds listing record | S | — | A v2 record shows the notice in the previous release's reader | S |
| S3 | `WorldBase`, fast-tracked: lossless, with header name tables and pond radii; a side record keyed by save id references it, so it doesn't wait for the envelope; first save waits for the base commit; orphans collected after a grace period under a lock; loading reads the base | M | 0.2, S0 | Base hash equals stored bytes; load skips generation; a killed tab never leaves a save without a base | S |
| S1 | Name tables for index-coded catalogs; `formerNames` and unknown-name policies for name-coded ones; `catalogRef` codecs | M | 0.2 | Reordering a catalog in a test still loads every fixture | S |
| S2 | The logical envelope and section registry; sections write logical forms through adapters in new files; `legacy-snapshot-1.ts`; health as a share; lava as per-volcano runs; sparse-field `order`; inert placeholders; the journal into the chronicle; unknown sections kept; essential sections refuse; v1 dual-write for one release | 2–3× L | S1 | Every fixture loads; a fast-check test plays an N+1 save on N and reloads it on N+1 | S |
| S4a | Paths, claimed plants, transients through adapters, grabs, tasks in steps as data; `snapshot()` never null | L, 2 PRs | S2 | Known `save, load, run N` failures shrink | S |
| S4b | `JobDefinition` schema and codec for all 28 job kinds; jobs saved as `{ kind, data }` | M | S2 | Every `JobKind` has a definition; `save, load, run N` known failures reach zero | S |

#### Phase M: moves

Folder by folder, leaves first, each file once, by `apply-moves`, under the move freeze.

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| M1 | Untangle in place (18 files, one retyped import): mirror below rendering, stores and launch state out of `app`, shared stores out of features, `settings-group` to design, `chronicle`, `identifiers`, `effects` out of the simulation root, render helpers out of the render root | M | 0.1, 0.4 | Top-level and feature graphs acyclic; screenshots identical | – |
| M2 | `core`: foundation, catalog, world (the shared generation rules and the ten-file hydrology cluster, `Waypoint`, `agent-poses`, island shape and size), protocol (frame and command types, the save schema, and every main-thread import of simulation and generation: inspection types, rivalry, relation and raid views, `CalendarView`, `TICK_SECONDS`, `SIMULATION_SPEEDS`, snapshot types from `simulation.ts`, `WorldRequest`, `GenerationProgress`, `IslandSketch`, `DEFAULT_GENERATION_OPTIONS`); `VolcanoView` and `tornadoPositionAt` to their modules' `shared/` | 2× L | M1 | Boundaries zero for `core` and for engine and interface → simulation | – |
| M3 | `engine`: bridge, mirror, models (with `rig`), render, audio, input, runtime | L | M2 | Screenshots at three sizes, near and far, headless GPU Chrome | – |
| M4 | `interface`: design, stores, panels, app, pages; HTML entries | L | M2 | Browser tests, Playwright smoke | – |
| M5 | Split multi-power files into per-power files at final module paths: `element-powers.ts`, `catastrophes.ts`, `land-powers.ts`, `life-powers.ts`; `explode`, `shakeLand` and `strikeLightning` into `simulation/rules` as core actions | M, one PR per power group | M2 | Digests identical | – |
| M6 | `simulation`: kernel and runtime split from `simulation.ts` as files only, systems with society and rivalry nested, generation; the `*-api.ts` files for the 66 cross-system imports; powers into `<module>/simulation` | 2× L | M5 | Digests identical | – |
| M7 | Composite projects switch on; boundaries fails on anything not in the allowlist | S | M3, M4, M6 | `tsc --build` | – |

The allowlist reaches zero after X and T.

#### Phase K: kernel

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| K1 | Bridge: the message protocol replaces Comlink; frame and mirror sections hold today's fields; sections accumulate dirty state across ticks; `transfer` lists; new files at final paths | L, 3 PRs | 0.1 | Frame time within noise; `bun run shots` identical | – |
| K2 | Kernel shell: today's systems as `SimulationModule` adapters in today's exact order under one transitional phase, sharing the root `RandomSource`; `simulation.ts` shrinks to the runtime; the system-order fingerprint | M, 3 PRs | M6 | Digests identical | – |
| K3 | Commands only: `StampedCommand` with step and sequence; the step clock with pause as clock state and speed in the tick source; held strokes; tasks and water settling in steps; paused steps drain events; lightning at a seeded site weighted by height and canopy; the weather chronicle entry anchored to the world, not `viewFocus`; `setViewFocus` removed | L, 3 PRs | K2 | Paused-brush browser test kept as a regression guard; casting while paused shows the effect next frame | H |
| K4 | Field store, tier one: `FieldWriter` with exactly today's semantics per field (lazy removal, insertion order, no new clamps), raw kernels with bulk marks, dirty chunks and write-time digests; the 40 raw writes and about 25 manual `mark*` calls go | M, 2 PRs | K2 | Digests identical; digest verifier | – |

#### Phase C: catalog

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| C1 | The compiled catalog as a hash-neutral facade over today's content: per-group local indices, tags, multi-word flags, properties by handle, damage types, per-world `compileCatalog`, the registry by name; every per-kind table built from it; the module-scope table ban | L, 2 PRs | M2 | Digests identical; the extra-ground, extra-species test | – |

#### Phase Q: queries (the owner's headline, early)

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| Q1 | Read-only `Surroundings` over today's stores, at final paths: cell side in `core/world/queries`, `ThingSource` adapters and mover buckets in `simulation/queries`, the radial pattern, a compatibility iterator that sorts candidates by array order (serial) and scans the spawned tail | M | 0.1 | No callers changed; digests identical; bench | – |
| Q2 | Ports that keep order: `inspectCell`, picking through the mirror's reader, the shared snow rule for rendering and ambience, `livingWithin`, `nearestPerson`, `hunterNear`, `answerFoes` (about 11% of the whole profile, 14% of non-generation CPU, growing with the square of agents) | M, 3 PRs | Q1 | Fast-check equivalence against the linear scan before each port; digests identical; interleaved-inspect test | – |
| Q3 | Filters with masks and flags, area queries, `tally`, `CellFilter`, capsules and regions, materialized cell properties, `MirrorSurroundings` | M | Q1, C1 | Bench budget for the whole tornado `rage()` | – |

#### Phase D: determinism

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| D1 | Cross-engine CI: a determinism Vitest project (worker-side simulation only, no WebGPU) with Chromium, Firefox and WebKit instances, Bun, a nightly macOS runner for Apple's libm; golden math tests | M | — | Engines agree on exact-math goldens | – |
| D2 | Simulation code not reachable from `generateWorld`: the `hypot` codemod, exact math, `unitHash`, named streams with saved states, power streams; Grit becomes an error there | 3× M | K3 | Engines agree on the 10-day digests | H |
| D3 | Canonical orders: bitset active sets, sorted plant lists, saved free lists, derived links no longer saved; derived layers double-buffered with saved pending lists and slice offsets; walkability hysteresis | M, 2 PRs | K4, S2 | `save, load, run N` holds, including a save mid-slice | H S |
| D4 | Order-changing query ports: radial `nearest` with squared compares, `nearestShore` as a true nearest without random probes | M | Q2, D2 | Behavior tests | H |
| D5 | Generation and everything reachable from it (hydrology cluster, crossings, vegetation rules, climate, ponds, island shape): exact math, `unitHash` with the world seed, named streams, the `seed * 19 + 7` collision | M, 2 PRs | S3 | Engines agree on generation hashes | H, fingerprint |
| D6 | Replays: a worker-side command-log recorder, a replay player, root hashes per turn, export with the embedded base | M | K3, D3, S4a, S4b | A recorded scripted game replays to the same root hash in Chromium | – |

#### Phase R: rules

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| R1 | Adopt the phases; every system that will become a module sits at its final slot (end of its phase), so extraction is hash-neutral; floors move into decay passes; clamping per field | M | K4, Q1 | Order fingerprint updated on purpose | H |
| R2 | Exposures, the batch reaction pass, transitions; the first rules (`soak-douses-fire`, `wind-blows-out-fire`, `molten-beside-water`, `heat-source-melts-snow`, embers and burning buildings adding heat); rain and snow stop calling `fire.douse`, the volcano's quench at water (`volcanoes.ts:295`) becomes `molten-beside-water`, the tornado loses its `blowOut` loops | L, 3 PRs | R1 | #242 tests unchanged; one test per rule; lava at a river stops and steams near and far | H |
| R3 | `strike` and `Blow`: first a facade that calls today's `damageArea`, `scare` and `addZone` exactly (–), then unified constants and mass and resistance scaling, then danger sources as transients | 3× M | R2, Q3, C1 | Design sign-off per behavior change (earthquakes now hurt animals); behavior tests per power; screenshots | H |
| R4 | Lava as a field in memory; volcano ownership as a side table; the lava terrain layer reads the cell-state channel | M | R3 | Volcano tests; far view | H |
| R5 | Events: typed channels drained every step; chronicle message ids; one fire discovery path; presented events as effects; `powerUsed` | M, 2 PRs | R1 | Chronicle tests | H |
| R6 | Traits (`declareTrait`, `respondTo`) with driver contracts (`flammable`, `grabbable`, `uprootable`); the `TransientStore` with column blocks per kind; the feature group for crossings and deposits; the grab chain collapses into `grabbable` and `THING_PRESENTERS` | L, 3 PRs | C1, R3 | Hand tests; pick tests | H S |

#### Phase T: tribe and fauna extension points

Announce a short society freeze for T1.

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| T1 | Bands and scoring on S4b's `JobDefinition`; `decideJob` ported so bands reproduce today's order for all 28 kinds | L, 2 PRs | S4b, R3, R5 | Digests identical | – |
| T2 | Columns, property modifiers folded per tribe and kind, considerations | M | C1, T1 | Inspector explains a property | – |
| T3 | Tribe store with columns and stock, relations, `TribeRelation` queries, the `claim` field derived from saved `Claim` circles (the rivalry section keeps reading `claims`), the membership API, lifecycle events | M | T1 | Rivalry tests | H |
| T4 | Fauna brains by kind tag; world-layer contributions to hydrology and walkability (`barsFlow`, `blocksMovement`, `bridges`) | M | R6 | A test dam raises a lake after load | – |

#### Phase X: module extraction

The tornado goes alone first as the pilot, after Q3, R5, R6 and D2 (named streams, so creating systems inside modules
draws nothing from a shared parent); its touched-file count is recorded against the walkthrough. Then one PR per
module from the [powers table](#powers-to-modules), one agent and worktree each; the volcano waits for R4. Each is
hash-neutral, because R1 put its systems at their final slots. New modules append to `MODULES`.

#### Phase E: engine

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| E1 | Render stages, `RenderLayer`, `RenderServices`; cell-state pages over today's surface packing; terrain layer channels; the sampler test | L, 3 PRs | M3, K1 | Screenshots at three sizes, near and far; stage order test | – |
| E1b | Cell-state pages fed by field `mirror` definitions | S | E1, K4 | Screenshots | – |
| E2 | Effect presenters on one channel; thing presenters; `SkinnedFigures` | L, 3 PRs | E1, C1 | Screenshots; pick tests | – |
| E3 | Audio parts, emitter sources, cues next to owners, `cues.json` with owners and outputs, the generated sound catalog | M, 2 PRs | M3 | Unreferenced-sound test; each cue by ear in Chrome, Safari, Firefox | – |
| E4 | Looks keyed by name with overrides; named material slots | M | C1 | Screenshots | – |

#### Phase I: interface

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| I1 | `PANELS` and `INSPECTORS` registries, lazy panels with the chunk-failure reload, `IconSource` | M, 2 PRs | M4 | Browser tests; HUD chunk size | – |
| I2 | Message tables per module and in the core catalog; the worker sends `{ id, values }` | L, 3 PRs | M4; chronicle part after R5 | `tsc` catches a missing Russian line; old chronicles read | S |
| I3 | `zod/mini` (about 280 `z.` calls in 15 files) | M | — | Bundle sizes | – |
| I4 | `privacy.md` as JSX; react-markdown and remark-gfm removed | S | — | Privacy screenshots | – |

#### Phase G: goals and scenarios

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| G1 | `ScenarioDefinition { start: WorldRequest and spawns, rules: RulesPatch, goals: GoalDefinition[] }`, goals as declarative predicates over area measures and tribe queries, named through the registry by name; a built-in goals system at a cadence with a saved, hashed section and goal events; a `PANELS` entry | L, 2 PRs | Q3, R5, S2, I1 | Three scenarios each play to their goal in a test | S |

#### Phase L: lockstep readiness

Later, when online play enters Now, after D5 and D6: the lockstep `TickSource`, wall-time turns, the relay in
`server/`, versioned build URLs, desync dumps, two workers in lockstep in a test.

### Lanes and the critical path

| Lane | Steps | Starts after |
| --- | --- | --- |
| 0 | 0.1–0.5 | — |
| Saves | S0 → S3, then S1 → S2 → S4a, S4b | 0.2 |
| Moves | M1 → M2 → M3, M4, M5 → M6 → M7 | 0.1, 0.4 |
| Bridge | K1 | 0.1 |
| Kernel | K2 → K3, K4 | M6 |
| Catalog and queries | Q1 → Q2; C1 → Q3 | 0.1; M2 |
| Determinism | D1 any time; D2 after K3; D3 after K4, S2; D4 after Q2, D2; D5 after S3; D6 after K3, D3, S4 | — |
| Rules | R1 → R2 → R3 → R4; R5 after R1; R6 after C1, R3 | K4, Q1 |
| Tribes | T1 → T2, T3; T4 after R6 | S4b, R3, R5 |
| Modules | X pilot, then fanned out | Q3, R5, R6, D2 (volcano: R4) |
| Engine | E1 → E1b, E2; E3; E4 | M3, K1 |
| Interface | I1 → I2; I3, I4 any time | M4 |
| Goals | G1 | Q3, R5, S2, I1 |

Critical path: 0.4 → M1 → M2 → M5 → M6 → K2 → K4 → R1 → R2 → R3 → R6 → X, with K3 → D2 and C1 → Q3 joining before
X. S0 and S3 ship in the first week, off the critical path but ahead of everything else, because relief work waits on
S3. Honest size: 110–140 PRs, 55–75k changed lines with tests, 9–13 weeks at agent pace. Feature work continues
throughout; short freezes cover `simulation.ts` for K2, society for M6 and T1, and `generation/` for its move in M6,
scheduled between relief phases.

## Checklists

### A new power or hazard

1. Make `modules/<domain>/<name>/module.ts` with `defineModule`: sides, `requires`, powers, catalog contribution
   (fields, kinds, trait declarations, death causes), command declarations, icon.
2. Write `simulation/`: a system that writes fields or exposures, calls `strike`, a core action, or emits catalog
   events. Never call another system. If it should affect something, write a reaction against a field or tag.
3. Lasting state is a transient thing or a field; give anything else a save section with `reset`.
4. Add `engine/` (layer, presenter, cue) and `interface/` only if it has them; strings go in `messages.ts`.
5. Append the module to `MODULES` and add it to `POWER_ORDER`; `tsc` names the side records to fill.
6. One test per rule; check that the system order and digests change only as meant, and use the `hash-change` label
   if they do.
7. Look at near and far scenes; add a scene to the scenes list if the change only shows by eye.

### A new thing kind

1. `defineThingKind` in the owning module's `shared/`: group, tags, values by handle, traits.
2. If it needs behavior no trait has, declare a trait in `shared/` and respond in `simulation/`; promote it to core
   when a second kind uses it.
3. Fill the `THING_PRESENTERS` entry `tsc` asks for.
4. Saved references go through `thingRef`; randomness through its serial.
5. Test that `strike`, fire and the hand treat it by its properties.

### A tribe system

1. State: columns on existing groups, fields for anything spatial, side tables keyed by serial for the rest, all
   declared in the catalog contribution.
2. Behavior: `JobDefinition`s, considerations and property modifiers; never import society.
3. Facts: catalog events, or events in the module's `shared/`.
4. Panel: a frame section, a mirror section, a store subscribed to its reader, and a `PANELS` entry with `load`.

### A page

1. `interface/pages/<name>/` with the page and its entry, and the HTML shell at the URL path.
2. Add it to `PAGES` and to `public/sitemap.xml`.

### A change to generation

1. Check that `WorldBase` has shipped.
2. Re-pin the generation fingerprint files under the `hash-change` label.
3. Say in the release notes that new islands differ; saved worlds keep their land through their base.

## Deleted by the end

| What goes | Step |
| --- | --- |
| The `PowerServices` and `SocietyContext` bags | K2, R3 |
| Field lists in `simulation.ts` snapshots, `FrameBuilder` and the worker API's buffer list | K1, S2 |
| `setViewFocus` and `viewFocus` in saves | K3 |
| The 40 raw field writes and about 25 manual `mark*` calls | K4 |
| `isTreeSpecies`, `WOODED_BIOMES` and the three other biome groups | C1 |
| `fire.douse` outside fire (four callers), `buildings.blowOut`, the tornado's `blowOut` loops | R2 |
| 14 `damageArea`, 5 `scare` and 5 `addZone` calls; `DangerZone[]`; three copies of "a burning cell hurts" | R3, R6 |
| The grab chain (`grab-target.ts`, `grab-handlers.ts`, `entity-picker.ts` kind switches, `hand-motion.ts` cases) | R6, E2 |
| The `decideJob` ladder, `NIGHT_JOBS`, `UNWAVERING_JOBS`, `STEADFAST_JOBS` | T1 |
| `power-registry.ts`, `POWER_GROUPS` in content, `power-icons.tsx`, power entries in `game-icon-sources.ts` | X, I1 |
| The eight icon maps | I1 |
| The `hasLandChanged` list | K1 |
| The switches in `effect-view.ts` and `effect-sounds.ts` | E2, E3 |
| `VARIANT_COUNTS`, `TREE_LOOKS`, `FOLIAGE_KEYS`, `APPEARANCES`, `ANIMAL_MARKERS` | E4 |
| `hashToUnit` and `RandomSource.derive` in deterministic code | D2, D5 |
| `z.custom` in `saved-world.ts`; `OLDER_SAVE_PLANT_SPECIES` outside the legacy reader | S2 |
| Comlink, react-markdown, remark-gfm, full `zod` | K1, I4, I3 |
| `ts-morph` | after M7 |

## What we deliberately don't do

- **No ECS library and no generic column store for agents.** People and animals stay objects behind `ThingSource`.
- **No workspace packages.** Layers are composite projects; a module stays one folder across threads.
- **No closures per cell in the reaction pass, and no dense drivers.**
- **No state hash in single-player frames.**
- **No lazy index built by a query, and no presentation stream in the simulation.**
- **No per-version save migrations.** One frozen reader for the pre-envelope shape, then names, defaults and
  additive keys.
- **No globs, no declaration merging, no topological sort.**
- **No event bus semantics.** Events are facts drained once per step; changes to the world go through cells.
- **No SharedArrayBuffer, no OffscreenCanvas renderer, no router.**
- **No GPU compute for reactions.** Active sets keep the pass small.
- **No block counts and no code mods until a bench or a roadmap item needs them.** The query API, the registry by
  name and the catalog rounds leave room for them; scenarios arrive in G1.
- **Catalogs stay catalogs.** A species or building is a row with properties, not a module.

## Risks and open decisions

### Risks

| Risk | Mitigation |
| --- | --- |
| Hash churn re-rolls promo seeds and pinned scenes | Hash changes are labeled; re-pick seeds after D2, R3 and D5 |
| Agents re-pin digests by reflex | Merge-base comparison of shared keys only, no committed simulation hashes; the label; the ship reviewer flags hash changes without cause |
| Generic paths slower than today's kernels | Two write tiers, batch reactions, compiled cell properties, inline query loops; A/B gates on K, Q and R |
| Events become hidden coupling | Facts only; listeners write only their own state; the extension-point list is closed |
| Move conflicts with in-flight agent work | Announced move freezes, `apply-moves` on branches, a rebase recipe |
| Version skew from per-merge deploys and the PWA | S0 first; v1 dual-write after S2; inert placeholders; the chunk-failure reload |
| `WorldBase` size on phones | 5.7 MB per world lossless at 640²; check `navigator.storage.estimate()` before writing |
| Exact math speed | 1.3–1.8× in a fire-spread loop; lookup tables for per-cell factors |
| Water settling counted in steps settles faster in real time at high speed | Accepted; a constant per speed if players notice |

### Open decisions for the owner

1. **Frozen generator copy.** Keep a self-contained copy of today's generator, loaded only for saves without a base,
   until a published sunset date, so saves not opened after S3 still load after generator changes? Or accept the
   land-changed dialog for them? Recommendation: keep the copy for one minor release.
2. **The one legacy reader.** It is a single frozen adapter, not a remap table that grows. Confirm it fits the rule
   against per-version migrations.
3. **Lingui or typed tables.** Typed tables are recommended until outside translators or mod catalogs arrive.
4. **Merge protection.** The repository is user-owned, so it can't use a merge queue. Either set required checks,
   up-to-date branches and the lock-label check (recommended), or move the repository to an organization for a merge
   queue, which changes URLs, the Cloudflare environment secret and the Whop links.
5. **Rivalry** as a built-in system or a module once T3 lands.
6. **Lockstep timing.** Phase L before or after deeper tribes.
7. **Mods.** Data only (a declarative tier of power archetypes and reactions over the same runtime objects) or code
   too; code mods can't be held to the determinism rules in lockstep.
8. **Relief work and the roadmap.** Pause "Smoother, cleaner relief" until S3 ships in the first week, or keep it
   shipping with today's land-changed dialog. Either way, the roadmap's restructure item ("generation stays identical
   for a seed") needs a new done-when, because D5 changes generation once.

## Sources

Research for this plan (in the architecture run's scratch folder): `research/coupling.md`, `research/things.md`,
`research/queries.md`, `research/boundaries.md`, `research/registration.md`, `research/determinism-saves.md`,
`research/engine-ui-structure.md`, `research/ecs.md`, `research/games.md`, `research/modules-ts.md`,
`research/spatial-queries.md`, `research/determinism.md`, `research/worker-bridge.md`, `research/packages.md`; the three
proposals in `proposals/`; the critics' benches in `bench/`, `critic-perf/` and `critic-migration/`; the validators'
probes in `validator/`; the sketch typecheck in `editor-check/`.

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
- [TypeScript: `preProcessFile`](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Biome: plugins](https://biomejs.dev/linter/plugins/), [noRestrictedImports](https://biomejs.dev/linter/rules/no-restricted-imports/)
- [Bun: Transpiler](https://bun.com/docs/api/transpiler)
- [Zod Mini](https://zod.dev/packages/mini), [Zod codecs](https://zod.dev/codecs)
- [fast-check: model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)
- [Vitest: browser instances](https://vitest.dev/config/browser/instances)
- [GitHub: managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Is postMessage slow?, surma.dev](https://surma.dev/things/is-postmessage-slow/)
- [COOP and COEP, web.dev](https://web.dev/articles/coop-coep)
- [Cloudflare Durable Objects: WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [MDN: CompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream)
- [MDN: Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [MDN: Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)
