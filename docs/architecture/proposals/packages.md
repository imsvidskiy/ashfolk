# Ashfolk target architecture: hard boundaries

Stance: the layers become Bun workspace packages, and the build graph enforces their boundaries instead of lint
rules. Everything that behaves is a plugin on a small simulation kernel. I push the stance as far as the evidence
allows, and I back off from it in three places, each marked **Against the stance**.

## 1. Principles

1. **The build enforces layers.** A layer is a package. An import the package does not declare fails to resolve in
   `tsc` and Vite. Lint is used only where no build tool can help: determinism and DOM globals.
2. **Vocabulary below behavior.** Fields, exposures, tags, traits, stats and standard events are data in `catalog`.
   Modules read and write the vocabulary and never import each other.
3. **Everything that behaves is a module.** That includes fire, weather, society and the hand. A module has one
   folder with up to four sides: manifest, simulation, engine, interface.
4. **The kernel owns no game rules.** It owns the clock, phases, cell fields, the thing store, queries, reactions,
   events, commands, saves, frames, random streams and the hasher.
5. **Properties, not pairs.** An effect writes a field, stamps an exposure or calls `impact`. Things respond
   through their traits. No system calls another system.
6. **One query API**, deterministic and allocation-free, the same in the worker, in tests and in the mirror.
7. **Commands are the only input.** Each is stamped with a tick. Real time exists only on the main thread.
8. **Saves describe themselves.** They hold name tables, sections owned by modules, a stored world base and
   defaults for new keys. There are no per-version migrations.
9. **Explicit, typed lists.** No globs, no declaration merging, no topological sort. The order lives in lists
   people read, and `tsc` checks that they are complete.
10. **No big bang.** Every step can be merged on its own, and changes to hashes are batched into named releases.

## 2. Target tree

```
ashfolk/
  apps/
    game/                    @ashfolk/game: the only composition root
      src/roster/            module lists per side, step order, dock and journal orders
      src/worker/            worker entry: simulation + generation + roster + bridge end
      src/pages/             game page, privacy page, page list
    server/                  Cloudflare Worker (today's worker/)
  packages/
    kernel/                  @ashfolk/kernel: exact math, hash, random streams, grid, CellSet,
                             define-helpers, registry freezing, Channel; deps: pure-rand
    catalog/                 @ashfolk/catalog: data only
      content/               biomes, grounds, species, animals, buildings, technologies, resources, eras
      elements/              fields, exposures, tags, traits, stats, standard events
      names/                 name tables, formerNames, catalog hash
    world/                   @ashfolk/world: read model and pure structures
      terrain/  water/       TerrainData, hasWater, runtime hydrology (moved from generation)
      things/  spatial/      plant store, generic thing store, radial pattern, buckets, block counts
      reader/                WorldReader: one implementation of cell reads for worker and mirror
    generation/              @ashfolk/generation: layout, relief, water, climate, placement
    simulation/              @ashfolk/simulation: the kernel runtime
      stepper/  cells/       clock, phases, field store, reaction pass
      things/  query/        kinds, traits, stats, context queries, impact
      io/                    commands, events, save envelope and sections, frame sections, hasher
    protocol/                @ashfolk/protocol: bridge messages, frame and command envelopes, zod/mini
    models/                  @ashfolk/models: procedural meshes, skeletons, clips
    engine/                  @ashfolk/engine: no React
      bridge/  mirror/       session, own postMessage protocol, mirror sections
      render/                renderer, stages, layer services, terrain and water layer slots
      input/  presenters/    camera, picking, tools, thing and effect presenters
    audio/                   @ashfolk/audio: sound engine, buses, voices, ambience, music, audio parts
    interface/               @ashfolk/interface: React
      design/  stores/       design system, shared stores
      shell/   panels/       HUD layouts, menus, panel registry, inspector registry
    modules/                 @ashfolk/modules: one workspace holding every module folder
      nature/                fire, weather, surface, vegetation, water-settling
      life/                  society, fauna, rivalry, hand, sickness
      powers/                element-powers, land-powers, life-powers, tornado, volcano, meteor, quake
      things/                monuments, crossings, deposits, boat
  tools/                     moves (ts-morph), boundaries tests, shots, sound encoding, tsconfig bases
```

A module folder holds its four sides:

```
modules/powers/tornado/
  module.ts                  manifest: power definition, death cause, message ids, frame payload types
  tornado-path.ts            pure path math, imported by both threads
  tsconfig.json
  simulation/                tornado-system.ts (+ test), simulation-module.ts, tsconfig.json
  engine/                    tornado-funnel.ts, tornado-cue.ts, tornado.webm, engine-module.ts, tsconfig.json
  interface/                 icon.webp, interface-module.ts, tsconfig.json
  locales/                   en.po, ru.po
```

That is 14 files for a full hazard, against 18 spread over 9 folders today. A stateless power needs about 6 files.

## 3. Layer rules and enforcement

| Package or side | May import |
|---|---|
| kernel | pure-rand |
| catalog | kernel, zod |
| world | kernel, catalog, simplex-noise |
| generation | world, catalog, kernel |
| simulation | world, catalog, kernel, protocol (types) |
| protocol | catalog, kernel, zod |
| models | catalog, kernel, three |
| engine | protocol, world (reader), models, catalog, kernel, three |
| audio | engine, protocol, models, catalog, kernel |
| interface | engine (handle types), audio (settings), protocol, catalog, kernel, react, zustand, base-ui |
| module manifest + shared files | catalog, kernel |
| module `simulation/` | its manifest, simulation, world, catalog, kernel |
| module `engine/` | its manifest, engine, audio, models, world, protocol, catalog, kernel, three |
| module `interface/` | its manifest, interface, protocol, catalog, kernel, react |
| apps/game | everything |

The rules are enforced by four mechanisms, and none of them is a lint rule:

1. **Package graph.** Each package declares its dependencies with `workspace:*` and `catalog:` versions. The
   isolated linker (`bunfig.toml`: `linker = "isolated"`) links only declared dependencies into a package's
   `node_modules`, so an undeclared `three` or `@ashfolk/engine` fails to resolve.
2. **Project graph.** Every package, and every module side, is a composite tsconfig project with `include`
   limited to its own folder and explicit `references`. An import that escapes the folder, or reaches an
   unreferenced workspace package, fails with TS6307, so module sides and sibling modules are hard boundaries
   inside the one `modules` package. `references` aren't inherited through `extends`, so `bun run new-module`
   writes them and `tools/boundaries/module-configs.test.ts` checks them against the template.
3. **Bundle closure.** `tools/boundaries/worker-closure.test.ts` builds the worker and fails if `three`, `react`
   or `zustand` is reachable. `@ashfolk/modules` declares `three` for engine sides, so this closes the one hole.
4. **Lint** keeps only what the compiler can't see. A GritQL plugin bans `Math.sin|cos|atan2|exp|log|pow|hypot`,
   `**`, `Math.random`, `Date.now` and `performance.now` in kernel, catalog, world, generation, simulation and
   module `simulation/` folders. `noRestrictedGlobals` bans `window` and `document` in `engine/render`.

`noUncheckedIndexedAccess` stays off in the typed-array projects (kernel, world, generation, simulation, models,
engine, module simulation and engine sides) and on everywhere else. Each project sets it in its tsconfig base.

**Against the stance (1): one package per module side.** The pure version gives every module side its own
`package.json`: about 80 manifests, plus a `bun.lock` edit for every new power, in a repository that merges 30 to
100 PRs a day. The project graph enforces the same boundary for free. So modules share one workspace, and the
package graph guards the eleven layers, which rarely change.

## 4. Core abstractions

All of this lives in `kernel`, `catalog` and `simulation`. Module code sees only `SimulationContext`.

### Kernel, tick and phases

```ts
// packages/kernel/src/tick/phases.ts
export const PHASES = ["intake", "weather", "emit", "react", "nature", "life", "settle"] as const;

export type Phase = (typeof PHASES)[number];

export interface Tick {
  readonly index: number;
  readonly seconds: number;
  readonly day: number;
}

export interface System {
  readonly id: string;
  readonly phase: Phase;
  readonly step: (tick: Tick) => void;
}

// packages/simulation/src/stepper/step-world.ts
export function stepWorld(runtime: Runtime, commands: readonly StampedCommand[]): StepResult {
  const { clock, events, hasher, schedule, systems } = runtime;

  const tick = clock.next();

  intakeCommands(runtime, tick, commands);
  schedule.runDue(tick);

  for (const system of systems) {
    system.step(tick);
  }

  events.drain(tick);

  return { hash: hasher.digest(tick), tick: tick.index };
}
```

`systems` is already flattened in phase order. Within a phase, the order comes from `STEP_ORDER` in
`apps/game/src/roster/step-order.ts`. That is one list of system ids, and a test checks that every registered id
appears in it exactly once. Pause, speed, the backlog and the 40-tick cap live in the engine's scheduler, not here.

### Cell fields and cell properties

```ts
// packages/catalog/src/elements/field-definition.ts
export interface FieldDefinition<Id extends string = string> {
  readonly id: Id;
  readonly tags: readonly string[];
  readonly maximum: number;
  readonly floor: number;
  readonly save: "dense" | "sparse" | "derived";
}

export function defineField<const Id extends string>(definition: FieldDefinition<Id>): FieldDefinition<Id> {
  return definition;
}

export const FIRE = defineField({ floor: 0.02, id: "fire", maximum: 1, save: "sparse", tags: ["heat-source"] });
export const WETNESS = defineField({ floor: 0, id: "wetness", maximum: 1, save: "dense", tags: ["wet"] });
export const GUST = defineExposure({ id: "gust", tags: ["wind"] });

// packages/simulation/src/cells/field.ts
export interface Field {
  readonly definition: FieldDefinition;
  readonly active: CellSet;
  value(cell: number): number;
  add(cell: number, amount: number): void;
  scale(cell: number, factor: number): void;
  set(cell: number, value: number): void;
}

export interface Cells {
  field(definition: FieldDefinition): Field;
  exposure(definition: ExposureDefinition): Exposure;
  tagged(tag: string): readonly Field[];
  setGround(cell: number, ground: number): void;
  markDisturbed(cell: number, tick: Tick): void;
}
```

The field operations clamp values, snap them below `floor`, keep the active set and mark frame rows. They replace
the 40 raw writes and 25 manual `mark*` calls. A cell property is a derived read that joins terrain, fields and the
environment:

```ts
// packages/world/src/reader/cell-sample.ts
export interface CellSample {
  cell: number;
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
  fuel: number;
  lava: number;
}
```

- `biome` reports `Water` on water cells and `Barren` under lava or basalt, so the inspector's special case goes
  away.
- `temperature` always includes the air offset, the season and the weather.
- `lava` is a field now. The volcano's `Map<cell, heat>` becomes the volcano section's source.

### Things, traits, tags and stats

```ts
// packages/catalog/src/elements/thing-kind.ts
export interface ThingType {
  readonly name: string;
  readonly formerNames: readonly string[];
  readonly tags: readonly string[];
  readonly stats: Readonly<Partial<Record<StatName, number>>>;
}

export interface ThingKindDefinition<Id extends string = string> {
  readonly id: Id;
  readonly storage: "plants" | "movers" | "fixed" | "transient";
  readonly types: readonly ThingType[];
  readonly traits: readonly TraitUse[];
}

export interface TraitDefinition<Id extends string = string> {
  readonly id: Id;
  readonly columns: readonly ColumnDefinition[];
}

export const FLAMMABLE = defineTrait({ columns: [{ initial: 0, name: "burning", type: "f32" }], id: "flammable" });
export const GRABBABLE = defineTrait({ columns: [{ initial: 0, name: "held", type: "u8" }], id: "grabbable" });
export const DAMAGEABLE = defineTrait({ columns: [{ initial: 1, name: "health", type: "f32" }], id: "damageable" });
```

- A thing is a `ThingRef { kind, slot, generation }`; per-slot generations end the ABA reuse of plant slots.
- A trait owns its columns, so only flammable kinds get `burning`. Behavior lives with the concept's owner:
  burning in `fire`, lifting in `hand`, death in `impact`.
- Tags compile into a `Uint32Array` mask per type, so `wooded` or `tree` means one thing everywhere.
- `stats.effective(WIND_RESISTANCE, ref)` applies registered modifiers (wetness, age, technology) to the type's
  base and can explain itself to the inspector. Health is always 0 to 1; mass is a stat.

### The context-query API

```ts
// packages/simulation/src/query/query.ts
export interface Disc {
  x: number;
  z: number;
  radius: number;
}

export interface ThingFilterDefinition {
  readonly kinds: readonly string[];
  readonly tags: readonly string[];
  readonly traits: readonly string[];
  readonly excludeTags: readonly string[];
  readonly tribe: number;
}

export interface ThingFilter {
  readonly kinds: number;
  readonly tags: number;
  readonly traits: number;
  readonly excluded: number;
  readonly tribe: number;
}

export interface ThingVisitor {
  visit(thing: ThingRef, distanceSquared: number): boolean;
}

export interface CellVisitor {
  visit(cell: number, distanceSquared: number): void;
}

export interface AreaSummary {
  readonly biomeShares: Float32Array;
  readonly typeCounts: Uint16Array;
  readonly tribeCounts: Uint16Array;
  dominantBiome: number;
  waterShare: number;
  maxFire: number;
  burningCells: number;
  meanHeat: number;
  meanSlope: number;
  people: number;
  animals: number;
  buildings: number;
}

export interface Query {
  readonly environment: EnvironmentReading;
  compile(definition: ThingFilterDefinition): ThingFilter;
  sample(x: number, z: number, out: CellSample): boolean;
  sampleCell(cell: number, out: CellSample): void;
  summarize(area: Disc, out: AreaSummary): void;
  count(area: Disc, filter: ThingFilter): number;
  any(area: Disc, filter: ThingFilter): boolean;
  nearest(area: Disc, filter: ThingFilter, out: ThingRef): number;
  collect(area: Disc, filter: ThingFilter, out: ThingList): number;
  visit(area: Disc, filter: ThingFilter, visitor: ThingVisitor): void;
  visitCells(area: Disc, visitor: CellVisitor): void;
  fireDistance(cell: number): number;
}
```

- `nearest` returns the squared distance, or `-1` when nothing matches.
- Indexes: movers in 40 m counting-sort buckets rebuilt at a tick's first query (22 µs for 5k); plants in the
  per-cell lists plus per-type and per-tag 16×16 block counts; fixed things in a per-cell head/next index, with
  occupancy sentinels moved to their own layers.
- Row-major walks, ascending ids, radial order for `nearest` with ties to the lower id, squared distances, no
  random draws. Held and dead things are excluded once, in the live mask.
- `WorldReader` implements `sample` for the mirror too, so rendering, audio and picking share the rules.

### Reactions and impact

```ts
// packages/simulation/src/cells/reaction.ts
export interface Reaction {
  readonly id: string;
  readonly drivenBy: FieldDefinition | ExposureDefinition;
  readonly when: (cells: Cells, cell: number) => boolean;
  readonly apply: (cells: Cells, cell: number, tick: Tick, chance: number) => void;
}

// packages/simulation/src/things/impact.ts
export interface Impact {
  readonly area: Disc;
  readonly cause: string;
  readonly harm: number;
  readonly fright: number;
  readonly dangerSeconds: number;
  readonly push: number;
  readonly filter: ThingFilter;
}
```

- The pass walks only the active set of `drivenBy`, in the order of `REACTION_ORDER`, a roster list pinned by a
  test.
- `chance` is `unitHash(seed, tick, cell, ruleHash)`.
- `impact.apply(impact)` visits the matching things once. For each it scales harm by `effective(ARMOR)`, scares
  the frightened, adds a danger zone and emits `thingHarmed` and `thingKilled`.
- One trait response in the `fire` module replaces the three copies of "standing on a burning or lava cell hurts".

### Modules and registries

```ts
// packages/catalog/src/elements/module-manifest.ts
export interface ModuleManifest<Id extends string = string> {
  readonly id: Id;
  readonly fields: readonly FieldDefinition[];
  readonly exposures: readonly ExposureDefinition[];
  readonly tags: readonly string[];
  readonly traits: readonly TraitDefinition[];
  readonly thingKinds: readonly ThingKindDefinition[];
  readonly powers: readonly PowerDefinition[];
  readonly events: readonly EventDefinition[];
  readonly deathCauses: Readonly<Record<string, MessageId>>;
}

// packages/simulation/src/stepper/simulation-module.ts
export interface SimulationModule<Id extends string = string> {
  readonly id: Id;
  readonly create: (context: SimulationContext) => ModuleRuntime;
}

export interface ModuleRuntime {
  readonly systems: readonly System[];
  readonly reactions: readonly Reaction[];
  readonly responses: readonly TraitResponse[];
  readonly powers: readonly PowerHandler[];
  readonly commands: readonly CommandHandler[];
  readonly listeners: readonly EventListener[];
  readonly saves: readonly SaveSection[];
  readonly frames: readonly FrameSection[];
}

export interface SimulationContext {
  readonly catalog: FrozenCatalog;
  readonly cells: Cells;
  readonly things: Things;
  readonly query: Query;
  readonly stats: Stats;
  readonly impact: ImpactResolver;
  readonly events: EventSink;
  readonly schedule: Schedule;
  readonly rules: RulesReader;
  readonly random: (streamId: string) => RandomStream;
}

// apps/game/src/roster/manifests.ts
export const MANIFESTS = [fireManifest, weatherManifest, tornadoManifest, volcanoManifest] as const;

export type ModuleId = (typeof MANIFESTS)[number]["id"];

// apps/game/src/roster/simulation-roster.ts
export const SIMULATION_ROSTER = {
  fire: fireSimulation,
  tornado: tornadoSimulation,
  volcano: volcanoSimulation,
  weather: weatherSimulation,
} as const satisfies { readonly [Id in ModuleId]: SimulationModule<Id> | null };
```

- The catalog is built in three rounds: base, then module manifests, then a scenario or mod. It is then frozen.
  Dense indices are assigned at freeze time and never saved.
- The catalog hash goes into replays and the lockstep handshake.
- `ENGINE_ROSTER` and `INTERFACE_ROSTER` use the same `satisfies` pattern.

### Commands, events, save sections, frame sections

```ts
// packages/simulation/src/io/command.ts
export interface CommandHandler<Payload = unknown> {
  readonly kind: string;
  readonly schema: ZodMiniType<Payload>;
  readonly apply: (payload: Payload, issuer: Issuer, tick: Tick) => Refusal | null;
}

export interface StampedCommand {
  readonly tick: number;
  readonly player: number;
  readonly kind: string;
  readonly payload: unknown;
}

// packages/catalog/src/elements/event-definition.ts
export interface EventDefinition<Id extends string = string, Payload = unknown> {
  readonly id: Id;
  readonly payload: ZodMiniType<Payload>;
  readonly presented: boolean;
}

// packages/simulation/src/io/save-section.ts
export interface SaveSection {
  readonly key: string;
  readonly write: () => unknown;
  readonly read: (saved: unknown) => SectionResult;
  readonly reset: () => void;
  readonly afterRestore: (() => void) | null;
  readonly digest: (hasher: StateHasher) => void;
}

export function defineSaveSection<Saved>(section: TypedSaveSection<Saved>): SaveSection {
  return {
    afterRestore: section.afterRestore,
    digest: section.digest,
    key: section.key,
    read: (saved) => {
      const parsed = section.schema.safeParse(saved);

      if (!parsed.success) {
        section.reset();

        return { key: section.key, status: "reset" };
      }

      section.restore(parsed.data);

      return { key: section.key, status: "restored" };
    },
    reset: section.reset,
    write: section.snapshot,
  };
}

// packages/simulation/src/io/frame-section.ts
export interface FrameSection {
  readonly key: string;
  readonly build: () => unknown;
}
```

- **Commands.** Each handler parses its own payload; an unknown kind is refused, never thrown.
- **Events.** A preallocated per-tick queue, drained in `settle` in emit order; listeners run in roster order, with
  a depth cap. `presented` events also reach the frame as effects.
- **Sections.** `defineSaveSection` erases the generic without `as`. `MirrorSection` pairs with `FrameSection` by
  key (section 10).

**Against the stance (2): no event bus.** plan.md says "no event bus", and that is right for an untyped pub/sub.
But 28 `chronicle.record` calls, 13 `effects.add` calls and the duplicated fire-discovery path are fan-out that
would otherwise couple modules directly. A typed, ordered, per-tick queue that the hasher sees is as deterministic
as a direct call.

## 5. Walkthrough A: the tornado in one tick

The `emit` phase runs `tornado.step`. Today the tornado reads no context and calls into four systems
(`tornadoes.ts:115-170`). Now it does this:

```ts
// modules/powers/tornado/simulation/tornado-system.ts
const UPROOTABLE: ThingFilterDefinition = { excludeTags: [], kinds: ["plant"], tags: ["uprootable"], traits: [], tribe: -1 };
const SWEPT: ThingFilterDefinition = { excludeTags: ["anchored"], kinds: [], tags: [], traits: ["damageable"], tribe: -1 };

export function createTornadoSystem(context: SimulationContext, state: TornadoState): System {
  const { catalog, cells, events, impact, query, random } = context;

  const uprootable = query.compile(UPROOTABLE);
  const swept = query.compile(SWEPT);
  const sample = createCellSample();
  const summary = createAreaSummary(catalog);
  const area = createDisc();
  const gust = cells.exposure(GUST);
  const stream = random("tornado");
  const uprooter = createUprooter(context, stream);

  function rage(tornado: Tornado, tick: Tick): void {
    const center = tornadoPositionAt(tornado.path, tornado.age);

    setDisc(area, center.x, center.z, tornado.radius);
    query.sample(center.x, center.z, sample);
    query.summarize(area, summary);

    const strength = tornado.strength * weakeningOver(summary) * fedByFire(summary);

    stampSwirl(gust, query, area, strength);
    uprooter.prepare(center, strength * tick.seconds);
    query.visit(area, uprootable, uprooter);
    impact.apply({ area, cause: "tornado", dangerSeconds: tick.seconds, filter: swept, fright: 4, harm: strength * 0.45 * tick.seconds, push: strength });

    if (summary.people > 0 && isFirstTouch(tornado, summary)) {
      events.emit(TORNADO_HIT_CAMP, { tribe: dominantTribe(summary), x: center.x, z: center.z });
    }

    tornado.biome = sample.biome;
  }

  return {
    id: "tornado",
    phase: "emit",
    step: (tick) => {
      for (const tornado of state.active) {
        rage(tornado, tick);
        tornado.age += tick.seconds;
      }

      state.dropFinished();
    },
  };
}

function createUprooter(context: SimulationContext, stream: RandomStream): Uprooter {
  const { stats, things } = context;

  let force = 0;
  let centerX = 0;
  let centerZ = 0;

  return {
    prepare: (center, nextForce) => {
      centerX = center.x;
      centerZ = center.z;
      force = nextForce;
    },
    visit: (plant, distanceSquared) => {
      const resistance = stats.effective(WIND_RESISTANCE, plant);

      if (stream.chance(force * (1 - resistance) * grip(distanceSquared))) {
        things.disturb(plant, { angle: swirlAngle(plant, centerX, centerZ), cause: "tornado", force });
      }

      return true;
    },
  };
}
```

Here is what each question costs:

- **Biome.** `sample.biome`, one read. The frame sends it, so the funnel looks sandy over desert.
- **Nearby trees by species.** `summary.typeCounts[catalog.plants.index("oak")]` from block counts.
  `weakeningOver` uses `waterShare` and `wooded` biome shares. Uprooting follows `windResistance`, so old oaks
  hold and birches fall.
- **Fire.** `summary.maxFire` and `burningCells`. `fedByFire` turns the funnel into a fire whirl.
- **People.** `summary.people` and `tribeCounts`. Harm and fright go through `impact`.
- **Effects on others.** The tornado writes only the `gust` exposure:
  - the `fire` module's `wind-blows-out-fire` reaction puts out burning cells;
  - the `fire` module's response for `flammable` buildings reads `gust` at the building's cell and replaces
    `buildings.blowOut`;
  - `things.disturb` asks the plant store, which uses the type's traits: `fellable` trees fall, `uprootable`
    shrubs go, and rocks and monument pieces lack both traits and stay;
  - the listener for `TORNADO_HIT_CAMP` in `society` writes the chronicle and tribe morale.

No `fire.douse`, no `buildings.blowOut`, no held-thing check, and no category branches. The cost is two block
walks and one bucket walk per tornado, about 1 µs.

## 6. Walkthrough B: the "acid rain" power

Acid rain is a brush. It adds an `acidity` field that decays over days and is tagged `wet` and `corrosive`.

- **Its own rules.** Acidity bleaches grass, wilts plants and stings people.
- **What it gets for free.** Fire's existing `soak-douses-fire` rule reads every field tagged `wet`, so acid puts
  out fire without new code.
- **Everything else** goes through traits. Plants have `living`, people have `damageable`, and the
  `corrosion-harms` response reads every field tagged `corrosive`.

```ts
// modules/powers/acid-rain/module.ts
export const ACIDITY = defineField({ floor: 0.01, id: "acidity", maximum: 1, save: "sparse", tags: ["wet", "corrosive"] });

export const acidRainManifest = defineManifest({
  deathCauses: { acid: msg("acid-rain.death") },
  fields: [ACIDITY],
  id: "acid-rain",
  powers: [
    definePower({
      cursorRadius: (parameters) => { return parameters.radius; },
      id: "acid-rain",
      parameters: z.object({ radius: z.number().check(z.minimum(10), z.maximum(80)) }),
      usage: "brush",
    }),
  ],
});
```

Files:

| File | Holds |
|---|---|
| `modules/powers/acid-rain/module.ts` | field, power, death cause |
| `…/simulation/acid-rain-brush.ts` (+ test) | stroke handler: `cells.field(ACIDITY).add` over the brush disc |
| `…/simulation/acid-reactions.ts` (+ test) | `acid-decays`, `acid-bleaches-ground` (grass to barren, tag driven) |
| `…/simulation/corrosion-response.ts` (+ test) | `TraitResponse` for `living` and `damageable` |
| `…/simulation/simulation-module.ts` | wires the above; the field is saved by the field store, so no section |
| `…/engine/acid-tint-layer.ts` | `TerrainLayer` tint from an `acidity` data texture |
| `…/engine/acid-rain-look.ts` | precipitation look override: green streaks |
| `…/engine/acid-rain-cue.ts`, `acid-hiss.webm`, `engine-module.ts` | brush loop |
| `…/interface/icon.webp`, `interface-module.ts` | dock icon |
| `…/locales/en.po`, `ru.po` | name, hint, death message |
| `tsconfig.json` ×4 | written by `bun run new-module` |
| `apps/game/src/roster/*` | one sorted line each in manifests, simulation, engine and interface rosters, plus `POWER_ORDER` and `REACTION_ORDER` |

Outside the folder only roster lines change, and `tsc` names each missing one. The field store sends `acidity` as
a generic sparse field section.

## 7. Walkthrough C: the "boat" thing kind (grabbable, floats, burns)

```ts
// modules/things/boat/module.ts
export const FLOATS = defineTrait({ columns: [{ initial: 0, name: "driftX", type: "f32" }, { initial: 0, name: "driftZ", type: "f32" }], id: "floats" });

export const BOAT = defineThingKind({
  id: "boat",
  storage: "movers",
  traits: [use(GRABBABLE, { liftHeight: 2 }), use(FLAMMABLE, { burnSeconds: 40 }), use(DAMAGEABLE, {}), use(FLOATS, {})],
  types: [{ formerNames: [], name: "dugout", stats: { mass: 300, maxHealth: 1, windResistance: 0.6 }, tags: ["wooden", "craft"] }],
});
```

- **Simulation.** `boat-drift.ts` is the `floats` behavior: a `life` system that moves boats along the water
  surface gradient and wind and beaches them where `hasWater` is false. `boat-spawn.ts` is the `spawnBoat` command.
  No code for the rest:
  - **fire**: the `flammable` response ignites boats on burning cells and heats their cell;
  - **the hand**: its generic mover handler lifts any `grabbable` mover, and `floats` lets it be set on water;
  - **saves and frames**: the thing store saves columns and types by name and packs movers per kind.
- **Engine.** `boat-model.ts` (procedural mesh) and `boat-presenter.ts` (`ThingPresenter`: layer, pick volume,
  rings, held pose).
- **Interface.** An `InspectorEntry` built from the generic trait rows.

That comes to about 10 files in one folder, plus roster lines.

**Against the stance (3): `floats` stays private.** `floats` starts as a trait the boat module owns. When a second
kind floats, a raft or a log crossing, the trait moves to `catalog/elements` and its behavior to a `water-craft`
module. Putting every trait in the vocabulary up front would make `catalog` a dumping ground.

## 8. Walkthrough D: tribe sickness with a journal panel

- **Manifest.**
  - a `germs` field (sparse, tags `contagion`);
  - a `sick` trait with columns `severity`, `illness` and `sinceDay`, applied to `person`;
  - illness rows: `{ name, routes: ["contact", "water"], affects: ["person"], curve: { start, peak, end } }`;
  - events `fellSick`, `recovered` and `diedOfSickness`;
  - the death cause `sickness`.
- **Simulation.**
  - `germ-reactions.ts`: germs grow on cells tagged `wet` with heat in range and decay on `scorch`. Probability
    comes from `unitHash`.
  - `infection-system.ts` (`life`) runs rare buckets (`slot mod 20`). Each person samples their cell, counts sick
    neighbors (`query.count(disc, SICK_PEOPLE)`) and rolls against `stats.effective(RESISTANCE, person)`. Warmth,
    hunger and `herbalism` are modifiers other modules register, so sickness never imports society.
  - Severity follows the curve; `impact` handles death. Per-person columns are saved by the thing store; a save
    section holds tribe totals; the `sickness` frame section sends counts and recent cases.
- **Interface.** `sickness-store.ts` (filled by the mirror section), `sickness-journal.tsx` (tribe rows, trend,
  cases with focus buttons), and `interface-module.ts`:

```ts
export const sicknessInterface: InterfaceModule<"sickness"> = {
  id: "sickness",
  inspectorRows: [personSicknessRow],
  panels: [{ Content: SicknessJournal, icon: sicknessIcon, id: "sickness", label: msg("sickness.journal"), placement: "journal" }],
  stores: [sicknessStore],
};
```

The journal shell renders the `journal` panels in the order of `JOURNAL_ORDER`, and the tab union comes from the
roster. `browser-setup` resets the registered `stores`. The chronicle listener in `society` gets `fellSick` lines
through the event's `presented` message.

## 9. Determinism, replays, lockstep and saves

- **Exact math.** `kernel/math/exact.ts` ports `sin cos atan2 exp log asin acos` from fdlibm with exact
  operations only, pinned by golden tests in four engines. A codemod turns 151 `hypot` calls into `Math.sqrt`.
- **Integer hashes and named streams.** `unitHash(seed, a, b, c)` uses `Math.imul` and lowbias32 and replaces the
  `Math.sin`-based `hashToUnit`. `random("fauna.instincts")` seeds xoroshiro from
  `lowbias32(worldSeed ^ fnv1a32(id))`, with no draws from a parent. Stream states are saved in `randomStreams`,
  and missing ones are re-derived. Visual-only draws use an unhashed `presentation` stream.
- **Commands only.**
  - `setViewFocus` goes away; lightning picks a seeded site weighted by height and `wooded` tags.
  - Strokes become per-tick `strokeStep` commands; meteors, tornadoes and lake filling count ticks.
  - A paused world applies commands without running nature, so brushes still work while paused.
- **Hashing.** Section digests (fields cached per 64×64 chunk, refreshed when dirty) fold into a root hash per
  turn. A replay is a header (build, catalog hash, seed, base hash, names), the command log and root hashes.
- **Name tables.** Every catalog stored by index gets a table: ground, biome, species, plant state, crop,
  technology, building, resource. Unknown names follow the catalog's policy, `fallback` or `drop`. Renames are
  `formerNames` on the row. `OLDER_SAVE_PLANT_SPECIES` stays frozen as the legacy default order for saves without
  a table, and it is never extended.
- **Envelope.** Today's flat top-level keys become section keys, so old saves are already valid envelopes. New
  keys `names`, `base` and `randomStreams` default to absent. Every section schema is `looseObject` with field
  defaults, and the loader keeps the parsed result.
- **Independence from the generator.** A new world writes a gzipped `WorldBase` (12 terrain layers, water,
  springs, crossings, monuments, deposits) to its own IndexedDB store; saves reference `{ baseId, baseHash }`. An
  old save regenerates, checks the fingerprint and attaches a base once.
- **Saving at any time.** Jobs, tornadoes and tasks are data, so `snapshot()` never returns `null`.
- **Proof.** "Save, load, run N" must equal "run N" (fast-check `fc.commands`). Cross-engine CI replays seeds 3,
  7 and 11 for 600 ticks.

## 10. Worker bridge and frame protocol

- **Comlink goes**, replaced by `protocol/bridge` (~150 lines) with two ends, `worker-end.ts` and `main-end.ts`.
- **Messages.**
  - To the worker: `create`, `load`, `save`, `advance { commands }` and `dispose`.
  - To the main thread: `progress`, `world`, `frame`, `saved` and `failed`.
  - Requests carry integer ids. Commands are checked with `zod/mini`; frames are trusted.
- **Transfers.** `send` collects transferables with `buffersWithin`, so the hand-written transfer list goes away.
  A development check fails when a transferred buffer belongs to a live store.
- **Frame shape.** `Frame = { tick, hash, sections: Partial<SectionPayloads> }`, where `SectionPayloads` is a
  mapped type over the roster's frame keys. A missing key means "unchanged". Payload types live in each module's
  `module.ts`, which both sides import.
- **Mirror sections.** `MirrorSection { key, apply(mirror, payload) }` runs in roster order: terrain, water,
  vegetation, then the rest. A guard test requires the frame and mirror key sets to match.
- **Kept.** The pull model (one `advance` in flight). No SharedArrayBuffer: COOP/COEP would cost Whop embeds,
  sign-in popups and portal embeds. Rendering stays on the main thread.
- **Lockstep later.** The network socket lives inside the worker, so React stalls never delay ticks.
- **The worker entry** is `apps/game/src/worker/simulation-worker.ts`, imported with Vite's `?worker`, which
  works with workspace paths.

## 11. Rendering, models and audio extension points

```ts
// packages/engine/src/render/render-layer.ts
export const RENDER_STAGES = ["sky", "ground", "water", "cover", "figures", "overlays", "effects"] as const;

export interface RenderLayer {
  readonly stage: (typeof RENDER_STAGES)[number];
  readonly object: Object3D;
  readonly changed: ((changes: WorldChanges) => void) | null;
  readonly update: (frame: RenderFrame) => void;
  readonly dispose: () => void;
}

export interface EngineModule<Id extends string = string> {
  readonly id: Id;
  readonly layers: readonly LayerFactory[];
  readonly terrainLayers: readonly TerrainLayer[];
  readonly effects: readonly EffectPresenter[];
  readonly things: readonly ThingPresenter[];
  readonly audio: readonly AudioPart[];
  readonly emitters: readonly EmitterSource[];
  readonly mirror: readonly MirrorSection[];
}
```

- **Layers.** `WorldRenderer` loops over stages. Shared outputs (plant weather, patch levels) are
  `RenderServices`, never constructor arguments between layers. A browser test pins the stage order.
- **Terrain and water layers** compose TSL in roster order; lava is the first. The patch-step rule lives in a
  shared `neighborSample` node, so layers can't break far views.
- **Effects.** One `EffectPresenter` per presented event, with `look` and `cue`, fed by one channel.
- **Things.** A generic `SkinnedFigures` does poses, footing, LOD, culling and markers; a `ThingPresenter` adds
  `visualFor`, `writePose`, pick volume and rings. Picking reads `WorldReader`, not rendering's chunks.
- **Models.** `PLANT_LOOKS` and `ANIMAL_LOOKS` are keyed by type *name*.
- **Audio.** `AudioPart` and `EmitterSource`; cues sit with their owner. A test fails on any unreferenced sound.

## 12. Interface: pages, features, stores, design system

- **`interface/design`.** Primitives, islands, `GameIcon(source)` (core name or module URL), and game-aware pieces
  in `design/game`. `settings-group` moves here from `features`.
- **`interface/stores`.** Stores more than one panel reads: engine, launch, preferences, world, focus, guide.
  Panels never import each other.
- **`interface/shell`.** Hand-written `WideHud` and `CompactHud`, because placement is design. Menus are
  generated from `menu` panels, so each control is written once.
- **`interface/panels`.** `PanelEntry { id, placement, label, icon, Content, connect }` and `InspectorEntry`.
  `JournalTab` and `SettingsTab` come from the roster. Core panels are entries too.
- **Pages.** Game and privacy in `apps/game/src/pages`; privacy becomes TSX; Vite inputs come from `PAGES`.
- **Strings.** Lingui: the worker sends `{ id, values }` descriptors, saves keep them, catalogs live in modules.

## 13. Packages to add, remove and keep

| Change | Package | Reason |
|---|---|---|
| Add | Bun workspaces + `catalog:` + isolated linker | hard layer graph, one version of `three` and `zod` |
| Add (dev) | ts-morph 28 | re-runnable move scripts; bundles its own TS 6, so TS 7 is fine |
| Add (dev) | fast-check 4 | command-sequence properties, save round trips; only depends on pure-rand |
| Add | `@lingui/core`, `@lingui/react` (+ cli, vite and macro plugins as dev) | descriptors from the worker, per-module catalogs, Russian plurals |
| Add (later) | msgpackr or cbor-x | cloud saves and network, not before |
| Add (optional) | idb | when save sections grow |
| Change | zod → `zod/mini` | about 37 kB gzip less in both the main and worker bundles |
| Remove | comlink | stale, hides the protocol; replaced by `protocol/bridge` |
| Remove | react-markdown, remark-gfm | 100 transitive packages, a 50 kB gzip chunk for one page |
| Keep | pure-rand, simplex-noise, three, react, zustand, base-ui, tailwind, clsx, tailwind-merge, vite-plugin-pwa, Babel | Babel stays for the Lingui macro |
| Don't add | ECS libraries, kdbush, rbush, dependency-cruiser, Nx, Turborepo, Sheriff, event-bus or DI libraries, wasm hashers, fflate | the in-house store and grid are faster; the build graph covers dependency-cruiser's rules without swc |

## 14. Migration

Sizes: S is under 400 changed lines, M is 400 to 1500, L is over 1500. "Move" PRs are scripted renames, merged in
a quiet hour. Every PR passes check, typecheck, knip and test.

| # | PR group | Size | Verification | Hash / saves |
|---|---|---|---|---|
| 0 | **Spike** on a throwaway branch: a 3-package skeleton proving isolated resolution, TS6307 on escape, Vite dev and HMR, `?worker`, Vitest projects, knip workspaces and PWA build | — | a written result; nothing merges | — |
| 1 | Safety net: pinned layer and 600-tick hashes, save fixtures (v0.6.4, main), save-load-run equality, frame and tick benches | M | a 1% change to an erosion constant fails the test | none |
| 2 | Untangle in place (boundaries research R1 to R5): mirror below rendering, stores out of app, shared UI stores, protocol folder, kernel subfolders | 3× M | `tsc`, unchanged screenshots | none |
| 3 | Name tables, `formerNames`, `WorldBase` store, envelope keys; on first launch, attach bases to every stored save in the background | M | fixtures load; reordering a catalog in a test still loads | saves gain keys; old saves still load |
| 4 | **Hash release A**, one release after step 3: exact math, hypot codemod, `unitHash`, named streams, tick-based strokes, tasks and water, lightning without the camera | 3× M, one day | cross-engine golden tests; pinned hashes updated on purpose | **hashes change**; saves with a base load; saves never opened since step 3 get the land-changed dialog |
| 5 | **Workspace move**: `src/*` into packages and `apps/game` by one ts-morph script; all of `simulation/` goes into `packages/simulation/src` as it is | L move | dev, build, preview, shots at 3 sizes; script re-runs on conflict | none |
| 6 | Kernel runtime: field store and operations; save-section registry; frame and mirror sections plus own bridge; phases runner in today's order; event queue | 5× M | hashes unchanged after each | none |
| 7 | Thing store, refs with generations, traits, spatial index, query API, impact | 2× L | query parity tests against the old scans; bench | **hash release B** (tie order by id) |
| 8 | Module contract and roster; tornado moved as the proof, then volcano and the element powers | M + S each | per-module tests unchanged | none |
| 9 | Property rewrites: rain and snow through `wetness`, tornado through `gust`, lava as a field, one hot-cell response | M each | #242 tests pass | **hash release C** |
| 10 | Engine registries: render stages, effect and thing presenters, audio parts | M each | screenshots before and after, near and far | none |
| 11 | Interface: panel registry, Lingui, `zod/mini`, privacy page in TSX | M each | browser tests; bundle size | none |
| 12 | Core modules out of `simulation`: weather, surface, fire, vegetation, hand, fauna, rivalry, society (split by subfolder) | L each, several PRs | hashes unchanged per move | none |
| 13 | Cross-browser replay CI, desync section dumps | M | Chromium, Firefox, WebKit and Bun agree | none |

- **Rewritten:** `Simulation`, `FrameBuilder`, the worker API, the services bag, hazard area loops, the grab
  chain, `WorldRenderer` wiring, HUD menus.
- **Moved as is:** generation, models, terrain and water shaders, society internals, audio core, design system.

**Lanes.** After step 5, five agent lanes run in parallel:

1. **Kernel**, steps 6 and 7, run serially by one agent.
2. **Determinism and saves**, steps 3, 4 and 13.
3. **Engine**, step 10.
4. **Interface**, step 11.
5. **Modules**, steps 8, 9 and 12. Once the contract lands, any number of agents can port one module each. Each
   touches only its own folder and one sorted roster line per side, so conflicts are adjacent lines at worst.

Move PRs (2, 5, and any large step 12 move) take a quiet-hour lock. The hash releases A, B and C each ship as one
minor version, with release notes saying that seeds play out differently.

## 15. Risks and open questions

- **Spike risk.** TS6307 through workspace symlinks, HMR across packages and the PWA precache are unproven until
  step 0. If TS6307 doesn't fire, module sides fall back to the closure test plus dependency-cruiser.
- **Project count.** About 11 packages and up to 80 module-side projects; TS 7 `--builders` should cope, but it is
  unmeasured. Fallback: one project per side for all modules, losing sibling isolation.
- **Query performance.** Step 7 benches gate the generic visitor; fire spread keeps a direct loop in its module.
- **Events** are a new class of determinism bug; the hasher digests the queue and emit depth is capped.
- **`WorldBase`** is about 16 MB raw per 640² world; compression and iOS quota are unmeasured.
- **Society** (15k+ lines) splits into tribes, jobs, construction and technology only after stat modifiers and
  events exist between them.
- **Open:** should `catalog/content` rows (species, buildings) also be contributed by modules, or stay central
  until mods exist? I lean central.
- **Open:** is lockstep near enough to justify step 13 before deeper tribes?
- **Open:** Lingui's Babel macro ties the build to Babel. Is that acceptable long-term against an OXC-only
  pipeline?
