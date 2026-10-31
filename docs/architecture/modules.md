# Modules and registries

A module is one folder, `modules/<domain>/<name>`, that holds a power, hazard or spawn, and later a tribe system or a
thing kind. This file covers the manifest a module declares, the assembly lists that register it, the catalog compiled
per world, the contract its simulation side implements, and the extension points that let tribe systems add behavior
without editing society. What counts as a module and what stays a built-in system is in
[Built-in systems and modules](structure.md#built-in-systems-and-modules); the [walkthroughs](walkthroughs.md) show
whole modules.

Every module has `module.ts` and may have a `shared/` folder; both threads read them. Beside them it has up to three
**sides**, one folder per layer it reaches: `simulation/`, `engine/` and `interface/`. A folder holds only the sides it
has, and the manifest's `hasSimulation`, `hasEngine` and `hasInterface` say which ones.

## The manifest

`core/catalog/handles/define-module.ts`:

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
```

- **`module.ts`** carries ids, numbers, zod/mini schemas, the catalog contribution, command declarations, an icon URL
  and message ids. The catalog contribution can hold fields, kinds, tags, trait declarations, columns, properties,
  damage types, death causes, events, grounds and biomes. [Cells and things](cells-and-things.md) describes the
  fields, kinds, tags, traits, columns, properties and damage types, and [Events](kernel.md#events) the events.
- **Message text** lives in `messages.ts`, as Lingui `msg` descriptors for the ids that `module.ts` declares, and only
  the engine and interface sides import it, so the worker bundle carries no strings ([Strings](main-thread.md#strings)).
- **`requires`** lets a module import the `shared/` of another module. `modules.test.ts` checks that the graph is
  acyclic and that each required module comes earlier in `MODULES`. An optional dependency resolves the other
  module's handle at creation and gets `null` when that module is absent.

## Assembly lists and side records

`MODULES` in `assembly` is the one list of modules. The simulation and engine sides each have a **side record** in
their layer's runtime, the only code that imports that side of every module: `SIMULATION_MODULES` in
`simulation/runtime` and `ENGINE_MODULES` in `engine/runtime`. Interface sides register in the `interface/app`
registries, such as `PANELS` ([Interface](main-thread.md#interface)).

`assembly/modules.ts`, with the simulation side record from `simulation/runtime`:

```ts
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

- **A side record lists exactly the modules that declare that side**, so `tsc` names a missing or an extra one. Side
  records are keyed objects, sorted to cut merge conflicts. Iteration never follows a side record; it always follows
  `MODULES`.
- **`MODULES` order means something.** It orders module systems, reactions, listeners and catalog rows within a
  group. A new module is appended at the end; inserting it anywhere else is a hash change, which carries the
  `hash-change` label ([Rules for every PR](migration.md#rules-for-every-pr)). Precedence that matters, such as the
  order of cell property contributions, is explicit `priority` data, never list position.
- **`POWER_ORDER`**, also in `assembly`, is the dock order.

## The catalog per world

The catalog is a per-world value. `compileCatalog(MODULES, scenario)` runs base rows, then module contributions in
`MODULES` order, then scenario rounds when a scenario sets them. The result is frozen and hashed into replays and the
lockstep handshake ([Replays and lockstep](determinism.md#replays-and-lockstep)). It is passed to `generateWorld` and
to every `create()`, so generation places module species and grounds too. `assembly` keeps the module list and the
base compile.

A per-world **registry by name** for every handle kind is compiled with the catalog. Save name tables
([Saves](saves.md)) and scenarios ([Phase G](migration.md#phase-g-goals-and-scenarios)) name handles through it. There
are no data packs: new content is written in this repository as modules and catalog rows
([decision 7](decisions.md#owner-decisions)).

## The simulation side

A module's simulation side exports a `SimulationModule`. Its `create` receives a `ModuleContext` and returns a
`ModuleRuntime`: the lists of everything the module contributes to the kernel.

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

### Runtime lists

`defineRuntime({ systems: [...] })` fills the empty lists, so a module lists only what it uses. Built-in systems use
the same contract and register in `BUILT_IN_SYSTEMS` in `simulation/runtime`.

Every runtime list holds **erased runtimes**: non-generic objects that keep a module's own types inside.
`defineSaveSection<Saved>`, `handleCommand`, `listen`, `defineFrameSection` and `defineTask` take a typed spec and
return such an object, which parses its input with its own schema. A module's typed save section therefore fits
`readonly SaveSection[]` under `strictFunctionTypes` with no `as`.

Where each list is described:

| List | Described in |
| --- | --- |
| `systems` | [Steps, ticks and phases](kernel.md#steps-ticks-and-phases) |
| `commands`, `powers` | [Commands](kernel.md#commands) |
| `listeners` | [Events](kernel.md#events) |
| `reactions` | [Reactions](cells-and-things.md#reactions) |
| `traitResponses`, `propertyModifiers` | [Things, kinds, tags, flags and properties](cells-and-things.md#things-kinds-tags-flags-and-properties) |
| `tasks` | [Replays and lockstep](determinism.md#replays-and-lockstep) |
| `saves` | [Save sections](saves.md#save-sections) |
| `frames` | [Frame sections](bridge.md#frame-sections) |
| `jobs` | [Society and fauna extension points](#society-and-fauna-extension-points), below |

### Context services

A module's simulation code reaches the world only through the `ModuleContext` services it gets in `create`. Among
them:

- **`actions`** is `CoreActions`: `strikeLightning`, `explode`, `shakeLand`, `kill` and `spawn`.
- **`terrain`** is the `TerrainEditor`. It batches height and ground edits and feeds the derived layers' pending lists
  ([Derived layers](kernel.md#derived-layers)).
- **`query`** is `Surroundings` ([Context queries](queries.md)), and **`strike`** applies a `Blow` to an area
  ([Strike](cells-and-things.md#strike)).
- **`random`** hands out named streams ([Exact math and randomness](determinism.md#exact-math-and-randomness)), and
  **`events`** emits typed events ([Events](kernel.md#events)).

## Society and fauna extension points

With these, a tribe system adds behavior without editing society, and a new animal gets a brain without editing
fauna. They land in [Phase T](migration.md#phase-t-tribe-and-fauna-extension-points).

- **Jobs.** `JobDefinition { kind, band: "survive" | "duty" | "work" | "leisure", schema, score, start, update,
  isInterruptible }` covers all 28 job kinds: the 21 in `society/jobs`, `idle` among them; `defend`, `envoy`, `fight`,
  `hide` and `mourn` in `rivalry/defense-jobs.ts`; `raid` in `rivalry/raid-job.ts`; and `pick` in `era-work.ts`. Job
  decisions take the bands in band order and pick the best proposal per band. This replaces the `decideJob` ladder and
  the `NIGHT_JOBS`, `UNWAVERING_JOBS` and `STEADFAST_JOBS` sets. Jobs save as `{ kind, data }`; an unknown kind loads
  as idle.
- **Considerations.** A module adds a weight to an existing job's score (`sleep` when sick) without importing society.
- **Animal brains** are registered by kind tag in fauna, so a beaver brain is a registration.
- **Lifecycle events**: `personBorn`, `personDied`, `personJoinedTribe`, `tribeFounded`, `tribeExtinct`.
