# Determinism and saves audit (for lockstep, replays, generator-proof saves)

Paths are relative to `$R/src`. Counts exclude tests and `testing/`.

## Findings

**RNG.** `pure-rand` 8.4.2 xoroshiro128plus uses only int32 operations, so it is exact across engines. Seeding is weak: `(-1, ~seed, seed|0, 0)` with 4 warm-up draws (random.ts:4,74-81). `derive` draws from its parent (random.ts:67-71), so the chains in relief.ts:268-272 and island-layout.ts:618-619 depend on order.
- Simulation root: `createRandom(seed*5+17)` (simulation.ts:166). It is shared through `services.random` (578) and passed to weather, fire, embers, growth, buildings and fauna (706-800). About 100 draw sites use it, including visual-only durations (catastrophes.ts:326, volcanoes.ts:373). A power use shifts every later nature draw.
- Own saved streams: fauna (fauna.ts:154,156,171), rivalry (rivalry-system.ts:122), succession (succession.ts:136). A missing key makes `restore(undefined)` throw.
- Generation has 17 `createRandom(seed*K+C)` streams. `seed*19+7` is used twice (wetlands.ts:365, rock-strength.ts:12), so both get the same noise. Seeds are adjacent at vegetation.ts:134-135.
- `hashToUnit` is a `Math.sin` hash (math.ts:51). succession.ts:99-114 passes no seed and no tick, so regrowth is identical in every world. island-layout.ts:621 takes `sin` of about 1.3e8, where range reduction differs by engine.

**Non-exact math** (`hashToUnit` / sin·cos·atan2·exp·log·tanh·hypot / `**`): shared 1 (definition) / 22 (astronomy, used by the simulation's environment) / 0; content 0/1/0; world 2/17/2; generation 12/83/8; simulation 29/207/3. That is about 387 engine sites; `Math.hypot` is 148 of them. Rendering-only code can stay: models 9/188/24, rendering 71/124/14, game 1/26. ECMA-262 makes `Math.sqrt` and `fround` exact, while `hypot`, `sin`, `exp` and `pow` are "implementation-approximated" ([spec](https://tc39.es/ecma262/#sec-function-properties-of-the-math-object)). simplex-noise 4.0.3 uses only `floor` and `sqrt`. `Math.random` appears only in audio, camera shake, rendering effects and the default seed (features/new-world/seeds.ts:4).

**Real time and the camera.** No engine folder reads the wall clock. `advance(realSeconds)` runs three things on real seconds, before the ticks and even while paused (simulation.ts:496-515): water quiet time and filling (water-recomputation.ts:96-112), strokes, and scheduled tasks such as the meteor fall (element-powers.ts:164). Navigation rebuilds outside a tick (683-690). Commands carry no tick stamp (workers/simulation-worker-api.ts:137-141). The camera reaches the simulation through `setViewFocus` (game/game-engine.ts:393): natural lightning lands around the view (simulation.ts:728, catastrophes.ts:117-130), and weather entries take its position (717). `viewFocus`, `tickBacklog`, `isPaused` and `speed` are saved (286-295).

**Saves.**
- The container (saved-world.ts:120-129) has `version: z.literal(1)` and a name table only for plants, plus a frozen `OLDER_SAVE_PLANT_SPECIES` (22-55). The version and the fingerprint were each bumped and reverted within a day (b1529d2/0675c98, 84cdfdf/5d9d385).
- The 19 `z.looseObject` schemas sit inside `z.custom`, which throws the parsed output away (116-118). No defaults apply, so they are written by hand (simulation.ts:322).
- Not saved: jobs (society.ts:75; raids get special code, 8d94701), paths (agents/movement.ts:95-106), `claimedPlants` (society.ts:86), tornadoes, tasks, strokes and grabs. `snapshot()` returns `null` while any of these is busy (simulation.ts:272).
- Only 6 terrain layers are saved, as diffs against a regenerated island (world-state.ts:48-55,262-269). Biome, moisture, dryness, variation, woodland, coastDistance, deposits, monuments and springs are regenerated. Runtime hydrology reads dryness and coastDistance (water-recomputation.ts:122-127).
- Raw indices without names: ground, plant `state`, `cropCodes`, and monuments by position (world-state.ts:300-302). String ids such as buildings and technologies have no fallback, so a rename throws.
- Saved dense: snow and wetness, and the vegetation store including derived links (world/vegetation-store.ts:433-451).
- The chronicle saves English `text` (chronicle.ts:29).
- Maps, Sets and typed arrays (saved-world.ts:95,100) work in IndexedDB only.
- CI installs only Bun (ci.yml:29). The Node version that runs tests is not pinned.

## Requirements and changes

### 1. Command-only simulation with a per-tick hash
- The simulation exposes only `step(commands)`, with each command stamped `{tick, player, command}`. A scheduler outside it owns speed, pause, the backlog and the 40-tick cap. The inspector becomes a query.
- Delete `setViewFocus`. Lightning picks a seeded site over high or forested land.
- Strokes and grabs: the main thread sends sampled `strokeStep {x, z, milliseconds: int}` commands, which the next step applies. A paused step applies commands without running nature, so brushes still work while paused and replays are exact.
- Tasks become data, `{dueTick, kind, params}`; so do tornadoes. Water filling counts ticks.
- Add a `StateHasher` (`u32` words, and typed arrays read through `Uint32Array` views).
  - Every tick, digest the tick, RNG states, entities and active cell sets.
  - Digest whole fields every 10 ticks. Hashing 10 Float32 fields at 640² took 5.6 ms in Node 24 (my benchmark), about 0.9 s per second at speed 16.
  - Per-section digests show which module desynced.
- A replay is a start save, the command log and the digests. Test that "save, load, run N ticks" equals "run N ticks".

### 2. Determinism across engines
- Add `shared/exact-math.ts`: sin, cos, atan2, exp, log, tanh and pow, built only from `+ − × ÷`, `floor`, `sqrt` and `fround`.
- Replace the 148 `hypot` calls with `Math.sqrt(dx*dx+dz*dz)` or squared-distance comparisons. Enforce this with a Biome GritQL plugin or a CI grep over the engine folders.
- Add an integer `unitHash(seed, tick, cell, salt)` (`Math.imul` + `fmix32`) for the 43 `hashToUnit` sites.
- Named streams: `stream(worldSeed, "fauna.instincts")`, seeded through splitmix32 into `xoroshiro128plusFromState`, with no parent draws. Save a `randomStreams` map and re-derive missing entries from the seed. Visual-only draws use an unhashed `effects` stream.
- Fix the colliding generation seeds only after step 5.
- CI: Chromium, Firefox, WebKit (Vitest browser instances) and Node replay one golden scenario and compare hashes.
- The lockstep handshake compares the build id, a catalog hash and the mod list.

### 3. Self-describing saves, no per-version migrations
- Add `names: Record<catalog, string[]>` for every catalog saved by index (ground, plant species, plant state, crop, biome, monument damage). Each catalog declares a policy for unknown names, `fallback` or `drop`, and string catalogs use the same policy.
- The legacy default orders stay frozen and are never extended.
- Section schemas give every field `.default()` or `.catch()`, use `z.looseObject`, and the loader keeps the parsed result. Drop the version gate on content.
- Typed arrays carry a descriptor: `{kind, encoding: sparse|dense, baseline: zero|base|rule}`.
- The chronicle saves a message id plus parameters, which also allows localization.
- A portable codec for cloud and network: `cbor-x` with `CompressionStream`.

### 4. Module-owned save sections
- `SaveSection<T> {key, schema, write, read, reset, digest, names?, after?}`, registered by each module, keeping today's top-level keys. A test checks that keys are unique.
- Restore order: base world, then derived water and navigation, then sections in registry order, then each `after`.
- Jobs: a `JobType {kind, schema, update(data, tick)}` registry, with `person.job` saved as `{kind, data}`. An unknown kind becomes `null`, and the raid-only special case goes away. Tasks, tornadoes and strokes become data too, so `snapshot()` never returns `null`.
- Speed, pause and camera go into a session section that the digest skips. Monuments are keyed by id. Derived links are not saved.

### 5. Saves independent of generator changes
- At creation, write a `WorldBase`: all 12 terrain layers, water, springs, crossings, monuments, deposits and the fingerprint. Store it once per world in its own IndexedDB store. Saves reference `{baseId, baseHash}` and diff against it.
- Size: 16.0 MB raw at 640² and 23 MB at 768². Shrink it with byte-plane shuffling and `CompressionStream("gzip")`.
- Old saves: regenerate and compare the fingerprint. On a match, write and attach the base. On a mismatch, show the land-changed dialog as today.
- After that, generator work (stream fixes, terrain realism v2) no longer threatens saves. Keep a `generatorVersion` for shared seeds.

### Conflicts with plan.md
- plan.md:141-143 keeps strokes and water settling on real time, which breaks replays and lockstep.
- plan.md:145 limits determinism to V8, but the roadmap needs Firefox and WebKit as well.
- plan.md:101 defers base layers to "long term". Store them before any change to generation hashes.
