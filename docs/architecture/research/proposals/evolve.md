# Ashfolk target architecture: data-oriented evolution

**What stays:** typed-array cell fields with `CellSet` active sets, the SoA `VegetationStore`, typed content records, the worker split and colocated tests.

**What is added:**

- a **kernel**: phases, named random streams, an event queue, and save and frame sections;
- **cell fields** that declare their properties, plus a reaction pass;
- a **thing store**: handles, shared columns, tags and a spatial index;
- a typed **context query API**;
- **modules**, each split into simulation, engine and interface sides;
- **five top-level layers** in place of thirteen flat folders.

It refines `docs/plan.md`. The places where it departs from plan.md are marked *departs* in §1.

## 1. Principles

1. **Five layers.** Imports run `core → simulation | engine → interface`, and `modules` cut across them through per-side folders. Sublayers also import only downward.
2. **Data in typed arrays, behavior in systems, meaning in catalogs.** A kind is a row with tags, traits and numbers. Code reads properties, never kind lists; today there are 34 `isTree/Shrub/Rock/MonumentSpecies` calls.
3. **Elements meet through cells, and things answer to their cells.** Emitters write fields or exposures. Rules turn fields into fields. Things sample their cell and respond through their traits. A per-pair call, such as rain calling `fire.douse`, is a bug.
4. **One way to ask "what is here".** `Surroundings` answers cell reads, area summaries and thing queries, with a fixed tie order and no allocation.
5. **Commands in, frames and hashes out.** Real time exists only on the main thread. *Departs from plan.md:141-146*, because lockstep and replays need it.
6. **Exact math and order-free randomness in deterministic code.** "Deterministic" means every engine, not "within V8" (*departs from plan.md:145*).
7. **Saves describe themselves.** Every catalog stored by index has a name table, `formerNames` sit on the definitions, and every field has a default. The generated base is stored once per world. There are no per-version remaps. *Base layers move from plan.md's "long term" to before the first hash change.*
8. **A feature is one folder plus typed one-line registrations.** Records are keyed by closed id unions, so `tsc` lists what is missing. No globs, no declaration merging, no topological sort.
9. **Events are a typed queue, ordered per tick and drained at phase ends.** *Departs from plan.md's "no event bus"*: eight cross-system facts are glued by hand in `simulation.ts`, and fire discovery has two code paths.
10. **Moves are scripted; rewrites are small and pinned by hashes.** Hash changes are batched into announced releases.

**Where I argue against my own stance:** a uniform store for *everything* would be wrong.

- Plants (up to 500k, constant churn) keep their specialised store.
- People keep jobs and decisions as kind-owned records.
- What becomes uniform is the physical part: handle, position, cell, kind, tags, health on a 0–1 scale, heat, the held flag and the spatial index. Every kind exposes it through one `ThingSource` interface.

## 2. Target tree

```
src/
  core/                  pure TS on both threads; no DOM, three or React
    foundation/          exact-math, hash, random streams, noise, cell-set, channel, buffers
    catalog/             data stage: terrain/ (biomes, grounds), life/ (species, animals, buildings,
                         technologies, resources), tags, name tables, compile-catalog.ts
    world/               terrain/ (grid, sampling, footing, coast, outline), water/ (hasWater,
                         brooks, crossings, hydrology moved out of generation), spatial/ (radial
                         pattern, buckets, block counts), world-reader.ts
    protocol/            commands, messages, events, effects, frame and save envelopes
  simulation/            worker only, deterministic
    kernel/              tick runner, phases, streams, scheduler, events, sections, state hasher
    state/               cells/ (fields, properties, exposures, reactions), things/ (store, kinds,
                         traits, impact), vegetation/, world-state.ts
    context/             Surroundings, filters, area summaries
    generation/          generateWorld and its stages (core imports only)
    systems/             nature/ (weather, fire, embers, surface, growth, succession, water),
                         life/ (movement, navigation, fauna, society, rivalry), hand/
    worker/              entry, bridge endpoint, composition, simulation-modules.ts
  engine/                main thread, no React
    bridge/              protocol client, session, command clock
    mirror/              WorldMirror (implements WorldReader), mirror sections
    models/              mesh/, plants/, animals/, people/, structures/
    render/              core/ (renderer, stages, node helpers), layers/, presenters/
    audio/               engine, buses, voices, ambience, parts, emitters
    input/               camera, pointer, picking, tools
  interface/             React; noUncheckedIndexedAccess on
    design/              primitives, islands, game-icon, icon sources
    stores/              engine, launch, preferences, world, interface, guide, saves, sound
    panels/              dock, journal, inspector, minimap, settings, tribes, time, notices, …
    pages/               game, privacy, pages.ts
    app/                 shell, launcher, hud layout
  modules/
    modules.ts           MODULES, ModuleId, POWER_ORDER
    tornado/             module.ts, shared/, simulation/, engine/, interface/, locales/
    volcano/ rain/ snow/ lightning/ meteor/ earthquake/ terraform/ wildlife/ sickness/ …
server/  e2e/  scripts/  (today's worker/, tests/, scripts + moves/)
```

**Core** holds what everything reacts to: fire, water, wetness, snow, wind and weather. It also holds what everything acts on: plants, people, animals and buildings.

**A module** is anything you can remove without breaking a core rule: powers, hazards, tribe systems, and kinds with their own behavior or look. A data-only species stays a catalog row.

## 3. Layer rules and enforcement

| From | May import |
|---|---|
| `core/foundation` → `catalog` → `world` → `protocol` | only lower `core` sublayers |
| `modules/*/module.ts`, `modules/*/shared` | `core` |
| `simulation/kernel` → `state` → `context` | lower sublayers, `core` |
| `simulation/generation` | `core` |
| `simulation/systems/*` | context, state, kernel, generation, `core`; a sibling system only via its `*-api.ts` |
| `modules/*/simulation` | `simulation/{kernel,state,context}`, own `shared`, `core` |
| `simulation/worker` | all of `simulation`, `modules/*/simulation` |
| `modules/*/engine` | `engine/{mirror,models,render/core,render/presenters,audio}`, own `shared`, `core` |
| `engine/*` | `core`, `modules/*/shared`; module engine sides only via `engine-modules.ts` |
| `modules/*/interface` | `interface/{design,stores}`, own `module.ts`, `core` |
| `interface/*` | `core`, `engine/bridge` handle types, `engine/mirror` readers; module sides via `interface-modules.ts`; `app → pages → panels → stores, design`; panels never import panels |

Three tiers enforce these rules:

1. **Composite tsconfig projects.** There are four: `core`, `simulation` (+ `modules/*/simulation`), `engine` (+ `modules/*/engine`) and `interface` (+ `modules/*/interface`). Their `references` follow the table, and TS6202 rejects a cycle. A worker file that imports `three` fails `tsc`. Every project except `interface` keeps `noUncheckedIndexedAccess` off.
2. **Biome.**
   - `noRestrictedImports` for bare packages: no `three`, `react` or `zustand` below their layers, and no `comlink` anywhere.
   - `noRestrictedGlobals` keeps DOM globals out of `engine/render`.
   - A GritQL plugin, `deterministic.grit`, covers `core/{foundation,catalog,world}`, `simulation/**` and `modules/*/{shared,simulation}`. It bans `Math.random`, the transcendental functions, `hypot`, `**`, `Date` and `performance`. It starts in warn mode with an offender list.
3. **dependency-cruiser 18.7 with swc in CI** (`bun run boundaries`):
   - no imports between sibling modules (a `$1` group);
   - no imports between sibling systems except through `-api.ts`;
   - no imports between panels;
   - the worker entry never reaches `three` or `react`;
   - `no-circular` on value edges.

The moves in §14 first remove the offenders R1–R5 from the research:

- the mirror moves below rendering;
- stores move out of `app`;
- shared feature stores move to `interface/stores`;
- `tornadoPositionAt` and the grab predicates move to `modules/*/shared` and `core/protocol`;
- composition is split from leaves in `kernel/` and `render/core/`.

## 4. Core abstractions

### Kernel

```ts
export const PHASES = ["input", "weather", "emit", "react", "nature", "life", "settle"] as const;

export type PhaseId = (typeof PHASES)[number];

export interface SimulationSystem {
  readonly id: string;
  readonly phase: PhaseId;
  readonly cadence: number;
  readonly step: (tick: TickContext) => void;
}

export interface TickContext {
  readonly tick: number;
  readonly seconds: number;
  readonly random: RandomStream;
  readonly surroundings: Surroundings;
  readonly cells: CellWriter;
  readonly things: ThingWriter;
  readonly emit: (event: SimulationEvent) => void;
  readonly schedule: (task: ScheduledTask) => void;
  readonly rules: GameRules;
}

export function runTick(kernel: Kernel, commands: readonly StampedCommand[]): void {
  const { phases, events, clock } = kernel;

  applyCommands(kernel, commands);

  if (clock.isPaused) {
    return;
  }

  for (const phase of PHASES) {
    for (const system of phases[phase]) {
      if (clock.tick % system.cadence === 0) {
        system.step(contextFor(kernel, system));
      }
    }

    drainEvents(kernel, events, phase);
  }

  clock.tick += 1;
}
```

- **Order.** Systems run in `CORE_SYSTEMS` order, then `MODULES` order, pinned by a test.
- **Context.** `contextFor` gives each system its own stream. It replaces the `PowerServices` bag.
- **Pause.** A paused tick still applies commands, so brushes and the hand work while paused, and replays stay exact.

### Cell fields and cell properties

- A **field** is stored and saved.
- A **cell property** is derived on read and never saved.
- An **exposure** lasts one tick and is cleared at `settle`.

```ts
export interface FieldDefinition<Name extends string> {
  readonly name: Name;
  readonly tags: readonly CellTag[];
  readonly range: readonly [number, number];
  readonly rest: number;
  readonly snapBelow: number;
  readonly storage: "sparse" | "dense";
  readonly lifetime: "persistent" | "exposure";
}

export interface FieldReader {
  readonly name: FieldName;
  readonly active: CellSet;
  at(cell: number): number;
}

export interface FieldWriter extends FieldReader {
  set(cell: number, value: number): void;
  add(cell: number, amount: number): void;
  scale(cell: number, factor: number): void;
}

export const EFFECTIVE_BIOME = defineCellProperty({
  name: "biome",
  read: (world, cell) => {
    if (world.field("lava").at(cell) > 0) {
      return Biome.Barren;
    }

    if (world.hasWater(cell)) {
      return Biome.Water;
    }

    return world.terrain.biome[cell];
  },
});
```

**Writers.** They clamp, snap to `rest`, keep `active` current and mark surface rows dirty. That removes 40 raw writes and 25 manual `mark*` calls.

**Lava** stops being a `Map` inside `Volcano` and becomes the field `lava`, tagged `hot` and `molten`.

**Other properties:** `flammability` (ground, canopy fuel, wetness) and `airTemperature` (base, altitude, season, weather).

### Things

```ts
export type ThingId = number;

export function packThingId(slot: number, generation: number): ThingId {
  return generation * SLOT_SPACE + slot;
}

export interface ThingKindDefinition<Name extends string> {
  readonly name: Name;
  readonly formerNames: readonly string[];
  readonly tags: readonly ThingTag[];
  readonly traits: Partial<TraitConfigs>;
  readonly properties: ThingProperties;
}

export interface ThingProperties {
  readonly mass: number;
  readonly radius: number;
  readonly windResistance: number;
  readonly heatResistance: number;
}

export interface ThingSource {
  readonly group: ThingGroup;
  readonly columns: CommonColumns;
  isLive(slot: number): boolean;
  kindOf(slot: number): number;
  forEachInCell(cell: number, visitor: SlotVisitor): void;
}

export interface CommonColumns {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly cell: Int32Array;
  readonly health: Float32Array;
  readonly heat: Float32Array;
  readonly flags: Uint8Array;
}

export function strike(context: TickContext, x: number, z: number, radius: number, blow: Blow): void;
```

**Stores.**

- One generic `ThingStore` per group holds buildings, people, animals and transients: embers, tornadoes, meteors, arrows and boats.
- Person and animal behavior lives in side tables indexed by slot.
- `VegetationStore` implements `ThingSource`.
- Monuments get their own store instead of plant slots and the `seed` channel. Crossings and deposits become static sources.

**Tags and traits.**

- Tags compile to a `Uint32` mask per kind.
- Traits (`flammable`, `grabbable`, `buoyant`, `uprootable`, `frightened`, `corrodes`) are core systems that iterate their members in ascending slot order.

**`strike`** applies one `Blow` (`cause`, `harm`, `push`, `swirl`, `heat`, `fright`, `dangerSeconds`, `filter`). It scales `push` by mass and `harm` by resistance, and replaces 14 `damageArea`, 5 `scare` and 6 `addZone` calls.

### Context query API

```ts
export interface Surroundings {
  readonly tick: number;
  readonly environment: EnvironmentReading;
  readonly cells: CellReader;
  readonly things: ThingQuery;
  cellAt(x: number, z: number): number;
  visitCells(x: number, z: number, radius: number, visitor: CellVisitor): void;
  summarize(x: number, z: number, radius: number, out: AreaSummary): void;
}

export interface CellReader {
  field(name: FieldName): FieldReader;
  property<Name extends CellPropertyName>(name: Name, cell: number): CellPropertyValue<Name>;
  height(cell: number): number;
  slope(cell: number): number;
  ground(cell: number): number;
  hasWater(cell: number): boolean;
}

export interface ThingQuery {
  count(x: number, z: number, radius: number, filter: ThingFilter): number;
  any(x: number, z: number, radius: number, filter: ThingFilter): boolean;
  nearest(x: number, z: number, radius: number, filter: ThingFilter, out: ThingReference): boolean;
  collect(x: number, z: number, radius: number, filter: ThingFilter, out: Int32Array): number;
  visit(x: number, z: number, radius: number, filter: ThingFilter, visitor: ThingVisitor): void;
}

export interface ThingFilter {
  readonly groups: number;
  readonly tags: number;
  readonly kinds: Uint8Array | null;
  readonly tribe: number;
  readonly includeHeld: boolean;
}

export interface AreaSummary {
  readonly biomeShares: Float32Array;
  readonly tagCounts: Uint16Array;
  readonly tribeCounts: Uint16Array;
  waterShare: number;
  burningCells: number;
  maximumFire: number;
  meanHeat: number;
}
```

Guarantees:

- **Order.** Distances are compared squared. Cells are visited in radial order `(distanceSquared, dz, dx)`. Things inside a bucket come in ascending slot order, and ties go to the lower slot.
- **Indexes.** 40 m buckets are rebuilt lazily at the first query of a tick. Plants keep their per-cell lists plus 16×16 block counts, so a summary adds whole blocks and scans only the edge cells.
- **No waste.** No RNG and no allocation; filters are module constants.
- **Both threads.** `WorldState` and `WorldMirror` both implement the read view, so picking, ambience and the snow rule share the same code.

### Reactions

```ts
export interface Reaction {
  readonly id: string;
  readonly drivenBy: FieldName;
  readonly when: (cells: CellReader, cell: number) => boolean;
  readonly apply: (cells: CellWriter, cell: number, tick: ReactionTick) => void;
  readonly emits: SimulationEventKind | null;
}

export const SOAK_DOUSES_FIRE: Reaction = {
  drivenBy: "soak",
  emits: null,
  id: "soak-douses-fire",
  apply: (cells, cell, tick) => {
    const remaining = 1 - Math.min(1, cells.field("soak").at(cell) * tick.seconds);

    cells.field("fire").scale(cell, remaining);
    cells.field("heat").scale(cell, remaining);
  },
  when: (cells, cell) => {
    return cells.field("fire").at(cell) > 0;
  },
};
```

**Kept from plan.md:**

- Rules apply at once, in list order.
- The pass walks only the active set of the `drivenBy` field.
- `REACTIONS` is the core list followed by the modules in order.
- Chance comes from `unitHash(seed, tick, cell, salt)`.

**New:**

- Rules emit events, merged per 16×16 block.
- Grounds and fields declare threshold transitions (`quenchesInto`, `meltsInto`, `ignitesAt`), which compile into implicit rules. "Lava beside water becomes basalt and emits steam" is data.

### Modules and registries

```ts
export interface ModuleDefinition<Id extends string> {
  readonly id: Id;
  readonly powers: Readonly<Record<string, PowerDefinition>>;
  readonly catalog: CatalogContribution;
  readonly messages: MessageCatalogs;
}

export function defineModule<const Id extends string>(definition: ModuleDefinition<Id>): ModuleDefinition<Id> {
  return definition;
}

export const MODULES = [rainModule, snowModule, tornadoModule, volcanoModule, sicknessModule] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export interface SimulationModule {
  readonly fields: readonly FieldDefinition<string>[];
  readonly reactions: readonly Reaction[];
  readonly create: (setup: ModuleSetup) => ModuleRuntime;
}

export interface ModuleRuntime {
  readonly systems: readonly SimulationSystem[];
  readonly powers: Partial<PowerHandlers>;
  readonly saves: readonly SaveSection<unknown>[];
  readonly frames: readonly FrameSection<string, unknown>[];
  readonly listeners: readonly EventListener[];
}

export const SIMULATION_MODULES = {
  rain: rainSimulation,
  sickness: sicknessSimulation,
  snow: snowSimulation,
  tornado: tornadoSimulation,
  volcano: volcanoSimulation,
} as const satisfies { readonly [Id in ModuleId]: SimulationModule | null };
```

- **`CatalogContribution`** adds grounds, thing kinds, tags (`{ corrodible: ["thing:boat"] }`) and death causes.
- **`compileCatalog`** runs in three rounds: base, then modules (later also mods and scenarios), then final fixes. It freezes the result and produces a `catalogHash`.
- **Derived from the catalog:** `POWERS`, power schemas, icons, `DeathCause` and its messages. `POWER_ORDER` stays hand-written.

### Commands, events and sections

```ts
export interface StampedCommand {
  readonly tick: number;
  readonly player: number;
  readonly command: SimulationCommand;
}

export type SimulationEvent =
  | { readonly kind: "fireSeen"; readonly cell: number; readonly tribe: number }
  | { readonly kind: "thingKilled"; readonly thing: ThingId; readonly cause: DeathCauseId }
  | { readonly kind: "emberLanded"; readonly cell: number; readonly heat: number }
  | { readonly kind: "waterChanged"; readonly region: CellRegion }
  | ModuleEvent;

export interface EventListener {
  readonly kind: SimulationEventKind;
  readonly phase: PhaseId;
  readonly handle: (tick: TickContext, event: SimulationEvent) => void;
}

export interface SaveSection<Saved> {
  readonly key: string;
  readonly schema: z.ZodMiniType<Saved>;
  readonly write: (names: NameWriter) => Saved;
  readonly read: (saved: Saved, names: NameReader) => void;
  readonly reset: () => void;
  readonly afterRestore: (() => void) | null;
  readonly digest: ((hasher: StateHasher) => void) | null;
}

export interface FrameSection<Key extends string, Payload> {
  readonly key: Key;
  readonly build: () => Payload | null;
}

export interface MirrorSection<Key extends string, Payload> {
  readonly key: Key;
  readonly apply: (mirror: MirrorWriter, payload: Payload) => WorldChange;
}
```

**Commands.**

- `strokeStep { power, x, z, milliseconds }` is sampled on the main thread.
- Speed, pause and selection go into a session section that the hash skips.
- Inspection becomes a query message.

**Events.**

- They queue in the order they are emitted, and listeners run in registration order when their phase ends.
- After `settle`, they project into frame `effects` and into chronicle entries made of message ids and parameters.

**Save sections** come from every field, store, core system and module. Restore order is: base, water, navigation, sections, then `afterRestore`. A section that fails its schema resets.

**Frame sections.**

- The payload type lives in the module's `shared/`.
- The frame is `{ tick, stateHash, sections }`, mapped from the registries, and a missing key means "unchanged".
- Transfers come from `buffersWithin`.
- `apply` returns change kinds, which replaces the hand-kept `hasLandChanged` list.

## 5. Walkthrough A: the tornado for one tick

```ts
const UPROOTABLE = createThingFilter(CATALOG, { tags: ["uprootable"] });
const CONIFERS = createThingFilter(CATALOG, { tags: ["conifer"] });
const MOVERS = createThingFilter(CATALOG, { tags: ["movable"] });

function rage(tick: TickContext, tornado: TornadoRecord, summary: AreaSummary): void {
  const { surroundings, cells, things } = tick;
  const center = tornadoPositionAt(tornado.path, tornado.age);
  const force = tornado.strength * tick.seconds;
  const windX = cells.field("windX");
  const windZ = cells.field("windZ");

  surroundings.summarize(center.x, center.z, tornado.radius, summary);

  const biome = surroundings.cells.property("biome", surroundings.cellAt(center.x, center.z));
  const conifers = surroundings.things.count(center.x, center.z, tornado.radius, CONIFERS);

  tornado.debris += debrisFrom(biome, summary.waterShare, conifers) * force;

  surroundings.visitCells(center.x, center.z, tornado.radius, {
    visit: (cell, distanceSquared) => {
      const swirl = force * grip(distanceSquared, tornado.radius);

      windX.add(cell, -offsetZ(surroundings, cell, center) * swirl);
      windZ.add(cell, offsetX(surroundings, cell, center) * swirl);

      return true;
    },
  });

  surroundings.things.visit(center.x, center.z, tornado.radius * CORE_SHARE, UPROOTABLE, {
    visit: (group, slot, distanceSquared) => {
      things.disturb(group, slot, force * grip(distanceSquared, tornado.radius), "tornado");

      return true;
    },
  });

  strike(tick, center.x, center.z, tornado.radius, {
    cause: "tornado",
    dangerSeconds: tick.seconds,
    filter: MOVERS,
    fright: SCARE_REACH,
    harm: PEOPLE_DAMAGE_PER_SECOND * force,
    heat: 0,
    push: FLUNG_SPEED * force,
    swirl: SWIRL_SPEED * force,
  });

  if (summary.burningCells > 0) {
    tick.emit({ cell: surroundings.cellAt(center.x, center.z), kind: "fireWhirl", strength: summary.maximumFire });
  }
}
```

**What it learns, phase `emit`:**

- **Biome:** the derived property, which stays correct over lava or water.
- **Trees by species:** a tag filter answered from block counts.
- **Fire:** `summary.burningCells` and `maximumFire`.
- **People and animals:** `MOVERS`. `summary.tribeCounts` can feed a "tribe in the path" notice.

**How it affects the world afterwards:**

- **`react`:** `wind-blows-out-fire` reads the wind exposure and replaces `blowOut`. `wind-fans-embers` gives the fire-whirl the tornado never had.
- **`life`:** the `flammable` trait on buildings reads the now-lower cell fire, so `buildings.blowOut` disappears. `things.disturb` dispatches on the `uprootable` config: trees fall with an angle from `unitHash`, shrubs vanish, and stones and monuments have no such trait.
- **`settle`:** `thingKilled` becomes chronicle lines with the module's `tornado` death message.

**Cost:** a few block reads, about 113 cells, one bucket visit, no allocation; today 5 linear scans and 4 arrays.

## 6. Walkthrough B: the power "acid rain"

The brush stamps the exposure `soak` and the persistent sparse field `acid` (tags `wet`, `corrosive`, decays over days). Then:

- `soak-douses-fire` already exists, so fires go out for free.
- `acid-sears-canopy` lowers plant health.
- A threshold transition turns grass and meadow into `barren`.
- The `corrodes` trait harms things tagged `corrodible`, such as wooden buildings and boats.

```
modules/acid-rain/
  module.ts                        power "acidRain" (zod radius, strength), cursorRadius, icon key,
                                   tags { corrodible: [...] }, death cause
  module.test.ts
  shared/acid-frame.ts             payload type
  simulation/acid-field.ts         defineField("acid")
  simulation/acid-reactions.ts     ACID_SEARS_CANOPY, ACID_SOURS_GROUND
  simulation/acid-reactions.test.ts
  simulation/acid-rain-power.ts    stroke handler: stamps soak + acid via visitCells
  simulation/acid-rain-power.test.ts
  simulation/acid-rain-simulation.ts
  engine/acid-tint-layer.ts        TerrainLayer: R8 data texture, TSL olive tint
  engine/acid-precipitation.ts     tinted rain over the brush
  engine/acid-rain-cue.ts
  engine/acid-rain-engine.ts
  engine/acid-tint-layer.browser.test.ts
  interface/icon.webp
  locales/en.po, locales/ru.po
+ one line each: modules.ts (MODULES, POWER_ORDER), simulation-modules.ts, engine-modules.ts,
  interface-modules.ts (null), e2e/scenes.ts
```

**Size:** 17 files in one folder plus 6 registration lines; no core file mentions acid.

**Saves:**

- An old save has no `acid` field, so `acid` loads at `rest`.
- A save loaded into a build without the module drops the unknown section and logs a warning.

## 7. Walkthrough C: the thing kind "boat"

```ts
export const boatModule = defineModule({
  catalog: {
    deathCauses: {},
    grounds: [],
    tags: {},
    thingKinds: [
      {
        formerNames: [],
        name: "boat",
        properties: { heatResistance: 0.1, mass: 300, radius: 2.5, windResistance: 0.5 },
        tags: ["wooden", "corrodible", "movable"],
        traits: {
          buoyant: { draft: 0.4, driftPerFlow: 0.8 },
          flammable: { burnSeconds: 45, ignitesAt: 0.25 },
          grabbable: { liftHeight: 3, putDown: "water-or-shore" },
        },
      },
    ],
  },
  id: "boat",
  messages: boatMessages,
  powers: { placeBoat: placeBoatPower },
});
```

The traits, written once in `simulation/state/things/traits/`, carry all the behavior:

- **`buoyant`** reads `hasWater` and the water surface. A boat sits at the surface minus its draft and drifts with the river flow; aground, it stops.
- **`flammable`** raises the `heat` column from the cell's `fire` and `heat`, damped by `wetness`. Above `ignitesAt` the boat burns, heats its cell (so the reeds catch), loses health and emits `thingKilled`.
- **`grabbable`** is the generic hand handler. It marks the boat held, which the query mask excludes, and checks `putDown` through `Surroundings`.

**Files:**

```
modules/boat/
  module.ts, module.test.ts
  simulation/boat-simulation.ts, place-boat-power.ts, boat.test.ts
  engine/boat-model.ts             procedural hull from models/mesh and material slots
  engine/boat-presenter.ts         ThingPresenter: layer, pick volume, rings, hand pose
  engine/boat-engine.ts
  interface/boat-inspector.tsx, icon.webp, locales/
+ five registration lines
```

**Interactions you get for free:**

- the tornado pushes boats (`movable`, scaled by mass);
- acid corrodes them;
- lava kills them (`heatResistance` < 1 on a `molten` cell);
- saves store the kind by name.

## 8. Walkthrough D: tribe sickness and its journal panel

**State:**

- **`germs`:** a sparse persistent field, tag `contagion`.
- **`infection` and `immunity`:** module columns on the `person` group. Columns save by name, so an old save reads 0.
- **`DISEASES` rows:** routes, affected tags, incubation, curve and lethality.

```ts
const PEOPLE = createThingFilter(CATALOG, { groups: ["person"] });

function progress(tick: TickContext, columns: SicknessColumns, germs: FieldWriter, slot: number): void {
  const { surroundings, things } = tick;
  const { person } = things;
  const infection = columns.infection[slot];

  if (infection === 0) {
    catchFromGround(tick, columns, germs.at(person.cell[slot]), slot);

    return;
  }

  germs.add(person.cell[slot], SHEDDING * infection);

  surroundings.things.visit(person.x[slot], person.z[slot], CONTACT_REACH, PEOPLE, {
    visit: (group, neighbor) => {
      exposeByContact(tick, columns, slot, neighbor);

      return true;
    },
  });

  columns.infection[slot] = advanceCurve(infection, columns.immunity[slot], tick.seconds);

  if (columns.infection[slot] >= FATAL) {
    things.kill("person", slot, "sickness");
  }
}
```

**Rules and coupling:**

- **Reactions:** `germs-fade-in-sun` and `germs-thrive-in-marsh` read `wetness`, `heat` and the ground tag `marsh`.
- **Order-free chance:** contact uses `unitHash(seed, tick, pair)`.
- **Behavior through stats:** the module adds an `energyDrain` modifier to `effective("energy", person)`. Society never imports sickness.
- **Events:** `fellIll`, `recovered` and `diedOfSickness` become chronicle message ids. A future healer job listens to `fellIll`.

**The journal panel:**

- **Frame:** `shared/sickness-frame.ts` defines per-tribe counts, built once per game hour.
- **Store:** an engine mirror section feeds `useSicknessStore`.
- **Panel:** the module registers `{ id: "sickness", placement: "journal", label: msg({ id: "sickness.panel" }), icon, Content, connect }`. The journal derives its tabs from `PANELS`, and test setup resets every registered store.

**Size:** about 14 files in the module, plus a `figureTint` hook in the people presenter for pale sick people, plus 5 registration lines.

## 9. Determinism, replays, lockstep and saves

**Exact math.**

- `core/foundation/exact-math.ts` holds `sin`, `cos`, `atan2`, `exp`, `log`, `asin`, `acos` and `tanh`, ported from fdlibm and pinned by golden hashes.
- A codemod rewrites the 151 `hypot` calls as `Math.sqrt(dx * dx + dz * dz)` or as squared comparisons.
- The Grit plugin becomes an error after that.

**Hashes and random streams.**

- `hash.ts` (lowbias32) provides `unitHash`, which replaces the `Math.sin` `hashToUnit` at 43 sites.
- Named streams are `lowbias32(worldSeed ^ fnv1a32(id))` into xoroshiro128plus, with no draws from a parent. They are saved in `randomStreams`, and a missing entry is re-derived.
- An `effects` stream that the hash skips carries visual-only draws.
- Generation gets named streams too, which fixes the duplicate `seed*19+7`.

**Commands only.**

- `setViewFocus` goes. Lightning picks a seeded site weighted by height and canopy.
- Tasks become `{ dueTick, kind, data }`, and lake filling counts ticks.
- Tornadoes, meteors, arrows, grabs and jobs are saved. Jobs use a `JobType { kind, schema, update }` registry, and an unknown kind loads as idle. As a result, `snapshot()` never returns `null`.

**Hashing state.**

- `StateHasher` folds the section digests.
- Fields keep digests per 64×64 chunk, refreshed from the change trackers.
- A root hash is taken every lockstep turn of 2 ticks. Debug mode hashes everything every tick.
- Hashed fields assert that they hold no NaN.

**Replays and tests.**

- A replay holds a header (build, `catalogHash`, mods, seed, base id), the command log, the root hashes and optional keyframes.
- **Golden CI:** seeds 3, 7 and 11 run 600 scripted ticks in Node, Bun and Vitest browser instances (Chromium, Firefox, WebKit), and all must give one pinned hash.
- **fast-check:** save, load, then N ticks equals N ticks.

**Lockstep.**

- A Durable Object relay orders commands and never simulates.
- The worker owns the socket, and commands run two turns ahead.
- On a desync, peers compare section hashes and the host sends a snapshot.

**Saves.**

- **Envelope:** `{ format, base: { id, hash }, names: { grounds, biomes, plantSpecies, plantStates, crops, thingKinds, buildings, technologies, resources, monuments }, sections }`.
- **Unknown names:** each catalog sets a policy, either `fallback(name)` or `drop`, and `formerNames` resolves renames.
- **The old remap table:** `OLDER_SAVE_PLANT_SPECIES` stays frozen as the default for saves without a name table, and is never extended.
- **Schemas:** `z.looseObject` with per-field `.default()`, and the loader keeps the parsed output. Today `z.custom` throws it away.
- **Independent of generator changes:** when a world is created, its 12 terrain layers, water, springs, crossings, monuments and deposits are written once as a `WorldBase`. It goes into its own IndexedDB store, quantized and gzipped with `CompressionStream`, and saves diff against it. Terrain realism v2 then no longer breaks saves.
- **Old saves:** regenerate and compare the fingerprint. On a match, attach a base. On a mismatch, show the "land changed" dialog as today.
- **Not saved:** derived links, buckets and block counts; they are rebuilt on load.

## 10. Worker bridge and frame protocol

Comlink goes. `core/protocol/messages.ts` defines about 150 lines of message types:

```ts
export type ToWorker =
  | { readonly kind: "create"; readonly id: number; readonly request: WorldRequest }
  | { readonly kind: "load"; readonly id: number; readonly save: SaveEnvelope; readonly base: WorldBase }
  | { readonly kind: "save"; readonly id: number }
  | { readonly kind: "advance"; readonly realSeconds: number; readonly commands: readonly StampedCommand[] }
  | { readonly kind: "inspect"; readonly id: number; readonly target: InspectionTarget };

export type ToMain =
  | { readonly kind: "progress"; readonly id: number; readonly share: number }
  | { readonly kind: "world" | "saved" | "inspected"; readonly id: number; readonly payload: ReplyPayload }
  | { readonly kind: "frame"; readonly frame: Frame }
  | { readonly kind: "failed"; readonly id: number; readonly reason: string };
```

**The bridge.**

- Each side has a single `send` that collects transferables with `buffersWithin`, and tests drive it over a `MessageChannel` pair.
- `zod/mini` validates commands only, because under lockstep they will also come from peers.
- The pull model stays, with one `advance` in flight. The command clock stamps commands for `lastFrameTick + 1`.
- No SharedArrayBuffer and no COOP/COEP. They would cost Whop embeds, sign-in popups and portal embeds, and Safari lacks `credentialless`. Transport stays internal to each section, so a section can switch later.

**Frames.**

- Sections come in four kinds: `rows` (surface and ground), `regions` (height and water), `patch` (vegetation and dirty thing slots, through dirty bitsets per column group, with no hand-listed fields), and `packed` (people and animals).
- Effects that last become things with frame rows: tornadoes, embers and meteors. A reload or a late joiner then sees them. Only instant effects, such as a flash or a splash, stay in `effects`.

## 11. Rendering, models and audio extension points

**Rendering.**

- `WorldRenderer` becomes a loop over `RenderLayer { stage, object, changed, update(frame), dispose }`, in `RENDER_STAGES = ["sky", "ground", "water", "cover", "figures", "overlays", "effects"]`. A browser test pins the order: atmosphere before vegetation, water after the patch levels.
- Shared outputs (plant chunks, patch levels, plant weather) go through `RenderServices`, never from layer to layer.
- `TerrainLayer` and `WaterLayer` contribute `look(ground, coordinates) → { color, glow }`. Lava, acid and scorch are terrain layers, and each respects the patch step and the island outline.

**Presenters.**

- **Effects:** `EFFECT_PRESENTERS: { [Kind in EffectKind]: { look, cue, clock } }` serves both rendering and audio from one `session.effects` channel.
- **Things:** `THING_PRESENTERS` covers layer, pick candidates, rings, spot and hand pose.
- **Figures:** `SkinnedFigures<Visual>` holds the draw loop that people and animals duplicate today, so birds would supply only `visualFor`, `parts`, `writePose` and `marker`.

**Models.**

- `PLANT_LOOKS` and `ANIMAL_LOOKS` are keyed by name. They replace `VARIANT_COUNTS`, `TREE_LOOKS`, `FOLIAGE_KEYS`, `APPEARANCES` and `ANIMAL_MARKERS`.
- Material slots become a named list with a derived count.
- `HUMAN_PARTS` and the bone lists stay order-coupled, guarded by a test.

**Audio.**

- `AudioPart { hearFrame, hearCommand, hearRender, dispose }` and `EmitterSource { sound, collect }`.
- Cues are declared by their owners. `sound-catalog.ts` is generated from `sounds/` file stems, and a test fails on any sound nothing references.
- Ambience uses `Surroundings.summarize` over the mirror, so the snow rule exists once.

## 12. Interface: pages, panels, stores, design system

- **`design`:**
  - primitives, `island.tsx`, `game-icon.tsx`, and `settings-group` (moved out of a feature);
  - `IconSource` is `{ core }` or `{ url }`, so modules ship their own `icon.webp`.
- **`stores`:** every store that more than one panel uses. Panels read the engine through the handle and narrow selectors, never through `app`.
- **`panels`:**
  - Each panel is a folder that imports only `stores`, `design` and `core`.
  - `PANELS: readonly PanelEntry[]` has placements `menu`, `settings`, `journal` and `dock`. It derives the tab unions, both menus and the store resets.
  - `INSPECTORS: { [Kind in InspectionKind]: InspectorEntry }` lets modules add `inspectorRows`.
- **`pages`:** `pages.ts` feeds Vite's inputs, and the privacy page becomes TSX.
- **`app`:** the shell, the launcher and a hand-written HUD layout.
- **Strings:** Lingui `msg` descriptors. The worker sends `{ id, values }`, and catalogs live in each module's `locales/`, with Russian first.

## 13. Packages

| Action | Package | Reason |
|---|---|---|
| Remove | `comlink` | Stale since 2024-11. Lockstep needs a message protocol, not a proxy. |
| Remove | `react-markdown`, `remark-gfm` | 100 of 122 runtime packages and a 50 kB gzip precached chunk for one page. |
| Switch | `zod` → `zod/mini` | About 37 kB gzip less. Keeps `looseObject`, `codec` and `toJSONSchema` (for mods). |
| Add | `@lingui/core`, `@lingui/react`; dev `@lingui/cli`, `vite-plugin`, `babel-plugin-lingui-macro` | Descriptors are data that cross `postMessage` and go into saves. Per-folder catalogs, Russian plurals, runtime catalogs for mods. |
| Add (optional) | `idb` | Before `WorldBase` and cloud saves arrive. |
| Add (dev) | `ts-morph`, `dependency-cruiser` + `@swc/core`, `fast-check` | Re-runnable moves (ts-morph bundles TS 6), graph rules, determinism properties. |
| Add later | `msgpackr` | Cloud saves, resync and replay export. |
| Keep | `pure-rand`, `simplex-noise` (already exact), `three`, `react`, `zustand`, Base UI, `tailwind-merge`, `clsx`, `lucide-react`, `vite-plugin-pwa`, Babel and the React Compiler | Each still earns its place. |
| Don't add | ECS libraries, kdbush/flatbush/rbush, xxhash-wasm, fflate, valibot, `@stdlib/*`, Nx, Turborepo, Sheriff, an event library, DI, a router | ECS costs 10–18× memory and 150–490× spawn cost, and its serializers remap ids. A grid aligned to the cells beats tree indexes. Use workspaces only when the relay shares `packages/protocol`. |

## 14. Migration

Every group passes `check`, `typecheck`, `knip`, `test` and `boundaries`. The last column marks impact: **H** means hashes change, **S** means saves change compatibly, **–** means neither.

| # | Group | Size | Verify | Impact |
|---|---|---|---|---|
| 0 | Safety net: pinned generation and 600-tick hashes for seeds 3/7/11, save fixtures from 0.8/0.9/main, replay harness, bench | M | A 1% erosion change fails | – |
| 1 | Tooling: move scripts, depcruise and Grit in report mode, size limits | S | CI green | – |
| 2 | Layer moves, 4 scripted PRs in one quiet hour: `core`, `simulation`, `engine` (mirror below render), `interface` (stores out of app) | XL, mechanical | R1–R5 gone; depcruise on; screenshots identical | – |
| 3 | Kernel shell: today's order as phases, slim Simulation, save sections, frame and mirror sections, bridge replaces Comlink | L | Hashes unchanged; frame time within noise | – |
| 4 | Self-describing saves: name tables, `formerNames`, `WorldBase`, parsed schemas, chronicle ids | M | 0.8/0.9 fixtures load; a reordered catalog loads | S |
| 5 | Commands only: tick strokes, tasks and water; lightning off the view; transients and jobs saved | L | Save/load/N = N; paused brush works | H S |
| 6 | Exact math, `unitHash`, named streams (simulation and generation); Grit becomes an error | L | Golden replay in 5 engines | H |
| 7 | Cell fields and properties; lava as a field; raw writes gone | M | Hashes unchanged | – |
| 8 | Context: radial pattern, buckets, block counts, `Surroundings`; port inspector, `nearestPlant`, `livingWithin`, `nearestShore`, warmth from heat | L | Bench budgets | H |
| 9 | Thing store: handles, columns, kinds, tags, plants as a `ThingSource`, monuments split, `strike` | XL | #242 and hand tests; saves load | H S |
| 10 | Phases, reactions, events; remove per-pair calls and Simulation glue | L | One test per rule; #242 tests unchanged | H |
| 11 | `defineModule`, catalog compile, then one PR per module | M each | Core never mentions a module | – |
| 12 | Render stages and layers, presenters, `SkinnedFigures`, audio parts, generated sound catalog | L | Screenshots at 3 sizes, near and far, headless GPU Chrome | – |
| 13 | Panel and inspector registries, privacy page as TSX, `zod/mini`, Lingui | L | Browser tests; smaller bundle | – |
| 14 | Lockstep readiness: section hasher, cross-browser CI, replay export | M | Hashes match in 5 engines | – |

**Batching and order.** Groups 5 and 6 ship as one minor release, and so do groups 8, 9 and 10. Each release note says that worlds play out differently from the same seed. Group 4 precedes any hash change that touches generation.

**Moved versus rewritten.**

- **Moved by script** (~60% of 30–45k changed lines, 45–55 PRs): rendering, models, audio, design, panels, generation, jobs, fauna, catalog rows.
- **Rewritten:**
  - `simulation.ts`;
  - the frame, the frame builder and the worker API;
  - `saved-world.ts`;
  - the power registry;
  - the hazard bodies;
  - `hazards.ts`, which becomes a `danger` field;
  - grab handlers, which become a trait;
  - the `WorldRenderer` composition;
  - the effect view and effect sounds.

**Lanes, after group 2:**

- **K (kernel and state):** groups 3 → 5 → 7 → 9 → 10, run serially.
- **D (saves and determinism):** groups 4 and 6, alongside K. Group 6's codemod goes in a quiet hour.
- **Q (context):** group 8, after group 7.
- **M (modules):** group 11, after group 10, with one agent and worktree per module. Only the sorted registration lines can collide.
- **E (engine):** group 12, after group 3.
- **I (interface):** group 13, right after group 2.

## 15. Risks and open questions

1. **Hash churn.** Two batches re-roll every seed, so promo seeds and pinned scenes must be re-picked. *Open:* merge both batches into one release?
2. **Exact-math speed.** fdlibm ports may be 2–4× slower than native; measure astronomy in group 0, use tables if needed.
3. **`WorldBase` size.** 16 MB raw at 640², with an unmeasured gzip ratio and mobile IndexedDB quotas. Fallback: store a base only for new worlds.
4. **Two sources of truth for people during group 9.** `Mover` becomes a view over the columns in one PR, with the hand tests pinned.
5. **Events as hidden coupling.** An event is a fact, never a request. Listeners never write fields another system owns in the same phase. Keep the list short and reviewed.
6. **Reaction order.** Two modules driving `heat` can surprise. Any change to the order needs a test.
7. **Merge pressure in group 2.** Scripted moves re-run on rebase, with a freeze of about an hour per layer.
8. **TS 7 has no API until 7.1.** ts-morph bundles TS 6; dependency-cruiser uses swc.
9. **Open questions:**
    - **Monuments:** a thing kind or a structure kind?
    - **Crossings:** should they become a static `ThingSource` before tribe-built bridges? I say yes, so bridges burn and lift by trait.
    - **Scenarios:** a catalog round (my choice, so data packs need no code) or code-free modules?
