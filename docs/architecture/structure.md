# Structure

The target source tree: the folders and what each holds, what is a built-in system and what is a module, where today's
folders and powers go, which code may import which, and what enforces those rules.

## The tree

`src/` holds four layers (`core`, `simulation`, `engine`, `interface`), the `assembly` lists and the `modules` that cut
across the layers. `server/` and `tests/` sit next to `src/`.

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
    app/                           shell, launcher, HUD layouts, PANELS, INSPECTORS, Lingui setup (I18nProvider)
    pages/                         game, privacy, pages.ts
    locales/                       en.po, ru.po: catalogs for built-in text
    testing/
  modules/
    elements/                      fire-brush, lightning, rain, snow
    hazards/                       explosion, meteor, earthquake, volcano, tornado
    land/                          terraform, forest, paint
    life/                          tribe-spawn, wildlife, blessings
    tribes/                        sickness, trade, beliefs (later)
    things/                        boat, bridges (later)
server/                            the Cloudflare worker: redirects, media ranges, the lockstep relay (L3), later
                                   sign-in and cloud saves in R2
tests/                             Playwright and the `shots` scenes
```

In the architecture docs, `<module>` stands for a module folder, `modules/<domain>/<name>`. A module folder holds only
the [sides](modules.md) it has; the tornado has every side except an interface:

```
modules/hazards/tornado/
  module.ts            manifest: id, sides, requires, powers, catalog contribution, commands, icon URL, message ids
  messages.ts          maps each message id to a Lingui msg descriptor with that id; engine and interface sides only
  locales/             en.po, ru.po: the module's catalogs
  shared/              tornado-path.ts (pure, both threads), tornado-frame.ts (payload type), tornado-catalog.ts,
                       tornado-view.ts (filters and the area query)
  simulation/          tornado-system.ts, tornado-power.ts, tornado-simulation.ts, tests
  engine/              tornado-funnel-layer.ts, tornado-cue.ts, tornado.webm, tornado-engine.ts
```

## Built-in systems and modules

A built-in system is one that everything else reacts to or acts on, and it cannot be removed. `BUILT_IN_SYSTEMS` in
`simulation/runtime` lists them: calendar, weather, wind, fire, embers, surface (wetness, snow, scorch), water
settling, vegetation growth and succession, movement and navigation, crowding, fauna, society, rivalry, the hand and
the chronicle.

A module is anything you can delete without breaking a built-in rule: every power, hazard and spawn, and later
sickness, trade, beliefs, boats and bridges.

- Natural lightning stays with weather, which calls the core action `strikeLightning`. The lightning module calls the
  same action.
- Rivalry stays built-in ([decision 5](decisions.md#owner-decisions)).
- A species that is only data stays a catalog row, not a module.

## Old to new

Every file moves once, to its final path, by script. The script's map, `scripts/moves/moves.json`, is generated from
this table and the [powers table](#powers-to-modules) ([The codemod](migration.md#the-codemod)).

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

The rules that generation and the runtime share move to `core/world`:

- `plantHeight`, `clearingAt` and `plantingChance`, today in `generation/vegetation.ts`;
- `pondShoreReach`, `altitudeChill` and `generationFingerprint`;
- the hydrology cluster that `computeHydrology` and `refreshCrossings` pull in: `hydrology`, `drainage`,
  `river-carving`, `river-chains`, `river-paths`, `river-spacing`, `springs`, `ponds`, `crossings` and `bank-regions`
  (about 1,570 lines in `hydrology`, `drainage` and `crossings` alone).

All of it is reachable from `generateWorld`, so its determinism work happens only in D5, not in D2
([Phase D](migration.md#phase-d-determinism), [exact math](determinism.md#exact-math-and-randomness)).

## Powers to modules

Each power id goes to one module. The last column names the files in `src/simulation/powers` that hold the power
today.

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

M5 splits the multi-power files into per-power files at their final module paths, M6 moves the powers into
`<module>/simulation` ([Phase M](migration.md#phase-m-moves)), and [Phase X](migration.md#phase-x-module-extraction)
extracts one module per PR from this table.

## Layers

Imports only go down. Each row says what its code may import. An arrow inside a row orders sublayers: each may import
the sublayers before it, never the ones after.

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
| `<module>/engine` | `engine/{mirror,models,render,audio}`, own manifest, `messages.ts` and `shared/` |
| `engine/runtime` | all of `engine`, every `<module>/engine` |
| `interface/design` → `stores` → `panels` | lower sublayers, `core`, `assembly`, `engine/bridge` handle types, `engine/mirror` readers |
| `<module>/interface` | `interface/{design,stores}`, `engine/mirror` readers, own manifest, `messages.ts` and `shared/` |
| `interface/app` → `pages` | all of `interface`, `engine/runtime`, every `<module>/interface`, every module's `locales/` catalogs |
| `server` | `core/foundation`, `core/protocol` |
| `<layer>/testing` | its layer and lower layers; imported only by test files |

Panels never import panels.

About 70 imports cross system folders today: 66 run between `agents`, `fauna`, `society` and `hand`, and 47 of those go
from society to agents, mostly for `Waypoint` and `Mover`. `Waypoint` moves to `core/world`; the rest go through the
`*-api.ts` files that M6 creates.

## How it is enforced

Each rule has one owner.

1. **Composite tsconfig projects** own the layer references:
   - `core`, with `assembly`, `module.ts` and `shared/`;
   - `simulation`, with `<module>/simulation`;
   - `engine`, with `<module>/engine`;
   - `interface`, with `<module>/interface`;
   - `server`, with Workers types;
   - `node`, for scripts, `tests/`, `vite.config.ts` and `lingui.config.ts`.

   Tests stay in their layer's project, as today, so `core`, `simulation` and `engine` tests keep
   `noUncheckedIndexedAccess` off and `interface` tests keep it on. References follow the layer table, and TS6202
   rejects a cycle.
2. **`bun run boundaries`** owns imports. It reads every file with `ts.preProcessFile`, which reports type-only
   imports and re-exports, and adds a pass for `new URL("…", import.meta.url)`. It strips `?raw` and other query
   suffixes before resolving. `Bun.Transpiler.scanImports` drops `import type` and never reports `new URL`, so it
   serves only the worker-reachability check, where type imports really are erased. The script checks:
   - the layer table;
   - `requires` between modules, which must be acyclic;
   - that panels stay apart;
   - that systems reach each other only through `*-api.ts`;
   - that nothing reachable from the worker entry reaches `three`, `react` or `zustand`;
   - that every file reachable from the worker entry sits inside Grit's scope.

   A test plants a type-only import and a `new URL` edge and expects both reported. The script starts in report mode
   with an allowlist file that may only shrink.
3. **Biome and Grit** own syntax.
   - `deterministic.grit` is scoped to `core/{foundation,catalog,world}`, `simulation/**`,
     `<module>/{module.ts,shared,simulation}` and `assembly`. It allows only the `Math` calls `abs`, `ceil`, `floor`,
     `round`, `trunc`, `sign`, `min`, `max`, `sqrt`, `fround`, `imul` and `clz32`, plus the `Math` value properties
     (`PI`, `E`, `SQRT2`, `SQRT1_2`, `LN2`, `LN10`, `LOG2E`, `LOG10E`). It bans `**`, `Math.random`, `Date`,
     `performance`, timers, `Intl` and `toLocale*`.
   - A second rule bans module-scope tables built from catalogs (`Float64Array.from(GROUNDS, …)`,
     `PLANT_SPECIES.map(…)`) in `core`, `simulation` and `engine` code.
   - `noRestrictedGlobals` keeps DOM globals out of `engine/render`.
   - `noRestrictedImports` stays only for bare-package feedback in the editor.
4. **Tests** own what types can't see:
   - every registered handle resolves (`modules.test.ts` boots every module);
   - the system order fingerprint;
   - frame and mirror keys match;
   - save section keys are unique;
   - every `JobKind` has a definition;
   - sounds are all referenced;
   - a catalog with one extra ground and one extra species runs a day with no `NaN` and no undefined lookup.
