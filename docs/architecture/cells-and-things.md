# Cells and things

Systems and modules share two kinds of world state: values per cell (fields and cell properties) and things (plants,
animals, buildings, people, transients and features) with their kinds. This file covers both, then reactions, which
turn one field into another, and `strike`, which applies force and harm to the things in an area. Which mechanism fits
which change is in [Choosing a mechanism](kernel.md#choosing-a-mechanism).

## Cell fields and cell properties

A **field** is a value stored per cell. A field with `lifetime: "persistent"` is saved. A field with
`lifetime: "tick"` is an **exposure** (gust, soak, blast): it is cleared at `settle` and never saved. A **cell
property** is a value derived from others and is never saved.

Field definitions are pure data, declared in `core/catalog` or in a module's catalog contribution, so the main thread
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

### Layout, rest and floors

- **Layout.** `dense` fields (wetness, snow) are full arrays tracked by 32-cell segment bitsets. `sparse` fields
  (fire, heat, lava, germs) carry an active set. `tiled` fields allocate 64×64 tiles on first write (acid, a module's
  rare field). Exposures are sparse stamps cleared through a touched list, never with `fill`.
- **`rest`** is the value a cell returns to, and the value the field loads at from a save written before the field
  existed. Fuel's rest comes from a ground property, as `sparseDifference(fuel, groundFuel(...))` does today.
- **Floors** are applied in the field's own decay pass, never in `add` or `set`, so weak contributions from several
  sources still add up. Fire's `HEAT_FLOOR` works this way today.

### Writing fields

There are two write tiers:

- The system that owns a field (fire spread, the surface sweep, growth) gets a **field kernel**: it takes the raw
  arrays once at creation, calls `markRows` or `markChunk` in bulk and keeps today's bit tricks. `kernel(handle)`
  succeeds only for fields the caller declared, checked at creation. Other fields come as read-only arrays through
  `read(handle)`.
- Everyone else writes through one concrete `FieldWriter` class with the policy as data, so call sites stay
  monomorphic.

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

**Dirty chunks and digests.** Every write path sets a bit per 64×64 chunk and folds the change into the chunk's
order-free digest ([Hashing](determinism.md#hashing)). The frame builder and the base diff each keep their own copy
of the bits and clear only their own. In tests, a debug verifier recomputes the digests from raw data.

### Mirroring

Mirroring is opt-in. A field with `mirror` gets a byte channel in a shared RGBA8 cell-state page that feeds both the
frame diff and the GPU textures. Its handle is a `MirroredField`. The main thread's reader accepts only those, so a
main-thread query can't name an unmirrored field.

### Cell properties

Cell properties compile once per world into one function over resolved arrays: a base plus contributions from
modules, merged in ascending `priority` (ties in `MODULES` order). Each contribution may override the value so far. A
test pins the merged order.

Properties read per cell on hot paths are **materialized**: kept as derived u8 layers that are refreshed from their
inputs' change bits. `EFFECTIVE_BIOME`, `HAS_WATER` and `WALKABLE` are materialized. Fire reads `FLAMMABILITY`
through the same compiled function, so the rule exists once.

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

The built-in properties:

- `HEIGHT`, `SLOPE`, `GROUND`, `HAS_WATER`, `WATER_DEPTH` and `EFFECTIVE_BIOME`.
- `AIR_TEMPERATURE`: base, altitude, season and weather.
- `FLAMMABILITY`: ground, canopy fuel and wetness.
- `WALKABLE`: footing plus contributions from dams, ice and bridges.

`HAS_WATER` is backed by the one water rule, `hasWater` in `core/world/water`. Walkability contributions have
hysteresis: ice freezes walkable above one thickness and thaws below a lower one. Navigation rebuilds only the areas
whose walkability flipped, at a saved step cadence.

## Things, kinds, tags, flags and properties

A **thing** is anything with a place in the world that systems query and act on. Things stay in their stores, and
every store answers one interface, `ThingSource`:

- People, animals and buildings stay objects with their monotonic `id` from `IdentifierSource`; herds draw from the
  same source. The new API calls this id the `serial`.
- Plants stay in the structure-of-arrays `VegetationStore`.
- A new `TransientStore` holds tornadoes, meteors, embers, arrows, craters and danger sources as column blocks per
  kind behind one `ThingSource` view, so they are saved, framed and queryable.
- Features (crossings, deposits, later tribe-built bridges and perhaps monuments) get a group of their own.

Plants, buildings and features are **anchored**: their source, an `AnchoredSource`, also lists its things per cell,
through `firstInCell` and `nextInCell`.

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

### Identity and positions

- **Identity.** Public and saved identity is `(kind name, serial)` for agents, buildings and transients, and
  `(plant, slot, generation)` for plants. `VegetationStore` gains a saved `generation` column, which ends the ABA
  reuse behind `PlotSpot.plant`, where a slot freed and reused by another plant passes for the same plant.
- **References.** Saved state refers to things only through the `thingRef` codec. Randomness is keyed on serials,
  never on slots. Frame id columns are `Uint32Array`, never `Float32Array`.
- **Positions.** Agent positions stay float64. Plants stay float32.

### Kinds and catalog tables

- **Local indices.** Each group has its own dense local index range for its kinds. Module rows append inside their
  group's range when the catalog compiles, so `PLANT_SPECIES[species]`-style lookups keep working. A test pins the
  base local indices per group, because `PlantSpecies.X`, `Biome.X` and `Ground.X` appear about 890 times in 86 files
  (600 in 43 non-test files).
- **Names.** Names and `formerNames` share one namespace across groups.
- **Plant rows.** The plant species column widens to `Uint16` when the species count needs it. Rocks and monument
  pieces stay plant rows, so plant slots never renumber; `rock` and `monument` are kind tags. Monument damage moves
  out of the piece's `seed` into the monument section, keyed by monument id.
- **Catalog tables.** Every per-kind, per-ground and per-species table is built from the compiled catalog when a world
  is created. Code reaches the tables through `ModuleContext.catalog` on the worker and through the mirror's catalog
  on the main thread. Free `core/world` helpers take a `CatalogTables` argument. Module-scope tables are ruled out:
  the ones today (`GROUND_FUEL` in `surface.ts`, `obstacles.ts`, `vegetation-chunks.ts`, `vegetation-view.ts`) would
  read `undefined` for a module ground and write `NaN` into saved fuel.

### Tags and flags

- **Tags** are static per kind (`tree`, `conifer`, `wooden`, `uprootable`, `movable`), compiled into multi-word masks.
  `WOODED_BIOMES` and the three other conflicting biome groups become one `wooded` biome tag.
- **Flags** are dynamic per thing (`held`, `burning`, `sick`). The code that owns a flag registers it, and flags are
  stored in multi-word flag masks per store. `held` is excluded from every query by default, in one place.

### Properties and damage types

**Properties** are open, and every property can take modifiers. A property such as
`defineProperty({ name: "windResistance", rest: 0.5 })` compiles to one `Float32Array` per property, indexed by kind.
Catalog rows set values by handle: `values: [value(MASS, 300), value(WIND_RESISTANCE, 0.5)]`.

Modifiers fold into the property by what they depend on:

- Modifiers that depend on kind and world state (season, rules) fold into a per-kind array.
- Technology modifiers fold per tribe and kind, for people and buildings (eight tribes or fewer).
- Per-thing modifiers are column reads compiled into the property.

When no modifier exists, a read is one array index. `explain` runs only for the inspector.

**Damage types** are handles, each with its resistance property:
`defineDamage({ name: "wind", resistance: WIND_RESISTANCE })`. Wind damage and forest drag are separate properties
(`WIND_RESISTANCE`, `WIND_HOLD`).

### Columns and side tables

**Columns** are per-thing data that a module adds to a group it doesn't own:
`defineColumn({ group: ThingGroup.Person, name: "infection", rest: 0, storage: "f32" })`. Columns are saved by name,
cleared on spawn and mirrored only on opt-in. Non-numeric per-thing data lives in side tables keyed by serial, each
with its own save section.

### Traits

A **trait** is behavior with configuration. The system or module that owns a trait declares it in `core/catalog` or in
the module's `shared/` with `declareTrait({ id, config })`, where `config` is a zod/mini schema. The simulation side
binds the response with `respondTo(FLAMMABLE, response)`, listed in `ModuleRuntime.traitResponses`. `flammable`
belongs to fire, `grabbable` to the hand, `uprootable` to vegetation. Configs are validated when the catalog compiles,
and catalog patches may attach a trait to another module's kind by name.

**Trait responses have a driver contract**, which says how a response is driven:

- Anchored things, such as plants and buildings, respond from a field's active set through the per-cell list, so a
  response costs nothing where nothing burns.
- Movers (people and animals) and transients respond per thing.

A response declares which, and the catalog compiler rejects a per-thing sweep over plants. Plants keep burning as a
per-cell aggregate (`canopyFuel` and a state flip), with no per-plant heat. Harm from the cell a thing stands on
(fire, heat, lava) belongs to trait responses only; [`strike`](#strike) is for area blows.

### Tribes

Tribes get a store with columns and properties like any group, without a position index. `TribeQuery.relation(a, b)`
reads the relation book, and modules add relation modifiers. Tribe stock is columns keyed by the resource catalog. A
membership API moves people between tribes and emits `personJoinedTribe`, for marriages and tribute.

A territory `claim` field (a tribe slot per cell) makes "whose land is this" a cell read. It is derived from today's
saved `Claim` circles, which stay the saved form.

## Reactions

A **reaction** is a batch kernel called once per tick over the active cells of its driving field, the field named by
`drivenBy`. Field arrays are resolved at creation, so nothing looks up a field by handle inside the loop.

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

- **Drivers.** Only sparse fields and exposures drive a reaction; the catalog compiler rejects a dense driver. A rule
  that depends on a dense condition (germs on wet cells) runs on a row sweep like `SurfaceSystem`'s 32 rows per tick,
  with its rate scaled by the sweep period. Global weather stays a scalar in `Environment` (renamed
  `EnvironmentReading`) and is never stamped on every cell.
- **Order.** Built-in reactions run first, then module reactions in `MODULES` order. Rules apply at once, in list
  order. A test pins the order. Reaction tests run the digest verifier, so a missed mark fails.
- **Iteration.** The pass walks a copy of the active cells taken at the start of the pass, in ascending cell order.
  Cells added during the pass are visited next tick.
- **Chance** comes from `unitHash(seed, tick, cell, ruleHash)`, so it doesn't depend on order
  ([Exact math and randomness](determinism.md#exact-math-and-randomness)).
- **Transitions as data.** Grounds and fields declare thresholds (`quenchesInto: "basalt"`, `meltsInto`,
  `ignitesAt`). The `transition()` helper turns each into an explicit reaction listed in `REACTIONS`, so every rule
  can be found with grep.

## Strike

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

- **Scaling.** `harm` is scaled by the thing's resistance to `damage`. `push` (outward) and `swirl` (around the center)
  are divided by `mass`. `uproot` goes to plants through the `uprootable` trait: trees fall, shrubs go, and rocks and
  monuments have no trait.
- **Reuse.** A hot caller keeps one `Blow` per kind of blow and sets its numbers each tick.
- **Health** is a share from 0 to 1 everywhere, in memory and in the logical save schema. Building and animal health,
  absolute today, becomes a share too.
- **Order.** Candidates are visited in ascending serial (plants by slot), so kills, chronicle lines and draws keep
  today's order.
- **Core and fright.** A hazard that hurts in its core and frightens wider strikes twice.
- **Danger.** `strike` adds a danger source, a transient with center, radius and expiry, which replaces
  `DangerZone[]`. Agents find it with `nearest` and flee from its center. Diffuse dangers (fire, lava) stay fields.
- **Effects.** `strike` emits `thingKilled` for deaths and accumulates harm in columns. It never emits per-hit events.
