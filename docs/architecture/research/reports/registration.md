# Registration audit: what each new thing costs today

Paths are relative to `src/`.

## Measured history

| Feature | Commits | Files |
|---|---|---|
| Tornado | 01a491a (#221) | 18 (13 non-test) |
| Volcano | 24c94d3 (#240) | 35 (25 non-test) |
| Hand tool | #239, #243, #249, #250, #277, plus fixes 419e271, 9a7399f, a0cff29 | **44 distinct non-test source files** |
| Alder | c90a183, plus its icon in 8e584b6 and swamp rules in a9030f7 | 6, then more |
| Era buildings | 3fd8fc1 | 119 |
| Sound | 09e918e, then a2e7134 and 238260c deleted 111 catalog lines that nothing played | 172 |
| Install panel | 5aefd60 | 12 |
| Relations tab | c2c60b8 | 7 source files |

## (a) A new power

1. `content/powers.ts:31` holds the definition: name, zod parameters and usage. `POWER_GROUPS` (`:407`) must list every id. Tests pin the order in `content/powers.test.ts` and the names in `power-dock.test.tsx`.
2. The icon needs `design/icons/x.webp`, plus an import line and a key in `design/game-icon-sources.ts:103`.
3. `features/powers/power-icons.ts:4` `POWER_ICONS` (`Record<PowerId>`), and `:31` `POWER_OPTION_ICONS` for choice fields.
4. `simulation/powers/power-registry.ts:30` `POWER_HANDLERS`, and `:59` `POWER_SCHEMAS`. The second repeats `POWERS[id].parameters`.
5. The handler goes in `element-`, `land-` or `life-powers.ts`.
6. A power with state also needs:
   - its system;
   - a `PowerServices` field (`power-handler.ts:14-19`);
   - in `simulation.ts`: a field (`:144`), an `isBusy` check (`:206`), save or clear (`:92`, `:296`, `:321` versus `:330`), the services bag (`:584`) and a place in the tick order (`:753`).

   Tornadoes are cleared on load; volcanoes are saved as an optional field.
7. A new effect variant goes in `effects.ts:72,87`. `rendering/effects/effect-view.ts:145` must handle it, because it is exhaustive (`satisfies never`). `audio/effect-sounds.ts:71` is not exhaustive (it ends in `default:`), so a missing sound still compiles.
8. Death causes go in `person.ts:33` `DeathCause`, `society.ts:36` `DEATH_MESSAGES` and `fauna.ts:53` `AnimalDeathCause`.
9. The volcano added more:
   - frame: `frame.ts` (`LavaView`, `volcanoes`), `frame-builder.ts:53,67`, `frame-packing.ts` `packLava`, the transfer list in `workers/simulation-worker-api.ts:74`;
   - rendering: `world-renderer.ts:242`, `terrain-textures.ts:40,64,157`, `terrain-material.ts`, `data-textures.ts`, `fire-glow`/`fire-view`;
   - content: two grounds (`grounds.ts:5-6`) and a new `regrowth` column on all 19 grounds, read by `surface.ts:22` and `succession.ts`.
10. Sound: `audio/power-sounds.ts:10` `CASTS` and `:26` `BRUSHES` are `ReadonlyMap`s and not exhaustive. `world-sounds.ts` holds the lava emitters.

**Could collapse into one module:** a single power definition with metadata, parameters, group, icon and option icons. The handler sits beside it on the simulation side, and the cues sit on the engine side. `POWER_SCHEMAS` and `POWER_ICONS` would be derived. A hazard module would also declare its save section, frame section, effect view and `deathCauses: {tornado: "was swept away…"}`, so the `DeathCause` types and messages would be derived.

## (b) A new grabbable thing kind

1. `simulation/hand/grab-target.ts:4` `GRABBABLE_KINDS` is a zod enum, used by the command schema in `commands.ts:54`.
2. `grab-handlers.ts:25` `GRAB_HANDLERS`: five callbacks per kind.
3. Picking:
   - `game/input/entity-picker.ts:79-84` hard-codes the `"animal" | "person"` layouts (`:246` branches on the kind);
   - `agent-bodies.ts` holds the agent bodies;
   - plants go through a separate path in `plant-volumes.ts`.
4. Drawing:
   - each view calls `poseOf(kind, id)` (`hand-motion.ts:89`) and tests highlighting itself: `people-view.ts:204`, `animal-view.ts:244`, `vegetation-view.ts`.
5. Every system has to skip the held thing on its own, so each one was fixed separately: society nearby counts (419e271); fauna blasts, lightning and lava (9a7399f, which touched fauna, tornadoes and volcanoes); the tornado fling (a0cff29). 

**Could collapse:** a thing-kind descriptor with grab handlers, pick volume and pose hook. A shared spatial query that leaves held things out by default would replace the per-system checks.

## (c) A new plant species

Alder needed these:

- `content/plants.ts:5`: a hand-numbered index (`Alder: 27`) that shares one number space with the spread `CultivatedSpecies`;
- a `PLANT_SPECIES` row, where array position must equal the index;
- `PLANTING_RULES` per biome (`:362`);
- `models/plants/plant-models.ts:16` `VARIANT_COUNTS` (exhaustive) and `:97` `TREE_LOOKS`;
- `tree-species.ts:21` (height) and `:38` (generator);
- `rendering/vegetation/plant-palette.ts:23` `FOLIAGE_KEYS` (exhaustive);
- for the Forest power: the option at `powers.ts:123`, `CHOSEN_SPECIES` at `land-powers.ts:35`, the option icon at `power-icons.ts:31`, plus the WebP and `game-icon-sources`.

Saves derive `PLANT_SPECIES_NAMES` (`saved-world.ts:18`). But removing species (55efa5a, 4716707) renumbered Alder from 31 to 27. That forced the frozen `OLDER_SAVE_PLANT_SPECIES` list (`saved-world.ts:22-53`), which is exactly the kind of remap table the owner rejects.

**Could collapse:** one species row holding model, look, palette, icon and a `forestChoice` flag. The index would be the position at load time, saves would store names, and the Forest options and `CHOSEN_SPECIES` would be derived.

## (d) A new building

- `content/buildings.ts:4` `BUILDING_KINDS`: its order is the display order (`frame-packing.ts:292`).
- `BUILDINGS:44` row, plus a technology id and `recipes.ts` entries for crafts.
- `simulation/society/camp-plan.ts:36-48`: ring distances, where the order is the priority. Also `DWELLING_LADDER :12` or the enclosure choice at `:243`.
- `construction.ts`:
  - `:270` is a role switch that fills hard-coded tribe slots (`campfireId`, `storehouseId`, `totemId`);
  - `:320` is a message switch per kind.
- `models/structures/building-models.ts`: `:80` `BUILDERS`, the `SingleModelKind` exclusion list at `:95` and the scales at `:72`.
- `rendering/structures/building-view.ts:38-40`: the `ROUND`, `GLOWING` and `ENCLOSURE` sets.
- `features/tribes/tribe-icons.ts:28` `BUILDING_ICONS`, plus the WebP and `game-icon-sources`.
- `rivalry/walls.ts:6` `WALL_COVER`.

**Could collapse:** a row with its plan (ring, condition), message, model builder, look flags and icon. Behavior would follow from roles rather than switches on the kind.

## (e) A new UI panel

The install panel (5aefd60):

- its store and dialog;
- a connect call in `app/app.tsx:56-60`;
- placement in `app/hud.tsx` in two layouts (`WideHud`, `CompactHud`);
- each control written twice, in `interface/menu-buttons.tsx` and `compact-menu.tsx`;
- a store reset in `testing/browser-setup.ts`.

A settings tab needs the `SettingsTab` union (`interface-store.ts:7`) and `SECTIONS` (`settings-dialog.tsx:26`). A journal tab needs `JournalTab` (`:5`), `TABS` (`journal-panel.tsx:11`) and a hand-written `ScrollingPanel` (`:77`).

**Could collapse:** one list of panels, each with id, placement (`menu`, `settings` or `journal`), label, icon, `Content`, `connect` and `store`. The unions and both menus would be derived from it, and `browser-setup` would reset the registered stores.

## (f) A new sound cue

1. Encode the master with `bun run sounds` (`scripts/encode-sounds.ts:15` `cueSchema`).
2. Add a `SOUNDS` entry in `audio/sound-catalog.ts:11`, with one `new URL(...)` per variant.
3. Hook it into one of seven places:
   - `power-sounds.ts:10/26`;
   - the `effect-sounds.ts` switch;
   - `story-sounds.ts:17` (by `ChronicleCategory`);
   - `work-sounds.ts:19` (by `PersonPose`);
   - `interface-sounds.ts:8`;
   - the `world-sounds.ts` emitters and `PRELOADED :30`;
   - ambience, via `AMBIENCE_LAYERS :482` and `AmbienceLevels` (`ambience-levels.ts:8`).

Nothing links catalog entries to the code that plays them, so orphans pile up (a2e7134 and 238260c).

**Could collapse:** the owner declares the cue (power definition, effect module, chronicle row), and the catalog rows are generated from file stems.

## Registries keyed by id

These are exhaustive `Record`s unless marked as `Partial` or as a `Map`.

- **Power:** `POWER_HANDLERS`, `POWER_SCHEMAS`, `POWER_ICONS`, `POWER_OPTION_ICONS` (Partial), `CASTS`/`BRUSHES` (Map), `POWER_GROUPS`, `StoredParameters` (`power-store.ts:18`), `GUIDE_TIPS.powerId`.
- **Building:** `BUILDINGS`, `BUILDING_ICONS`, `BUILDERS`, `BUILDING_SCALES` (Partial), `WALL_COVER` (Partial), the camp-plan list, the kind sets.
- **Plant index:** `VARIANT_COUNTS`, `TREE_LOOKS`, `FOLIAGE_KEYS`, `TREE_HEIGHTS`, generators and looks (`berry-bushes.ts:41,102`, `orchard-plants.ts:42,75`, `rocks.ts:60`), `PLANTING_RULES`.
- **Animal:** `ANIMALS`, `ANIMAL_SPECIES`, `APPEARANCES`, `ANIMAL_MARKERS`, `ANIMAL_GIRTH`, `#kinds` (`animal-view.ts:144`), and a spawn power each.
- **Crop:** seven records, from `CROPS` to `RIPE_TINTS`.
- **Others:** `RESOURCE_ICONS`, `WEATHER_ICONS`, `ORE_TARGETS`, `ORE_SLOTS`, monument `LAYOUTS`, `CRAFT_WEIGHTS`, `JOB_LABELS`, `WEAPON_STATS`, `DEATH_MESSAGES`, `GRAB_HANDLERS`, `GUIDE_TIPS`, sound `CUES`/`STRIKES`/`AmbienceLevels`, `SECTIONS`, `TABS`.

## Order-coupled lists

- **Grounds:** the `Ground` enum (`grounds.ts:4`), with `GROUNDS[index]` (`:373`). Saved as raw bytes (`world-state.ts:251`), with no name table.
- **Plant species:** `PlantSpecies` with `CultivatedSpecies` and the order of `PLANT_SPECIES` (see c).
- **Biomes:** the `Biome` enum with `BIOMES`.
- **Material slots:** `MaterialSlot` with 56 slots and a hand-kept `MATERIAL_SLOT_COUNT` (`materials.ts:60`), feeding `SLOT_COLOR_TABLE`, the shader `uniformArray` (`node-helpers.ts:13`) and the vertex `slot` channel.
- **Human parts:** `HUMAN_PARTS` (`human-model.ts:39`), whose `indexOf` (`:166`) is baked into the `part` channel.
- **Bones:** `HumanBone`, `HumanJoint`, `QuadrupedBone` set the palette layout.
- **Frame buffer layouts:** `PersonField`, `AnimalField`, `SurfaceChannel`, `GroundChannel` (`agent-buffers.ts:3,25,61,70`).
- **Wire codes:** `ANIMAL_KINDS.indexOf` (`frame-packing.ts:252`); `weaponCode` and `gearCode` (`gear.ts:5,9`); `depositCode` (`deposits.ts:62`); `cropCode` (`crops.ts:81`). `cropCodes` are **saved raw** (`world-state.ts:228`).
- **Vertex channels:** `VERTEX_CHANNELS` and four per-view channel lists.
- **Saved layers:** `SAVED_TERRAIN_LAYERS` (`world-state.ts:49`).
- **Display orders:** `POWER_GROUPS`, `BUILDING_KINDS`, the camp-plan list.

## Summary

| Scenario | Spots today (non-test) | Could be |
|---|---|---|
| Power, stateless | 6 (content, 2 registry entries, icon map, icon source, handler) | 1 definition plus a handler, with derived maps |
| Power, hazard | 15–25 (simulation class ×5, services, effect ×3, death cause ×3, frame ×4, renderer, cues) | module: definition, system with save and frame sections, view, cues |
| Grabbable kind | ~10, plus a held check in every hazard | thing descriptor, with held left out of queries |
| Plant species | 8–12, plus save remaps when indices shift | 1 row, with names in saves |
| Building | 9–11 | 1 row; roles instead of switches on kind |
| UI panel | 5–7 | 1 entry in a panel list |
| Sound cue | 3, with no orphan check | cue declared by its owner; catalog generated |
