# Things inventory (origin/main snapshot)

Paths are relative to `$R/src`. "Shared id" = `IdentifierSource`, one monotonic counter (simulation/identifiers.ts) used by people, animals, herds, buildings and tribes.

## Table

| Thing | Storage | Id | Save | Frame | Spatial index | Implicit properties |
|---|---|---|---|---|---|---|
| **Plants** (trees, shrubs, **rocks**, **6 monument pieces**) | `VegetationStore` SoA: x,z,height,rotation,seed,bornDay,fruit F32; species,state,wear U8; cell I32 (world/vegetation-store.ts:85-130) | slot index, reused via `#freeSlots` (:179), no generation | dense copy of every channel plus linked list, free slots, burnt queue (:433-453); species name table plus `OLDER_SAVE_PLANT_SPECIES` fallback (simulation/saved-world.ts:22-55, 184-202) | patch of changed slots (:396-416) | per-cell linked list (:298-318) | burns if `canopyFuel`>0 (content/plants.ts:41; vegetation-store.ts:332-343); edible `givesBerries`/`fruit`; blocks movement if tree/rock (simulation/world/obstacles.ts:9-15); can be lifted if tree/shrub (hand/grab-target.ts:22); quarried rock `wear`; `form` and `state` enums |
| **Monuments** | `Monument` records (world/monuments.ts) + pieces stored as plants; damage written into the piece's `seed` (simulation/world/monument-damage.ts:219-247) | generation position | only `monumentConditions[position]` (world-state.ts:187-189, 292) | `InitialWorld.monuments`; damage arrives through the plant patch | `MONUMENT_GROUND` sentinel in `occupancy`, which doesn't record which monument (world-state.ts:35, 210-214) | blocks movement (:378-384), drowns (monument-damage.ts:320-341), ruined by quakes and blasts; never burns |
| **People** | `Person` objects + `Mover` (society/person.ts:46-73; agents/movement.ts:28-49) in an array and `Map` (society/society.ts:137-141) | shared | structuredClone; job dropped, route reset (society.ts:74-83) | packed F32, stride 17, sent in full every frame (world/agent-buffers.ts:1-21; frame-builder.ts:55-58) | **none**: linear `livingWithin`/`nearestPerson` (society.ts:406-440) | health/hunger/warmth/energy, carrying, weapon, radius; hurt by fire under them (society/needs.ts:90-100); "fire" is the leftover death cause (:115-125) |
| **Animals** | `Animal` objects (fauna/fauna.ts:55-77) + `Map` | shared | structuredClone | stride 12, full | **none**: linear (fauna.ts:294-314) | from `ANIMALS` (content/animals.ts:19-40): bodyRadius, food, health, isSmallGame; fire damage (fauna.ts:603-620) |
| **Herds** | `Herd` with `memberIds` (fauna.ts:79-82) | shared | yes | only as `HerdId` per animal | none | group aggregate |
| **Buildings** | `Building` objects (society/buildings.ts:24-43) + `Map` | shared | structuredClone (:132-134) | `BuildingView[]`, full every frame (frame-builder.ts:39-41) | `occupancy` I32 cell→id (:168-170) + `ObstacleMap` `Map`, scanned linearly (obstacles.ts:36-64); `damageArea`/`blowOut` linear (:257-276) | health 40–200; `burningSeconds` is its own timer, separate from the cell fire field; flammable = burnTime>0 (content/buildings.ts:246); catches fire when cell fire >0.15 (:317-327); doused by cell wetness (:328-335) |
| **Crossings** (ford/log) | readonly records (world/crossings.ts:19-39) | generation | full clone (world-state.ts:229); rebuilt by hydrology (water-recomputation.ts:141-160) | initial + `WaterUpdate` | `CrossingIndex` `Map<cell,Crossing[]>` (crossings.ts:202-205) + `CROSSING_GROUND` | walkable footing; **no power, fire or lava touches them** |
| **Deposits** | `Deposit` (world/deposits.ts:3-9) | array position (generation/deposits.ts:194) | not saved (regenerated), never deplete | not sent; visible only as ore ground | none; linear (camp-plan.ts:170, prospecting.ts:46) | resource, technology |
| **Water features** (lakes, rivers, springs) | `WaterFeatures` | ids | full clone (world-state.ts:257) | initial + `WaterUpdate` | `SPRING_GROUND` sentinel | — |
| **Volcanoes + lava tongues** | `Volcano` holding `lava: Map<cell,heat>` and `tongues` (powers/volcanoes.ts:54-71) | **none** | optional `volcanoes?` (simulation.ts:92, 321) | `VolcanoView[]` every frame + merged `LavaView` (frame.ts:34-37) | per-volcano `Map`; lava is **not a cell field** | hot, quenched by water (:441-451), kills through its own loops (:395-411) |
| **Tornadoes** | `{age,path,radius,strength}` (tornadoes.ts:35-40) | none | **blocks saving**: `isBusy` makes `snapshot()` return null (simulation.ts:201-209, 271-274) | one-shot `tornado` effect carrying the full path (tornadoes.ts:215) | none | — |
| **Meteors / scheduled tasks** | closures `{remainingSeconds, run}` (simulation.ts:113-116, 561), counted in **real seconds** (:509) | none | blocks saving | `meteor` effect | none | — |
| **Embers / bombs** | `Ember[]` (nature/embers.ts:9-17) | none | yes | one-shot `ember` effect (:109-119) | none | glowing ones ignite where they land (simulation.ts:759-769) |
| **Arrows** | `ArrowFlight` holding `Person` refs (rivalry/arrows.ts:18-26) | none | **silently dropped** on restore (rivalry-system.ts:143) | `arrow` effect | none | damage, isHit |
| **Splashes** | `Mover.splash` → effect (simulation.ts:820-837) | none | no | effect | none | — |
| **Held item** | `Simulation.#grab` + `heldId` in society and fauna (society.ts:140; fauna.ts:389); a lifted plant is unlinked from its cell | target id | blocks saving | `held: HeldView` | — | kinds animal\|person\|plant (grab-target.ts:4) |
| **Hazards** | `DangerZone[]` (agents/hazards.ts:13-18) | none | yes | not sent | none; linear check + scan of the fire field (:56-123) | radius, time left |
| **Tribes** | `Tribe` (society/tribe.ts:66-95) with Sets/Maps, fields per cell, plots (`PlotSpot.plant` = plant slot), stock | shared | structuredClone; technologies as raw strings | `TribeSummary[]` every frame | camp x/z | — |
| **Cell fields** | 12 terrain layers (world/terrain-data.ts:2-13); 8 surface fields (world-state.ts:58-67) + canopyFuel, initialCanopyFuel, cropCodes, disturbedDay, `occupancy` (building id **or** 4 negative sentinels, :34-38), CellSets | cell | 6 terrain layers stored sparse against the generated island; 5 sparse + 2 dense fields (:47-56); **biome neither saved nor ever changed** | 4-byte surface rows and 4-byte ground rows (agent-buffers.ts:59-75), height/water patches, burning cells | the grid itself | fuel, fire, heat, wetness, snow, scorch, trodden, crop |

## Gaps that prevent a uniform "thing with properties" model

1. **Five storage models and four id schemes.** The storage models are SoA, objects plus `Map`, closure lists, a `Map` inside an object, and readonly generated records. The id schemes are reused slots, the shared counter, array position, and no id at all. Plant slots have no generation counter, so they can suffer ABA reuse. Example: `PlotSpot.plant` checks only `isAlive` (plots.ts:188), so it can follow a different plant that took over the slot. `hashToUnit` is also seeded with the slot number (monument-damage.ts:232, tornadoes.ts:177), so outcomes depend on the order slots were handed out.
2. **Categories are overloaded.** Rocks and monument pieces are "plants". `clearCell` needs special cases for them (vegetation-store.ts:345-350), and monument damage lives in `seed`. `occupancy` mixes building ids with sentinels, and a cell can't tell which monument it belongs to.
3. **No shared spatial index for anything that moves.** 18 call sites scan people or animals linearly. The crowding hash is rebuilt every 2 ticks and then thrown away (agents/crowding.ts:36-37). Buildings, hazards and volcanoes are scanned linearly too. Lava isn't on the grid, so asking "is there lava here?" means looping over every volcano.
4. **Properties are scattered and duplicated.**
   - Flammability is implemented four ways: ground `fuel`, per-species `canopyFuel` summed per cell, building `burnTime` + `burningSeconds`, and fire damage to people and animals with different thresholds.
   - Wetness exists only on cells.
   - Health uses four scales: person 0–1, animal definition, building 40–200, monument damage level.
   - There is no mass: a tornado swirls a mammoth exactly like a hare (tornadoes.ts:124-130).
   - "Edible" is split across `givesBerries`/`fruit`, `ANIMALS.food`, `isFishingWater` and crops.
   - Kind checks are hand-written: 34 `isTree/Shrub/Rock/MonumentSpecies` calls, and 19 files index `vegetation.*[]` directly.
5. **Effects are written per pair, and their coverage is uneven.** Every hazard calls `buildings`/`people`/`fauna.damageArea` separately: 14 call sites in catastrophes, tornadoes and volcanoes. As a result:
   - an earthquake only scares animals and never hurts them (catastrophes.ts:380-382);
   - lightning doesn't touch buildings directly;
   - nothing touches crossings or deposits;
   - lava ignores monuments.

   `Foe` wraps person and animal again by hand (rivalry/foes.ts:15-17).
6. **Saving is inconsistent.**
   - Tornadoes, meteors and grabs block saving.
   - Arrows and jobs are dropped without notice.
   - Vegetation is saved dense even though loading regenerates the island.
   - `OLDER_SAVE_PLANT_SPECIES` is exactly the kind of index-remap table the owner rejects.
   - Technologies are saved as raw strings, and monument conditions are keyed by array position.
7. **Frames use four shapes.** People and animals go as packed strides; buildings, tribes and volcanoes as object lists; plants and cells as patches; tornadoes, embers, arrows and meteors as one-shot effects. One-shot effects can't be rebuilt after a reload or for a late joiner. Hazards and deposits are never sent.
8. **Selection covers only animal, building, person, tribe and cell** (commands.ts:35-47). Plants show up only inside cell inspection; volcanoes, tornadoes, monuments and crossings can't be selected. `inspectCell` (inspection.ts:209-236) comes closest to a context query, but it reports the static biome even under basalt lava.

**Minimum a uniform model needs:**
- a stable handle (kind, index, generation);
- a per-kind declared property table: fuel/flammable, health scale, mass, blocks, edible, liftable, wet;
- one spatial index per cell over movers and static things;
- lava and hazards as cell fields;
- a kind registry that drives saving, frames, picking and inspection.
