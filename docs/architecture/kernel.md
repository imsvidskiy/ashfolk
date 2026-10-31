# Kernel, commands and events

The kernel runs the simulation one step at a time: commands come in, systems run in fixed phases, and events carry
facts between them. This file covers which mechanism fits a change, how a step runs, and how commands and events
work. Fields, things, reactions and `strike` are in [Cells and things](cells-and-things.md); the module contract is in
[Modules and registries](modules.md).

## Choosing a mechanism

Find the row for what you want to add; the last column gives an example.

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
| A tribe decision | `JobDefinition` or a consideration | `healer`, `sleep` when sick |
| A change to land or water | `TerrainEditor`, world-layer contributions | terraform, a dam |
| A core action | A `ModuleContext` service | `strikeLightning`, `explode`, `kill` |
| Something on screen | Render layer, thing presenter, effect presenter | the funnel |
| Something in the HUD | Mirror section, store, `PANELS` entry | sickness journal |

Where each mechanism is described: fields, cell properties, reactions, kinds, tags, flags, properties, columns, side
tables, traits and `strike` in [Cells and things](cells-and-things.md); events [below](#events); jobs and
considerations in [Society and fauna extension points](modules.md#society-and-fauna-extension-points); `ModuleContext`
services and `TerrainEditor` in [Context services](modules.md#context-services); world-layer contributions in
[T4](migration.md#phase-t-tribe-and-fauna-extension-points); mirror sections in
[Frame sections](bridge.md#frame-sections); render layers, presenters, stores and panels in
[Engine and interface](main-thread.md).

The extension points are a closed list: fields, cell-property contributions, reactions, trait responses, property
modifiers, considerations, jobs, relation modifiers, world-layer contributions, listeners, commands, tasks, save,
frame and mirror sections, presenters, panels and inspector rows. Adding another kind of extension point is an
architecture change.

## Steps, ticks and phases

The clock has two counters. `step` advances on every simulation step, paused or not. `tick` is game time and advances
only while the world runs. Commands and hashes are keyed by step; nature runs on ticks.

A step runs intake first. If the world is running, it then runs the six tick phases in order: `weather`, `emit`,
`react`, `nature`, `life` and `settle`. Last, it drains the events and advances the clock. Dirty indexes are refreshed
before intake, before each phase and before the drain, never by a query.

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

### Intake and the event drain

- **Intake** runs on every step: commands, the [tasks](determinism.md#replays-and-lockstep) due at this step and the
  held brush stroke ([Commands](#commands)). Terrain edits and the hand act at once, even while paused. Exposures that
  a brush stamps while paused combine with `max`, so they don't add up, and act at the next running tick.
- **Events drain on every step**, paused or not, so casting while paused shows its effect in the next frame. The queue
  is empty between steps, which an assertion checks. Events emitted during the drain join the queue and drain in a
  further round. A fifth round fails a development assertion; in production the remaining events carry over to the
  next step through the saved `pendingEvents` section ([Save sections](saves.md#save-sections)).

### Systems

- **No context bag.** A system gets its `ModuleContext` once, at creation, and closes over it. `run` receives only the
  `Tick`.
- **Order.** Within a phase, built-in systems run in `BUILT_IN_SYSTEMS` order, then module systems in `MODULES` order,
  then in registration order. `system-order.test.ts` prints the whole order and fails on any change. A change to the
  order is a hash change and carries the `hash-change` label ([Rules for every PR](migration.md#rules-for-every-pr)).
  A pair of systems that must run in opposite orders in two phases is pinned in `phase-pins.ts`.
- **Cadence.** `cadence: 50` runs a system every 50th tick, offset by a hash of its id.

### Derived layers

The derived layers (water, walkability, navigation, coast, crossings) are double-buffered. An edit to one of their
inputs records its region diff in a pending list and starts a rebuild that runs over a fixed number of steps, sliced
in work units, never in wall time. When the rebuild ends, the buffers swap.

The derived save section stores the pending list and the slice offset. After a load, the runtime builds the active
buffer from the inputs with the pending diffs reverted and resumes the slice, so a loaded run swaps at the same step
as the live one. Today's code breaks this: the running game checks navigation every 50 ticks, but a restore rebuilds
it at once, so a loaded run and the live one rebuild at different steps. [D3](migration.md#phase-d-determinism) fixes
it.

## Commands

Every change from outside the simulation arrives as a command, stamped with the issuing player, a sequence number and
the step it belongs to. The worker's tick source does the stamping
([Replays and lockstep](determinism.md#replays-and-lockstep)).

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

- **Declaration and handler.** A command's kind and schema are declared in `module.ts` or `shared/`, so both threads
  see them, and `assembly` composes the command union. The simulation binds the handler with
  `handleCommand(SPAWN_BOAT, (payload, issuer, tick) => …)`. A test checks that every declaration has exactly one
  handler.
- **Validation** is a pure function of the command and the state. A refused command becomes a notice event with a
  message id.
- **Payloads** carry quantized integers: centimeters, whole milliseconds. Every command, the local player's included,
  is applied only after the same encode and decode, so `-0` and float noise can't split peers.
- **Powers** go through `usePower { power, x, z, parameters }`.
- **Brushes.** A brush is clock state, driven by `strokeBegin`, `strokeMove` (quantized, at most 20 per second) and
  `strokeEnd`. Each step the kernel applies the held stroke at its rate times the step's share of real time. The tick
  source fixes that share per turn, so speed 16 doesn't multiply the stroke, and exposures are stamped on every step
  the stroke is held.
- **Pause and speed.** `setPaused` and `setSpeed` are commands today. Pause moves from a flag into clock state keyed
  by step. Speed moves from saved simulation state into tick-source state; it changes how many steps run per real
  second, never what a step does.
- **Inspection** is a query message, not a command ([Messages](bridge.md#messages)).

## Events

An event is a fact others may react to: a thing killed, a power used. Events are declared as typed handles and drain
on every step, as [the step](#intake-and-the-event-drain) describes.

`core/catalog/events.ts`, then `modules/tribes/sickness/simulation/sickness-listeners.ts`:

```ts
export const THING_KILLED = defineEvent<ThingKilled>({ id: "thingKilled", isPresented: true });

export const POWER_USED = defineEvent<PowerUsed>({ id: "powerUsed", isPresented: false });

export const MOURN_THE_SICK = listen(THING_KILLED, (tick, killed) => {
  recordLoss(killed.cause, killed.tribe, tick.day);
});
```

- **Typed channels.** Each handle owns one typed channel per world, so `emit` and `listen` are typed with no cast. The
  queue records the emission order across channels. Listeners run in `MODULES` order, then in registration order.
- **What a listener writes.** A listener writes only its own module's state. If something must change the world in the
  same tick, it is a field.
- **Shared facts** live in the catalog as generic events with a `cause` (`thingKilled`, `hazardStruckCamp`,
  `lightningStruck`, `fireSeen`, `waterChanged`, `powerUsed`), so society listens once for every hazard and beliefs
  can answer powers. A module's private events live in its `shared/`.
- **Volume.** High-volume facts (plants burning) are merged per 16×16 block before they are emitted, never sent per
  plant. A thing that would repeat a fact every tick keeps a cooldown column.
- **Presented events.** Events with `isPresented` also go into the frame as effects, coalesced per frame by kind and
  block ([Frame sections](bridge.md#frame-sections)). The chronicle stores `{ id, values }`, never English text
  ([Strings](main-thread.md#strings)).
