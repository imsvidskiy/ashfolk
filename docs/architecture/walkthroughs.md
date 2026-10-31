# Walkthroughs and checklists

Four walkthroughs show the architecture at work: one tornado tick, a new power, a new thing kind, and a new tribe
system with its own panel. The checklists after them are the steps to follow for each kind of change.

Each walkthrough states its **outside edits**: edits to files outside the module's folder. Registration lines
([Assembly lists and side records](modules.md#assembly-lists-and-side-records)) are counted apart. The count of
outside edits is the acceptance test for the architecture, and the [Modular goal](goals.md#goals) asks that every
walkthrough hold with the outside edits it states.

The walkthroughs use the declarations in [Steps, ticks and phases](kernel.md#steps-ticks-and-phases),
[Cells and things](cells-and-things.md), [Context queries](queries.md) and [Modules and registries](modules.md).

## The tornado, one tick

The tornado is a transient thing, held in the `TransientStore`, and its system runs in phase `emit`. Each tick it
measures its surroundings once, reacts to the biome and the forest, writes the gust exposure (a field that lasts one
tick), and strikes.

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

`TornadoColumns` is the tornado's column block in the `TransientStore`: path origin, heading and seed, age, radius,
strength and `calmUntil`. The loop therefore visits only tornadoes. `tornadoPositionAt` lives in the module's `shared/`
and writes into a scratch point. `TORNADO_VIEW`, `TREES` and `PEOPLE` are declared in the module's
`shared/tornado-view.ts`, shown in [Filters and area queries](queries.md#filters-and-area-queries).

### What it learns

One `measure` call over the disc tells the tornado:

- the dominant effective biome: water over lakes, lava fields over lava;
- trees by species, weighted by each species' `WIND_HOLD`;
- fire: the maximum and the burning cells;
- people by tribe.

From that, the tornado sets a target strength. Over water it grows into a waterspout toward the maximum; over lava
fields it carries ash at a fixed strength; a forest drags it down. Strength moves toward the target at a rate times
`tick.seconds`, clamped. The fire-whirl and struck-camp events fire when the tornado first finds fire or people in
its disc, then wait out a cooldown (`calmUntil`).

### Who reacts

- **In `react`**, the reaction `wind-blows-out-fire` reads the gust and replaces the tornado's `blowOut` loop. Burning
  buildings go out through fire's `flammable` trait response, which reads the lowered cell fire; this removes
  `buildings.blowOut`.
- **Through `strike`**, inside the tornado's own `emit` run, movers are pushed and swirled by mass (today's code
  swirls a mammoth like a hare) and harmed according to their wind resistance. Trees fall with an angle from
  `unitHash`, and shrubs go. Held things are skipped by the filter's default.
- **When events drain**, after `settle`, `thingKilled` and `hazardStruckCamp` become chronicle lines from the
  module's death message ([the event drain](kernel.md#intake-and-the-event-drain)).

### Cost

At radius 140 m one tick costs about 615 cells for the measure and the swirl stamp (two `FieldWriter` writes each),
two short mover bucket walks, the uproot pass over the plants under the core, and two `strike` scans, with no
allocation. Today the tornado makes two allocating disc walks, five linear agent scans, and seven temporary arrays per
tick plus two per uprooted cell. The 25 µs [budget](migration.md#budgets) applies to the whole `rage()`.

Outside edits: none.

## A new power: acid rain

The brush stamps the `soak` exposure and a persistent field `acid` with the `tiled` layout, the tags `wet` and
`corrosive`, and a `decayPerDay`.

```
modules/elements/acid-rain/
  module.ts                       power (zod/mini radius, strength), sides, icon URL, death cause, command
                                  declarations; catalog: ACID field, grounds patch { barren },
                                  trait patch corrodes → wooden kinds, the corrodes trait declaration
  messages.ts
  locales/en.po, ru.po
  simulation/acid-simulation.ts   two reactions (acid-sears-ground, meadow or steppe → barren),
                                  respondTo(CORRODES), the stroke handler
  simulation/acid-simulation.test.ts
  engine/acid-tint-layer.ts       TerrainLayer reading the acid channel of the cell-state pages
  engine/acid-rain-cue.ts, acid-hiss.webm, acid-engine.ts
  engine/acid-tint-layer.browser.test.ts
  interface/icon.webp
```

- **What needs no code.** Fires go out through `soak-douses-fire`, because the brush stamps `soak`. The rain look's
  tint goes through the precipitation look slot that weather owns.
- **Registration.** Four lines: `MODULES` (appended), `POWER_ORDER`, `SIMULATION_MODULES` and `ENGINE_MODULES`. Two
  of them are order-significant: `MODULES` and `POWER_ORDER`.
- **The new ground.** `barren` is a catalog contribution appended to the ground range and named in the ground name
  table. Every ground table is built from the compiled catalog, so fuel reads its rest for `barren`, not `NaN`.
- **Saves.** A save written before the module has no `acid` and loads it at rest. A build without the module keeps the
  unknown section verbatim, writes it back, and loads `barren` cells through the ground fallback.

Outside edits: none.

## A new thing kind: boat

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
  them. The `floats` response is a `life`-phase system in `simulation/`. It moves boats down the water surface
  gradient and with the gust, and beaches them where `HAS_WATER` is false. The response moves to core when a second
  kind floats.
- **Fire, the hand, the tornado and lava** need no code. `flammable` heats and burns movers per thing, lava included;
  `grabbable` with `settlesOn: "water"` lets the hand set the boat on water; `strike` pushes it by mass.
- **Files:** `module.ts`, `messages.ts`, `locales/{en,ru}.po`, `shared/boat-kind.ts`, `simulation/boat-simulation.ts`
  (the `floats` response and the `spawnBoat` handler) and its test, `engine/boat-model.ts`, `engine/boat-presenter.ts`
  (a `ThingPresenter`: layer, pick volume, rings, hand pose), `engine/boat-engine.ts` and `interface/icon.webp`.
  Inspection comes from the generic kind rows.
- **Registration.** Four lines. `tsc` asks for the presenter, because `THING_PRESENTERS` in `engine/runtime` is keyed
  by every kind manifest with a packed frame ([Presenters](main-thread.md#presenters)).

Outside edits: none.

## A new tribe system: sickness with a journal panel

- **State.** `germs`, a sparse field tagged `contagion`, and the columns `infection` and `immunity` on the person
  group. All are declared in the module's catalog contribution, with the disease rows: routes, affected tags, an
  onset–peak–end curve and lethality.
- **Simulation.**
  - Reactions on `germs`: germs fade in sun and thrive on `swamp` and `bog` ground.
  - `sickness.catch` runs in phase `life` with cadence 10. It samples germs at each person's cell, counts sick
    neighbors with `count(contactDisc, sickPeople)` (a filter on the `sick` flag), and compares the result with the
    `RESISTANCE` property. Warmth, hunger and a future herbalism technology modify that property per tribe, so the
    systems that provide them never write code for sickness.
  - Sickness progresses along the curve. Death goes through `actions.kill` with the module's death cause.
  - A consideration raises the score of `sleep` for sick people. A `healer` job is a `JobDefinition` in the module.
  - The events `fellIll` and `recovered` live in the module's `shared/`; deaths are `thingKilled` with the cause
    `sickness` from the catalog.
- **Panel.** `shared/sickness-frame.ts` holds per-tribe counts, built once per game hour. A mirror section carries
  them, and `useSicknessStore` subscribes to its reader. `interface/sickness-journal.tsx` is registered as
  `{ id: "sickness", placement: "journal", label, icon, load }` in `PANELS` in `interface/app`. The journal derives its
  tabs from `PANELS`, and test setup resets registered stores.
- **Look.** Sick people turn pale through a person visual-state channel that the people presenter exposes to modules.

About 16 files and five registration lines. Outside edits: none, once the society extension points and the
visual-state channel exist ([Phase T](migration.md#phase-t-tribe-and-fauna-extension-points)).

## Checklists

### A new power or hazard

1. Make `modules/<domain>/<name>/module.ts` with `defineModule`: sides, `requires`, powers, catalog contribution
   (fields, kinds, trait declarations, death causes), command declarations, icon.
2. Write `simulation/`: a system that writes fields or exposures, calls `strike` or a core action, or emits catalog
   events. Never call another system. If the power should affect something, write a reaction against a field or tag.
3. Keep lasting state in a transient thing or a field; give anything else a save section with `reset`.
4. Add `engine/` (layer, presenter, cue) and `interface/` only if the module has them. For text, declare message ids
   in `module.ts`, add a `msg` descriptor for each in `messages.ts`, run `lingui extract`, and translate the new lines
   in `locales/ru.po` ([Strings](main-thread.md#strings)).
5. Append the module to `MODULES` and add it to `POWER_ORDER`; `tsc` names the side records to fill.
6. Write one test per rule. Check that the system order and the digests change only as meant, and use the
   `hash-change` label if they do ([Rules for every PR](migration.md#rules-for-every-pr)).
7. Look at near and far scenes; add a scene to `tests/scenes.ts` if the change only shows by eye.

### A new thing kind

1. Call `defineThingKind` in the owning module's `shared/`: group, tags, values by handle, traits.
2. If the kind needs behavior no trait has, declare a trait in `shared/` and respond to it in `simulation/`; promote
   the trait to core when a second kind uses it.
3. Fill the `THING_PRESENTERS` entry `tsc` asks for.
4. Save references through `thingRef`, and key randomness on the thing's serial.
5. Test that `strike`, fire and the hand treat the kind by its properties.

### A tribe system

1. State: columns on existing groups, fields for anything spatial, side tables keyed by serial for the rest, all
   declared in the catalog contribution.
2. Behavior: `JobDefinition`s, considerations and property modifiers; never import society.
3. Facts: catalog events, or events in the module's `shared/`.
4. Panel: a frame section, a mirror section, a store subscribed to its reader, and a `PANELS` entry with `load`.

### A page

1. Put the page and its entry in `interface/pages/<name>/`, and the HTML shell at the URL path.
2. Add the page to `PAGES` and to `public/sitemap.xml`.

### A change to generation

Generation changes don't wait for any step ([decision 8](decisions.md#owner-decisions)).

1. Re-pin the generation fingerprint files under the `hash-change` label.
2. Say in the release notes that new islands differ, that worlds saved with a [`WorldBase`](saves.md#the-world-base)
   keep their land, and that saves written before [S3](migration.md#phase-s-saves) show the land-changed dialog.
