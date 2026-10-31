# Goals and principles

What the architecture must achieve, why this design was chosen, what changed from the previous plan, and the
principles every other file follows.

## Goals

Each goal answers one of the owner's asks and names the test that shows it is met. "Outside edits" are edits to files
outside the module being added.

| Ask | Goal | Done when |
| --- | --- | --- |
| Modular | A power, hazard, thing kind, tribe system or page is one folder plus typed registration lines. Only the [assembly lists](modules.md#assembly-lists-and-side-records) name modules. | The four [walkthroughs](walkthroughs.md) hold with the outside edits they state; a test boots every module and fails on an unregistered handle. |
| Properties everywhere | Cells expose [fields and derived properties](cells-and-things.md#cell-fields-and-cell-properties); things expose [kinds, tags, flags, properties and traits](cells-and-things.md#things-kinds-tags-flags-and-properties). Effects go through cells, [`strike`](cells-and-things.md#strike) and [events](kernel.md#events), never per-pair calls. | No `fire.douse`, `buildings.blowOut`, `damageArea` or `isTreeSpecies` call outside their owners; one test per rule. |
| Context queries | One [`Surroundings`](queries.md) API answers cell reads, area measures and thing queries with a fixed tie order and no allocation, in the worker, with a mirrored subset on the main thread. | The tornado's whole `rage()` reads biome, trees by species, fire and people for under 25 µs at radius 140 m (a [bench budget](migration.md#budgets)). |
| Not flat and huge | Four layers with a few sublayers each, modules grouped by domain, at most four folders deep under `src/`. | [The tree](structure.md#the-tree); a [boundaries check](structure.md#how-it-is-enforced) that fails on a wrong import, type-only imports and `new URL` included. |
| Packages | Drop what earns nothing, add only what removes work. | Comlink, react-markdown and remark-gfm gone; `zod/mini`; Lingui is the only new runtime dependency ([Packages](packages.md), [decision 3](decisions.md#owner-decisions)). |
| Deep rewrite | The kernel, saves, frames, queries, rules and composition are rewritten; leaf code moves once by script. | Main deploys green through every step; from format 2 on, saves keep loading in every later build ([decision 1](decisions.md#owner-decisions)). |

## Why this design

Three designs were proposed and reviewed. This plan builds on the
[data-oriented evolution](research/proposals/evolve.md). It scored highest (mean 5.2, against 5.0 for
[ECS-first](research/proposals/ecs.md) and 4.8 for [hard boundaries](research/proposals/packages.md), which made each
layer a workspace package) and was the strongest on determinism and saves. Its weakest scores were migration (4) and
simplicity (5), so most of what the plan takes from the other designs and from the reviews fixes those two.
[Research](research/README.md) has the designs, the reviews and the scores.

| Taken from | What |
| --- | --- |
| Data-oriented evolution | Typed-array fields with active sets; the SoA `VegetationStore`; layers plus modules; the field / cell property / exposure split; `Surroundings` with a fixed tie order; `strike`; save and frame sections; name tables with `formerNames`; `WorldBase`; exact math; commands only; a typed event queue. |
| ECS-first | One compiled kind catalog with per-kind property arrays; the generational slot for plants; event-driven thing responses; the kind manifest that both threads read; the rule that state is either saved or derived. |
| Hard boundaries | A throwaway spike before risky moves; one ordered list of systems pinned by a test; module-owned standard events in the catalog; generic events with a `cause`; the worker-closure check; fields and exposures merged into one concept. |
| Critics and validators | Canonical iteration orders; a logical save schema; lossless `WorldBase`; batch reaction kernels; no dense drivers; numeric bench gates; typed handles; an assembly layer; declarations apart from behavior; erased runtimes instead of generic arrays; facades before storage changes; each file moves once; turns in wall time; a step counter apart from game time. |

Rejected:

- **Workspace packages.** About 90 tsconfigs and a lockfile edit per module, for nothing that composite projects and a
  boundaries check don't give.
- **A generic column store for people and animals.** A rewrite of the busiest folder with no measured need.
- **Closures per cell in the reaction pass.** 4.5–12× slower than a direct loop.

## From the previous plan

This plan replaces the previous `docs/plan.md`. The table lists what changed and why.

| Previous plan | This plan | Why |
| --- | --- | --- |
| 17 top-level folders (`shared`, `content`, `world`, `elements`, `generation`, `simulation`, `mirror`, `modules`, `models`, `rendering`, `audio`, `game`, `stores`, `design`, `features`, `pages`, `app`) | `core`, `simulation`, `engine`, `interface`, plus `assembly`, `modules` and `server` | The owner found the flat list huge |
| `elements/` for fields, exposures and the reaction pass | Field declarations in `core/catalog`; stores and passes in `simulation/state` and `rules` | Declarations are data both threads need; passes are worker-only |
| `mirror/` shared by engine and interface | `engine/mirror` with typed section readers; frame shapes in `core/protocol` | The interface subscribes to readers instead of importing engine internals |
| `features/` | `interface/panels` with a `PANELS` registry | Tabs, menus and resets derive from one list |
| Layers enforced by `noRestrictedImports` | Composite projects plus `bun run boundaries` | The [layer table](structure.md#layers) needs type-only imports and `new URL` edges checked |
| Comlink kept | Removed | Lockstep needs messages, not a proxy |
| Save sections and a ground name table | Logical schema, name tables for every index-coded catalog, `WorldBase` | No per-version remaps; generator changes stop breaking saves |
| A systems runner in today's order | Phases with a pinned order and a step clock apart from game time | Pause, replays and lockstep |
| No event bus in the worker | A typed queue of facts, drained once per step | Chronicle, effects, sounds and listeners need one channel; facts are never requests |
| Out: renaming folders that work | Every file moves once, to its final path | The layer graph needs it |
| Kept | No ECS, no globs, no topological sort, no router, no GPU compute for reactions, facades first, moves by a ts-morph script | Still right |
| About 38 PRs, 4–6 weeks | About 120–150 PRs, 10–14 weeks, lockstep included | Saves, kernel, queries, modules and lockstep ([decision 6](decisions.md#owner-decisions)) are in scope |

## Principles

1. **Four layers, the assembly list and modules.** `core` is at the bottom, `simulation` and `engine` sit above it, and
   `interface` is on top. A module cuts across them with one folder per side. Imports only go down, and sublayers only
   import lower sublayers ([Layers](structure.md#layers)).
2. **Data in typed arrays, behavior in systems, meaning in the catalog.** A kind is a row with tags and numbers. Code
   reads properties and tags, never lists of kinds.
3. **Three effect channels between modules, typed services with core.** Modules affect each other only through:
   - **Cells:** emitters write fields; reactions turn fields into fields; things respond to the cells they stand on.
   - **`strike`:** force and harm on the things in an area, scaled by their properties.
   - **Events:** facts for the chronicle, effects, sounds and other modules' listeners. An event is never a request.

   Core actions (`strikeLightning`, `explode`, `shakeLand`, `kill`, `spawn`, terrain edits) are `ModuleContext`
   services. Every other hook is one of the named extension points in
   [Choosing a mechanism](kernel.md#choosing-a-mechanism).
4. **Declarations are data; behavior binds to them.** Fields, kinds, tags, flags, properties, traits, columns, events,
   commands, damage types and death causes are declared as data in `core/catalog`, a `module.ts` or a module's
   `shared/`, so both threads see them. Simulation code binds behavior to them by handle: `respondTo`,
   `handleCommand`, `listen`, reactions.
5. **One way to ask "what is here".** [`Surroundings`](queries.md), with a fixed order, no random draws and no
   allocation.
6. **Commands in, frames out.** The simulation takes stamped commands. Real time lives in the tick source only
   ([the kernel](kernel.md#steps-ticks-and-phases)).
7. **Every engine gives the same result.** Exact math, order-free hashes, named streams, canonical iteration orders
   ([Determinism](determinism.md)).
8. **State is saved or derived.** Every structure says which. Derived means a pure function of saved state, rebuilt
   the same way live and after a load. Saves describe themselves: name tables, defaults, no per-version remaps
   ([Saves](saves.md)).
9. **Explicit, typed lists.** No globs, no declaration merging, no topological sort. Order lives in lists people read,
   precedence lives in data, and tests pin both.
10. **Facades first, storage later.** A new interface lands over today's stores without changing hashes. Storage and
    behavior change in labeled PRs.

Names mean one thing each:

- `core` is only the bottom layer. The systems everything reacts to are **built-in systems** (`BUILT_IN_SYSTEMS`).
- `step` is only the clock counter. A system's method is `run`.
