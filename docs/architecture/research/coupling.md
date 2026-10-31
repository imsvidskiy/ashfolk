# Simulation coupling map

Paths are relative to `$R/src/simulation`. Classes: **P** property + rule reaction, **Q** context query, **E** emitted event, **D** stays a direct call.

## 1–2. Couplings

| From → to | Evidence | Class |
|---|---|---|
| rain power → `fire.douse`, writes wetness | powers/element-powers.ts:90-91 | P (fire already damps by wetness, nature/fire.ts:222) |
| snow power → `fire.douse`, writes snow | element-powers.ts:116-117 | P |
| fire power → `fire.ignite` | element-powers.ts:45 | P (heat/ignite write) |
| tornado `blowOut` → `fire.douse` per cell, `buildings.blowOut` | powers/tornadoes.ts:162-170; society/buildings.ts:267 | P (gust property) |
| tornado `uproot` → tree/shrub branch, `fellPlant`/`removePlant`, `markDisturbed` | tornadoes.ts:139-160 | P (plant form property) |
| tornado → people/fauna `livingWithin`, `whirl`, `damageArea`, `scare`, `hazards.addZone` | tornadoes.ts:114-137 | Q + E (impact) |
| tornado path reads wind, island | tornadoes.ts:58-112 | Q |
| lightning → `fire.ignite` after own rain check (wetness + precipitation) | powers/catastrophes.ts:69-105 | P (duplicates fire's dampness) |
| lightning → scorch write, `setAlight` on buildings in radius | catastrophes.ts:74, 82-86 | P |
| lightning → `people.nearestTribe` → `discover(fire)` | catastrophes.ts:107-115 | E + Q |
| wildfire near camp → `discover(fire)` | society/tribe-life.ts:86; agents/hazards.ts:66 | E (same fact, second code path) |
| explosion/meteor → crater, `vaporize` raw field writes, `flatten`, `shatter`, `igniteDebris`, `embers.hurl`, monuments → chronicle, damage/scare/zone | catastrophes.ts:151-363 | P (cells, plants), D (crater, spawn), Q + E (impact) |
| meteor → `services.schedule` (real seconds) | element-powers.ts:164 | D, must be tick-based |
| earthquake → `shakeTerrain`, `toppleTrees`, monuments, damage | catastrophes.ts:365-405 | D + P + Q/E |
| volcano swell → `buildings.damageArea`, topple trees | powers/volcanoes.ts:114-148 | Q/E + P |
| ash fall → `setGround(Ash)`, fuel 0, scorch | volcanoes.ts:169-195 | P (fuel already derives from ground, world/world-state.ts:434) |
| lava `cover` → `clearPlants`, basalt, wetness 0, `fire.addHeat` on neighbours, damage to buildings/people/animals | volcanoes.ts:333-359 | P (lava is a heat source) |
| lava quench at water → `fire.douse(head)` | volcanoes.ts:292-296 | P |
| lava under new water deleted; hot lava kills; hazard zones | volcanoes.ts:441-451, 395-439 | P + E |
| volcano → `embers.hurl`; `world.recovering.retain` | volcanoes.ts:361-380, 275 | D |
| fire → `vegetation.burnTreesInCell`, ground def, temperature | nature/fire.ts:246, 273, 216, 373 | D (inside nature) |
| fire → ember cells → `embers.launch` | fire.ts:325-335 → simulation.ts:746-748 | E (spawn) |
| ember lands → `fire.ignite`/`addHeat` | simulation.ts:759-769 | P (ember carries heat) |
| buildings: catch fire from cell, burn heats own + neighbour cell, doused by wetness/precip, campfire escape, scorch | buildings.ts:317-374 (`fire: FireSystem` in tick, :74) | P |
| buildings incidents → chronicle via Simulation; losses → society | simulation.ts:839-851; society/society.ts:525 | E |
| hazards wraps `FireSystem`, scans fire grid | agents/hazards.ts:21, 79-123 | Q |
| people burn underfoot; plant search skips hot cells; flee reads fire/heat/scorch; `dangerNear` | society/needs.ts:87-101; society/resources.ts:84; society/jobs/flee-job.ts:101-147; society/decisions.ts:174 | P + Q |
| camps read burning, biome, slope, scorch | society/camp-sites.ts:99-103, 210-245; society/settlement.ts:83 | Q |
| society reads/writes vegetation: fruit, chop, quarry wear, plots, fields, trodden | jobs/gather-job.ts:108-112; jobs/chop-job.ts:75; jobs/quarry-job.ts:92; plots.ts:248; farming.ts:142; trodden-ground.ts:149 | D (via world API) + Q |
| hunt → `fauna.nearestAnimal/provoke/kill` | jobs/hunt-job.ts:71-163 | Q + D |
| warmth reads campfire/hearths | society/warmth.ts:64-108 | Q |
| fauna threats: closures over hazards, `society.nearestPerson` (hunt job), `rivalry.senses` | simulation.ts:590-610; fauna/fauna.ts:91 | Q |
| fauna burns on fire cell; habitat avoids burning, picks biome | fauna.ts:602-620; fauna/habitat.ts:52-110 | P + Q |
| beasts wound people via rivalry `BeastEncounters` → `people.kill` + chronicle | society/rivalry/beast-encounters.ts:87-193; fauna/beast-instincts.ts:637 | D + E |
| rivalry → `fauna.wound/menaceNear/isMenacing` | rivalry/strikes.ts:97; rivalry/responses.ts:72; rivalry/defense-jobs.ts:163 | Q + D |
| hand → people/fauna hold/setDown, plant lift/return | hand/grab-handlers.ts:17-190 | D (per-kind registry) |
| weather → lightning count → strike near `viewFocus` | nature/weather.ts:152; simulation.ts:722-737 | E, site must be deterministic Q |
| weather → surface wetness/snow; wind → `fire.setWind` | nature/surface.ts:320-372; simulation.ts:742 | P / Q |
| height edit → water recompute (imports generation hydrology) → navigation rebuild, drown buildings and monuments | world/water-recomputation.ts:1-3, 97; simulation.ts:663-703 | E + P |
| movers' `splash` flag polled → effects | simulation.ts:820-837 | E |
| crowding over people + animals | simulation.ts:802-818 | Q |
| frame reads every system; `volcanoes.views(services)` | frame-builder.ts:31-71 | D (projection) |

Repeated patterns: 14 `damageArea`, 5 `scare`, 6 `addZone`, 13 `effects.add`, 28 `chronicle.record`, 17 `cellsInArea` loops, 13 `isTreeSpecies/isShrubSpecies` branches, 40 raw `fields.x[cell] =` writes in 8 files, 16 `markSurfaceCell`, 9 `markDisturbed`. "Thing on a burning or lava cell takes harm" exists 3 times (needs.ts:87, fauna.ts:602, volcanoes.ts:401-411).

## Bag members (PowerServices ⊃ SocietyContext)

`society/society-context.ts:23-38`, `powers/power-handler.ts:14-19`, built at simulation.ts:565-588 and **mutated every tick** (`environment` :539, `rules` :467). Files using each member: world 32, environment 31, random 25, buildings 24, people 21, rules 20, chronicle 12, fauna 8 (powers, hunt, rivalry, hand), navigation 7, hazards 6, effects 6, rivalry 6 (only inside `rivalry/`), fire 4 (tornadoes, catastrophes, volcanoes, element-powers), embers 2 (volcanoes, catastrophes), identifiers 1 (tribe-life), schedule/tornadoes/volcanoes 1 (element-powers). Grab handlers take the full bag. Most users need 3–5 members.

## 3. Simulation god-object responsibilities (simulation.ts)

1. Composition root for ~20 systems with ad hoc constructor deps (164-187).
2. Builds and mutates the services bag (565-588, 467, 539).
3. Fauna threat adapters across hazards, society, rivalry (590-610).
4. Starting population: spots, tribe count/size, herd densities (49-67, 245-269, 612-623).
5. Snapshot/restore of 23 fields plus busy gating (72-96, 201-209, 271-336).
6. Command parse/dispatch; handlers also poke calendar and weather directly (338-346; command-handlers.ts:31-66).
7. Powers: parameter parsing, one-shot use, brush strokes on real seconds, refusals → notices (348-391, 625-641).
8. Hand grab state machine (393-456).
9. Interface state: pause, speed, selection, view focus, notices (458-494).
10. Clock: real → game seconds, backlog, 40-tick cap (504-529).
11. Real-second task scheduler (561-563, 643-661).
12. Step order (531-547, 739-800).
13. Natural lightning placement (705-737).
14. Ember launch/landing glue (746-769).
15. Water recomputation and its consequences; water frame update (496-502, 663-703).
16. Navigation rebuild cadence (544-546).
17. Crowding, splashes, building-incident and weather chronicle texts (118-126, 712-720, 802-851).
18. Frame building via `FrameBuilder(this)` reading internals (185, 522, 549).
19. Rules get/set (225-227, 466-468).

## 4. Implications for the target design

1. **Cell property layer with a write API.** Typed channels (fire, heat, wetness, snow, scorch, fuel, crop, trodden, plus new lava, gust, danger) whose setters do change tracking, replacing 40 raw writes and 25 manual `mark*` calls. Rain, snow and tornado then only write wetness/snow/gust; fire's own rule quenches. Already proven in code: natural rain (surface.ts → fire.ts:222) and lava ignition (heat, volcanoes.ts:352).
2. **One impact resolver.** `impact({ area, harm by target kind, cause, fright, dangerSeconds, ignites })` replaces damage/scare/zone/effect quartets in five hazards. Thing kinds declare `damageable`, `flammable`, `frightened`, `heatResistance`. One "standing on hot cell" rule replaces three copies.
3. **Plant response by species properties** (form, fellable, uprootable, shatters) through `disturbPlants(cell, force, cause)`, removing 13 category branches.
4. **One context query API with a spatial index.** People, animal and building queries are linear scans today (society.ts:394-450, fauna.ts:310-330, buildings.ts:257); `HazardMap` scans the fire grid. A bucketed index (rebuilt per tick) plus cell sampling (biome, ground, water, fire, heat, wetness, slope, height, temperature) and environment (season, weather, wind) gives the tornado `query.at(x, z).biome`, `query.plants(area, { form: "tree" })`, `query.burning(area)`. `inspection.ts:221-231` already assembles a cell context and can become its first client.
5. **Small deterministic event queue**, drained at fixed phases: `lightningStruck`, `fireSeen`, `buildingIgnited`, `buildingLost`, `waterChanged`, `creatureKilled`, `emberLanded`, `splash`. Chronicle, discovery, effects and sound subscribe; Simulation glue (items 13–17) and the duplicate fire-teaching path go. This challenges plan.md's "no event bus": a typed, ordered, per-tick queue stays deterministic and replayable.
6. **Narrow capabilities instead of the bag:** `query`, `cells`, `things` (spawn/harm), `emit`, `random` (one stream per system), `rules`, `clock`, tick-based `schedule`. Powers get only what their handler declares.
7. **Systems as registered modules** `{ id, phase, save/restore, step, project, commands }`. Snapshot fields, frame fields and transfer buffers (workers/simulation-worker-api.ts:56-91) are derived from the registry. Order stays an explicit phase list. Simulation becomes clock + scheduler + registry.
8. **Determinism fixes surfaced here:** strokes, tasks (meteor) and water recomputation run on real seconds (simulation.ts:507-509); lightning is placed around `viewFocus` (728); one shared `RandomSource` for every system (166) makes draw order cross-system coupled.
9. **Move hydrology into a shared world library.** The runtime imports `generation/hydrology` (water-recomputation.ts:1-3).
10. **Grabbable as a thing property** with a per-kind handler registered beside the kind.
11. **Projections owned by modules:** today `volcanoes.views(services)` (frame-builder.ts:67) needs the full bag.
