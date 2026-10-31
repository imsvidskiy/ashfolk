# Architecture plan

This plan rewrites Ashfolk's structure so that a power, hazard, thing kind, tribe system or page is one folder plus a
few typed registry lines, so that every thing and every cell exposes declared properties, and so that any system can
ask "what is around here" through one typed, fast, deterministic API. It keeps the rules in
[AGENTS.md](../AGENTS.md#rules-that-are-easy-to-miss): the engine never imports React, the simulation never imports
rendering, generation and the simulation are deterministic for a seed, commands are validated at the worker boundary,
saves keep loading (from format 2 on), and large stores stay in typed arrays.

This page is the plan in brief. Each topic has its own file in `architecture/`, [listed below](#architecture-files) in
reading order, and the [migration](architecture/migration.md) steps are PR cards that `/ship` and agents cite by id.
The plan replaces the previous one ([what changed](architecture/goals.md#from-the-previous-plan)). The owner's
decisions are in [Decisions and risks](architecture/decisions.md#owner-decisions).

## Layers

Four layers, an assembly list and modules. Imports only go down ([Layers](architecture/structure.md#layers),
[the tree](architecture/structure.md#the-tree)).

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

## Five concepts

1. **Fields and cell properties.** Every cell value (fire, heat, wetness, acid) is a declared field; derived values
   (effective biome, walkable, flammability) are compiled cell properties
   ([Cells and things](architecture/cells-and-things.md#cell-fields-and-cell-properties)).
2. **Things with kinds.** Plants, animals, buildings, people, transients (tornadoes, meteors, embers) and features
   (crossings, deposits, bridges) answer one `ThingSource` interface. Kinds carry tags, numeric properties and traits
   ([Things](architecture/cells-and-things.md#things-kinds-tags-flags-and-properties)).
3. **Three effect channels.** Cells (fields and [reactions](architecture/cells-and-things.md#reactions)),
   [`strike`](architecture/cells-and-things.md#strike) (force and harm on an area) and
   [events](architecture/kernel.md#events) (facts). Module code reaches core only through typed `ModuleContext`
   services ([Context services](architecture/modules.md#context-services)).
4. **One query API.** [`Surroundings`](architecture/queries.md) answers "what is here" with a fixed order and no
   allocation.
5. **Commands in, frames out, saves by section.** Stamped [commands](architecture/kernel.md#commands) drive the
   worker; [frames](architecture/bridge.md#frame-sections) and [saves](architecture/saves.md) are built from sections
   that modules contribute; saves describe themselves with name tables. A world stores its whole island in a
   `WorldBase` ([Saves](architecture/saves.md#the-world-base)).

## The tornado in one breath

Each tick it measures its disc once (`dominantBiome`, trees by species, fire, people by tribe), grows over water and
slows in forest, stamps a gust that blows fires out through a reaction, and strikes movers and buildings scaled by
their mass and wind resistance. It edits nothing outside `modules/hazards/tornado`
([the walkthrough](architecture/walkthroughs.md#the-tornado-one-tick)).

## Phases

0 safety net → S saves (the newer-save guard first) → M moves → K kernel → Q queries with C catalog → R rules →
T tribes → X module extraction, with D determinism, E engine, I interface (translation with Lingui first, right after
M4) and G goals alongside. L lockstep starts once D2, D5 and D6 have merged and comes before the deeper-tribe
modules (sickness, trade, beliefs).

About 120–150 PRs, 60–80k changed lines with tests, 10–14 weeks at agent pace, lockstep included. Main deploys green
through every step. [Migration](architecture/migration.md#phases) has every step, and
[Lanes and the critical path](architecture/migration.md#lanes-and-the-critical-path) shows what runs side by side.

## Architecture files

Read them in this order.

| File | What it covers |
| --- | --- |
| [Goals and principles](architecture/goals.md) | The goals and the test for each, why this design, what changed from the previous plan, the principles |
| [Structure](architecture/structure.md) | The source tree, built-in systems and modules, where today's folders and powers go, the layer rules and how they are enforced |
| [Kernel, commands and events](architecture/kernel.md) | Choosing a mechanism, the step and its tick phases, commands, events |
| [Cells and things](architecture/cells-and-things.md) | Fields and cell properties; things with kinds, tags, flags, properties and traits; reactions; `strike` |
| [Context queries](architecture/queries.md) | `Surroundings`: where it lives, its interfaces, filters and area queries, guarantees, indexes |
| [Modules and registries](architecture/modules.md) | The manifest, the assembly lists, the catalog per world, the simulation side and its erased runtimes, society and fauna extension points |
| [Walkthroughs and checklists](architecture/walkthroughs.md) | One tornado tick, acid rain, a boat, sickness with a journal panel, and a checklist for each kind of change |
| [Determinism, replays and lockstep](architecture/determinism.md) | Exact math and random streams, canonical orders, hashing, replays and lockstep |
| [Saves](architecture/saves.md) | Save sections, the envelope and name tables, the logical schema, older and newer builds, the world base, fixtures |
| [Worker bridge and frames](architecture/bridge.md) | The messages that replace Comlink, frame and mirror sections |
| [Engine and interface](architecture/main-thread.md) | Rendering, presenters, models, audio, the interface and its translated strings |
| [Packages](architecture/packages.md) | Which packages are removed, switched, added, kept and turned down, and why |
| [Migration](architecture/migration.md) | Rules for every PR, budgets, the codemod, the phases as PR-sized steps, lanes and the critical path |
| [Decisions and risks](architecture/decisions.md) | The owner's decisions, the risks and their mitigations, what the design rules out, what is deleted by the end |

[Research](architecture/research/README.md) tells how the plan was made: three designs, five critics on each and four
validators, against `main` at v0.10.0.
