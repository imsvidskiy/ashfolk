# How shipped sim games make "everything has properties and interacts"

plan.md already uses BotW, Noita and Powder Toy for **cell chemistry**. Shipped games add what it lacks: **tags on every
kind**, **comps on things**, **derived stats**, **a query layer with aggregates**, **multi-cadence ticks**, **saves by
name with aliases**.

## 1. Data stage, then frozen type objects

- Factorio has a settings stage, then a prototype stage. Each runs `data.lua`, `data-updates.lua` and `data-final-fixes.lua` across all mods in dependency order, so later mods change earlier prototypes. After that, "prototypes can no longer be modified" at runtime. https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html
- Other examples: RimWorld XML Defs with `[DefOf]` static binding (https://rimworldwiki.com/wiki/Modding_Tutorials/Linking_XML_and_C), ONI element YAML in `StreamingAssets/elements` (https://oxygennotincluded.wiki.gg/wiki/Module:Data/solid), Dwarf Fortress `[TOKEN:arg]` raws.
- **Ashfolk:** build the registry in three rounds (base, then mods/scenario, then final fixes), freeze it, give it dense indices at compile time and never save those indices. Both threads build the same registry, and lockstep peers compare a hash of it before play.

## 2. Saves by name, with aliases on the definition

- Factorio's JSON migrations are rename pairs, `{"entity": [["wall","stone-wall"]]}`. Renaming keeps `unit_number`, and each save records applied migrations by name. https://lua-api.factorio.com/latest/auxiliary/migrations.html
- RimWorld saves `defName`s. Renamed defs are remapped on load through `BackCompatibility` (forum evidence only: https://steamcommunity.com/workshop/filedetails/discussion/1321849735/3110267314139419788).
- **Ashfolk:** use a name table for **every** registry (grounds, technologies, species, buildings, powers), plus `formerNames` on the definition itself. That is a rename that lives with the def, not a per-version index remap, so it meets the owner's rule. Fixes technology renames throwing and grounds lacking a table.

## 3. Tags: named, composable sets, compiled once

- Minecraft tag files live in `data/<ns>/tags/<registry>/`. They hold `values`, can reference other tags with `#`, use `replace` for merge control, and can mark entries `required:false` so a pack still loads when a mod is missing. Registries include `worldgen/biome`. Game logic reads them: `campfires` decides what flint and steel can light, and `blocks_lava_fire_spread` controls fire spread. https://minecraft.wiki/w/Tag_(Java_Edition), https://minecraft.wiki/w/Block_tag_(Java_Edition)
- Noita reactions accept `[fire]`, `[water]` and `[corrodible]` tags, and the engine adds `[any_liquid]`. https://noita.wiki.gg/wiki/Documentation:_Reaction
- **Ashfolk:** add `tags` to species, grounds, biomes, buildings, animals and hazards (`tree`, `conifer`, `flammable`, `wet`, `hot`, `shelter`). Compile them to a `Uint32` mask per kind index, and let mods append to them. A rule or query filters on `tag: "tree"`, never on a species list.

## 4. Numeric properties and threshold transitions as data

- Powder Toy `WATR` declares `Flammable=0`, `Weight=30` and `HeatConduct=29`, plus `LowTemperature=273.15 → PT_ICEI` and `HighTemperature=373 → PT_WTRV`. Special cases go in `Update=&update`, which scans 8 neighbours with `sim->rng.chance`, for example to douse FIRE. https://github.com/The-Powder-Toy/The-Powder-Toy/blob/master/src/simulation/elements/WATR.cpp. Its flags are bitmasks: `TYPE_LIQUID`, `PROP_CONDUCTS`, `PROP_LIFE_DEC`. https://github.com/The-Powder-Toy/The-Powder-Toy/blob/master/src/simulation/ElementDefs.h
- ONI uses `highTemp → highTempTransitionTarget`, plus a by-product (`highTempTransitionOreId`, mass conversion). https://oxygennotincluded.wiki.gg/wiki/Module:Data/solid
- Dwarf Fortress uses `IGNITE_POINT`, `MELTING_POINT` and `BOILING_POINT`. "Fire-safe" is defined as having no `IGNITE_POINT`. https://dwarffortresswiki.org/index.php/Fire-safe
- **Ashfolk:** grounds declare `ignitesAt`, `meltsInto` and `quenchesInto: "basalt"`. Lava meeting water becomes a transition declared on lava data that emits a `steam` event. That replaces the `quenchedCell` bookkeeping (`src/simulation/powers/volcanoes.ts:293-295`). Keep an optional per-kind `update` hook only for special cases, as Powder Toy does.

## 5. Reaction tables on dirty chunks

- Noita reactions have `input_cell1/2`, `output_cell1/2`, `probability` (×100 int), `convert_all`, `blob_radius`, an `entity` to spawn and an `ExplosionConfig` (Reaction doc above). Each 64×64 chunk keeps a dirty rect. Threads update chunks in a 4-pass checkerboard. Fire "will look in a random direction to see if it can ignite that pixel", and water hit by fire turns to steam. https://80.lv/articles/noita-a-game-based-on-falling-sand-simulation/
- **Ashfolk:** plan.md's `Reaction` gains two things: outputs may **spawn things or events** (as Noita's `entity` does), and the probability comes from `unitHash(seed, tick, cell, rule)`. Align dirty regions with the 64-cell terrain patches and the frame row runs. Skip the checkerboard threading, because one worker keeps determinism simple.

## 6. Comps: data half plus behaviour half

- RimWorld pairs `ThingComp` with `CompProperties`. A ThingDef's `<comps><li Class="…Props">` creates comps from data. Lifecycle hooks: `Initialize`, `PostSpawnSetup`, `PostExposeData` (save), `PostDeSpawn`, and `CompTick` or `CompTickRare`, gated by the def's `tickerType`. Access is `GetComp<T>()` or `TryGetComp<T>()`. https://www.rimworldwiki.com/wiki/Modding_Tutorials/ThingComp
- `DefModExtension` covers data-only fields. https://rimworldwiki.com/wiki/Modding_Tutorials/DefModExtension
- **Ashfolk:** a thing kind declares `traits: { flammable, grabbable, uprootable, shelter }`. Each trait module owns its typed columns, its save section, its `respond` and its inspector rows. "Grabbable" becomes one trait instead of edits to 5 files (`grab-target.ts`, `grab-handlers.ts`, `entity-picker.ts`, `hand-motion.ts`, the views). Traits are listed on the **kind**, not on each instance, so stores stay SoA and nothing is allocated per thing.

## 7. Derived stats with ordered parts and explanations

- RimWorld computes a stat as base value, then offsets and factors (skills, stuff, quality, comps), then `StatPart.TransformValue`, then clamp. Each part also supplies an `ExplanationPart`. https://rimworldwiki.com/wiki/Stat
- **Ashfolk:** `effective(stat, thing)` starts from the species base and applies age, wetness, season and tribe technology. The tornado's uproot check reads `windResistance`, and sickness reads `resistance`. The inspector shows the explanations.

## 8. Spatial queries: cell grid, radial cache, aggregates

- Factorio's `find_entities_filtered{area | position+radius, name, type, force, limit}` has a non-allocating `count_entities_filtered`. Pollution "is stored per chunk", and `calculate_tile_properties` exists. https://lua-api.factorio.com/latest/classes/LuaSurface.html. Forum measurements: cost grows linearly with area × entities, so keep your own list and update it from create/destroy events. https://forums.factorio.com/viewtopic.php?p=525973
- RimWorld (secondary sources): `GenRadial` caches sorted radial offsets at startup (https://ludeon.com/forums/index.php?msg=346029). Rooms aggregate state: one temperature per room, and room stats. https://rimworldwiki.com/wiki/Rooms
- **Ashfolk:** one `Place` API.
  1. **Cell reads**: biome, ground, `hasWater` (the one water rule, `src/world/water.ts:265`), fields, slope, height.
  2. **Radius visitors**: walk a precomputed sorted offset table and filter by kind, tag and tribe. A `count` form allocates nothing. This replaces the ad hoc `cellsInArea` arrays (`src/simulation/world/terrain-editing.ts:49`).
  3. **Block summaries** per 16×16 cells: biome histogram, plant counts per tag, burning cells, max heat, people and animal counts. They are kept current from change trackers, so "is there fire near the tornado, which trees" costs O(blocks), not O(cells).

## 9. Several tick cadences

- RimWorld: every tick (Normal), Rare (250 ticks) and Long (2000 ticks). https://rimworldwiki.com/wiki/Ticks
- Minecraft: random ticks pick `random_tick_speed` blocks per 16³ section each tick and skip sections with no block that reacts. Scheduled ticks are a queue ordered by priority, then insertion order, capped at 65,536 per tick. https://minecraft.wiki/w/Tick
- Factorio keeps an intrusive linked list of active entities with "O(1) time to turn any entity on/off". "Inactive turrets … take 0 time." https://forums.factorio.com/viewtopic.php?p=303572
- **Ashfolk:**
  - **Every tick**: fields with active `CellSet`s.
  - **Rare buckets**: `thingId mod N` spreads the cost of slow thing updates.
  - **Seeded random block ticks**: regrowth, snow melt, soil, germ decay, all drawn from `unitHash(seed, tick, block)` and skipping blocks the summary marks inert.
  - **Scheduled queue** keyed by (tick, priority, sequence): lava cooling, ember landing, delayed collapse.
  - **Awake lists** for things.

## 10. Lockstep checks

- Factorio sends only actions, and every peer simulates every tick (https://factorio.com/blog/post/fff-76). A cheap "heuristic CRC" of a few summaries (players, active entity count, production stats) is compared every tick, with a full-state CRC for debugging. https://factorio.com/blog/post/fff-55, https://factorio.com/blog/post/fff-188
- **Ashfolk:** a per-tick hash over block summaries, active-set sizes and RNG state; full hash on demand.

## 11. Sickness

- Dwarf Fortress syndromes set transmission with `SYN_CONTACT`, `SYN_INHALED`, `SYN_INGESTED` or `SYN_INJECTED`, filter targets with `SYN_AFFECTED_CLASS`, and define effects like `CE_NAUSEA:…:START:400:PEAK:500:END:1200`. https://dwarffortresswiki.org/index.php/v0.34:Syndrome
- ONI germs live in cells and items. Each medium has its own growth and half-life. Germs spread to an adjacent cell of the same phase above a diffusion threshold, and the cap per phase scales with mass. https://oxygennotincluded.wiki.gg/wiki/Food_Poisoning, https://oxygennotincluded.wiki.gg/wiki/Germ
- **Ashfolk:** a sickness def holds routes, affected tags and an effect curve. Germs are a sparse field with an active set, with growth keyed on ground and biome tags, wetness and heat. People pick up exposure by sampling their cell in `respond`.

## The four examples through these patterns

- **Tornado asks its surroundings**:
  ```
  place.at(c).biome
  place.blocksAround(c, r).sum("burning")
  place.visit(c, r, { kind: "plant", tag: "tree" }, visitor)
  effective("windResistance", plant)
  ```
  Today this is hand-written loops in `src/simulation/powers/tornadoes.ts:162-170`.
- **Rain douses fire**: rain stamps a `soak` exposure, and the `soak-douses-fire` rule handles the rest. Today this is direct calls to `fire.douse` at `element-powers.ts:91,117`.
- **Lava meets water**: a transition declared on lava data, plus a steam event (§4).
- **Sickness spreads**: a germ field, block ticks and a stat for resistance (§11).

## Gaps

- No primary source for WorldBox internals, RimWorld regions, `GenRadial` or `TickList` hashing; those rest on community sources. Songs of Syx: only its devlog's moddable list (https://songsofsyx.itch.io/songs-of-syx/devlog/170956/refinement-mod-support).
