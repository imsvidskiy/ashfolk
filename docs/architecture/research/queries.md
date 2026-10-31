# Context queries: inventory and requirements (paths under `$R/src`)

## 1. Primitives today

- **Grid** (`world/world-grid.ts`): `cellAt` :91, `circleBounds` :163, `cellsInRadius` :174 (fresh `number[]`), DDA rays `cellsAlong`/`someCellAlong`/`traceAlong` :127-160. `NEIGHBOR_OFFSETS`/`ORTHOGONAL_STEPS` are looped by hand in 19 files.
- **Three disc iterators that disagree**: `grid.cellsInRadius` (cell center inside, 29 calls), `cellsInArea` (`simulation/world/terrain-editing.ts:49`, one `AreaCell` object per cell with `Math.hypot`, 17 calls in powers), `cellsNear` (`simulation/society/footprints.ts:12`, nearest point plus slack). Plus hand-rolled square loops: `agents/hazards.ts:95`, `society/resources.ts:66` (rings), `society/camp-sites.ts:159` (step 2), `nature/succession.ts:234`, `fauna/habitat.ts:48`, `world/terrain-editing.ts:338`, `rendering/water/lily-placement.ts:56`, `rendering/terrain/ground-albedo.ts:117`, `world/brooks.ts:41`, and generation (`erosion.ts:73`, `climate.ts:298`, `valleys.ts:82`, `river-spacing.ts:283`).
- **Point façades**: `WorldState` (`simulation/world/world-state.ts:304-416`) has `heightAt, surfaceAt, isWater, touchesWater, isWaterAt, waterDepth, slope, isOpenGround, canPlace, canGrowWild, isTrodden, temperature, isWalkable, isPool, isBrook, isObstructed, isObstructedBetween, crossingAt, isBurning`. It has no biome, ground, fire-near or plants-near accessor. `game/world-mirror.ts:208-230` repeats `heightAt/surfaceAt/isWaterAt/isBrookAt/crossingAt` for the main thread. The GPU repeats them as `cellAtNode`/`sampleHeightNode` (`rendering/terrain/height-sampling.ts:24,34`).
- **Links from a cell to things**: plants use the linked list `firstPlantInCell/nextPlantInCell` (`world/vegetation-store.ts:298`). `plantsInCell` :306 allocates, and the store also has `hasTreeWithin` :355, `countTreesInCell` :384 and `canopyFuelInCell` :320. `world.canopyFuel` is an incrementally kept per-cell aggregate. `occupancy: Int32Array` mixes building ids with the sentinels −2 monument, −3 spring, −4 plot and −5 crossing (`world-state.ts:34-38`).
- **No spatial index for agents.** People and animals are found by linear scans: `society.livingWithin` :406 (filters into a new array), `nearestPerson` :424, `nearestTribe` :447, `fauna.nearestAnimal` :294, `fauna.livingWithin` :310 and `#nearestPredator` :655. Buildings are scanned linearly too, in `damageArea` :257 and `blowOut` :267, even though `occupancy` exists. The only grid is `keepApart`'s `Map<cell, Mover[]>`, rebuilt every crowding pass and then discarded (`agents/crowding.ts:37`). `Obstacles.near` (`simulation/world/obstacles.ts:58`) scans every building and allocates, and each mover calls it on every step (`agents/movement.ts:406`).

## 2. Inventory by question

| Question | Sites | Notes |
|---|---|---|
| **Biome** | raw `terrain.biome[cell]`: `camp-sites.ts:103,210,235,244`, `plots.ts:88`, `vegetation-growth.ts:131,171`, `succession.ts:75`, `habitat.ts:52,62,110`, `land-powers.ts:155`, `rivalry/places.ts:61`, `terrain-editing.ts:137`, `inspection.ts:221`, `audio/ambience.ts:91`, `rendering/water/lily-placement.ts:60`, `spring-view.ts:47` | Only the inspector maps water cells to `Biome.Water` (`inspection.ts:221`). Biome groups are ad hoc and conflict: `WOODED_BIOMES` in `content/biomes.ts:17` is {Forest, Taiga}, but `rendering/water/spring-view.ts:35` defines it as {Forest, Swamp, …}. There are also `ROCKY_BIOMES` (`camp-sites.ts:30`), `SHORE_BIOMES` and `LAND_GROUPS` (`audio/ambience.ts:20`). |
| **Temperature** | `world.temperature(cell, offset)`: `warmth.ts:51`, `fire.ts:373`, `inspection.ts:229`. The same formula is written inline in `surface.ts:88,123,337`. | The base value alone, without season or weather, is used in `camp-sites.ts:245`, `succession.ts:83`, `plots.ts:94`, `vegetation-growth.ts:137` and `land-powers.ts:185`. The main thread computes "snowing at the view focus" twice: `audio/ambience.ts:120-127` and `rendering/world-renderer.ts:461-463`. |
| **Plants near** | `nearestPlant` (`resources.ts:34`, allocates an array per ring and has its own fire, heat and water skips), `hasTreeWithin` (`vegetation-growth.ts:161`, `succession.ts:205`, `generation/vegetation.ts:142`), `#hasSeedTreeNear` (`succession.ts:229`, a square with an age filter), `countSurroundings` (`camp-sites.ts:208`, counts berries, trees and marsh), `ripenBushes` (`life-powers.ts:67`) | `plantsInCell(cell).filter(...)` runs inside disc loops at `tornadoes.ts:148`, `volcanoes.ts:138,182` and `catastrophes.ts:248,397`. "Species for this place" is duplicated: `regrowingSpecies(biome, temp)` in `plots.ts:94` and `vegetation-growth.ts:137`, `PLANTING_RULES` in `succession.ts:89`. On the main thread, picking uses rendering's `vegetation-chunks.ts:169 plantsNear` through `game-engine.ts:434`, so the game layer depends on rendering. |
| **Fire / heat near** | `HazardMap.dangerNear` (`hazards.ts:56`: zones first, then a square scan for a weighted centroid, skipped when `burningCount === 0`), `isFireAround` :67 (24 probe points on 3 rings, can miss fire), `fauna #sufferFire` :602 (own cell only), `buildings #catchWildfire` | `warmth.ts` ignores the `heat` and `fire` fields: only the tribe's own campfire and hearths warm a person, so standing beside lava or a wildfire does not. `rendering/effects/fire-view.ts:142` sorts every burning cell each frame. |
| **Water near** | `waterScore` (`camp-sites.ts:110`: 16 probes plus `cellsInRadius().some`), `describeWaterNearby` (`places.ts:24`), `nearestShore` (`resources.ts:149`: 40 **random** probes, so it uses up RNG draws and is not actually the nearest), `nearestSpotWhere` (`walkable-ground.ts:38`) | Water predicates multiply: `isWater`, `isWaterAt`, `touchesWater`, `isPool`, `isBrook`, `isDryFooting` (`walkable-ground.ts:18`), `isDryLand` (`navigation.ts:21`), `isInOpenWater` (`hops.ts:39`), `isDryWay` (`footprints.ts:33`), `isFishingWater`. |
| **Nearest agent / tribe / building** | `life-powers.ts:90,120,151`, `volcanoes.ts:401,407`, `tornadoes.ts:124,128`, `catastrophes.ts:108`, `beast-encounters.ts:100,138,247`, `engagement.ts:33` (each fighter scans everyone, O(n²)), `war-parties.ts:60`, `hunt-job.ts:71,74`, `simulation.ts:596`, `fauna.ts:166,363,648` | There are 17 `damageArea` calls, each a linear scan. The volcano's `cover()` makes 3 of them for every newly covered lava cell (`volcanoes.ts:356-358`). `Math.hypot(…campX…)` is written out 19 times. `nearestDeposit` (`camp-plan.ts:166`) is linear. `tribeBuildings`/`buildingsOfKind` allocate (13 calls). `membersOf` filters all people (19 calls). |
| **Slope / height** | `slope(cell)`: 15 calls in the simulation; `heightAt`/`surfaceAt`: 64 in rendering, 19 in game | Sampled one at a time, never cached per tick. |
| **Weather / season** | Global `Environment`, rebuilt at `simulation.ts:198,323,537,571` | Nothing is local. Fire wind is global (`fire.ts:87 setWind`), so a tornado does not fan fire. It only douses it through its own loop. |

**Tornado, per tick** (`powers/tornadoes.ts:115-170`): it walks 2 `cellsInArea` discs, runs `plantsInCell().filter` per cell, makes 5 linear agent scans (`livingWithin` ×2, `damageArea` ×2, `scare`), allocates 4 temporary arrays and makes 2 building scans. It never reads biome, fuel or tree species. **Inspector**: `inspectCell` (`simulation/inspection.ts:207`) is the only "everything about this cell" sample, so it is the natural seed for a `CellSample`.

## 3. Cost and determinism

- **Scale**: at most 10 tribes, and a tribe splits at 16 people (`settlement.ts:19-21`), so there are hundreds of agents. Single scans are cheap, but they multiply: threat checks are O(animals × people), throttled by `threatCheckSeconds` (`fauna.ts:622`), and engagement is O(fighters × people).
- **Allocation**: `cellsInRadius`, `cellsInArea`, `plantsInCell`, `livingWithin`, `ringCells`, `warmPlaces` (`warmth.ts`, per person per tick) and `Obstacles.near` all return new arrays. A 100 m disc creates about 314 `AreaCell` objects.
- **Throttles are ad hoc**: `rethinkSeconds` (`decisions.ts:54`, which draws from the shared `context.random`), `threatCheckSeconds`, and the `burningCount` early exit (`hazards.ts:80`).
- **Ties**: they are broken implicitly by array order. `nearestPerson` and `nearestAnimal` use strict `<`, and `nearestPlant` visits rings row-major. A spatial index would change the winner unless ties are broken by stable id.
- **Math**: `Math.hypot` appears 211 times in 107 files. Queries should compare squared distances with exact math for lockstep.

## 4. Requirements for one typed context-query API

1. **Shapes**: `Point(x,z)`, `Cell`, `Disc(x,z,r, membership: center|overlap|slack)`, `Ring/Annulus`, `Region` (CellRegion), `Segment/Ray` (DDA with enter/leave), `Path` (polyline from navigation), `Footprint` (building cells), `Claim` (tribe camp or territory radius).
2. **Sources**, each declared once and typed:
   - terrain layers: biome (with the water mapping), ground and its definition, height, slope, water depth and surface, river strength, coast distance, moisture
   - temperature, always including the air offset
   - fields (fire, heat, wetness, snow, scorch, fuel, crop, trodden, molten) and per-tick exposures (wind vector, soak)
   - per-cell aggregates kept incrementally like `canopyFuel`: tree count, berry count, species bitmask
   - thing indexes: plants (species, form, state), people (tribe, job, held), animals (kind, predator, small game), buildings (kind, tribe, role, burning), deposits, monuments, crossings, springs, lava, tornadoes, danger zones
   - environment: season, hour, weather, precipitation, wind
3. **Operations**:
   - `sample(cell|point, out)` fills a caller-owned `CellSample`
   - `any(shape, filter)` stops at the first match
   - `count`, `sum`, `share`, `min`, `max` and `centroid` over a shape (camp surroundings, ambience shares, the fire centroid)
   - `nearest(shape, filter)` returns the thing and its squared distance
   - `forEach(shape, visitor)` and `collect(shape, filter, Int32Array scratch)`
4. **Filters as data**: species sets and tags (`tree`, `berries`, `predator`, `heat-source`, `wooded-biome`) come from content definitions, so mods extend them and every system shares one meaning of "wooded". This removes the duplicated biome sets.
5. **Indexes**:
   - a uniform bucket grid for agents (16–32 m), updated once per tick after movement; it replaces `keepApart`'s map and the linear scans
   - building lookup through `occupancy`, with the sentinels split into their own layer
   - plants through the existing linked list plus aggregates
   - a static index for deposits, monuments and springs
6. **Per-tick consistency**: indexes carry a tick stamp. Derived caches are invalidated through the existing `heightVersion`, `waterVersion` and change trackers. Reads within one phase see one snapshot.
7. **Determinism**:
   - canonical visit order: row-major cells, with ties broken by ascending id
   - no RNG inside queries (unlike `nearestShore`)
   - squared distances and exact math
   - the same results in the worker, in replays and in tests
8. **Zero allocation**: precomputed disc offsets per radius in cells, visitor callbacks or reusable scratch buffers, out-params, and no object per cell. Held and dead agents are excluded in one place; today the `isHeld` check is repeated in 4 functions.
9. **One implementation on both threads**: pure functions over a read-only `WorldView` that `WorldState`, `WorldMirror` and the generation `TerrainData` all implement. Picking then stops depending on rendering. A parity test keeps the GPU mirrors in step.
10. **Throttling helper**: periodic per-agent queries use seeded per-agent timers, not draws from a shared stream.
11. **Introspection**: the inspector's `CellInspection` is `CellSample` plus a nearby summary.
