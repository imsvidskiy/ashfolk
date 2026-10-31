# Critiques: Data-oriented evolution

Five critics attacked [the Data-oriented evolution proposal](../proposals/evolve.md), one lens each.

| Lens | Score |
| --- | --- |
| determinism | 6 |
| performance | 6 |
| extensibility | 5 |
| migration | 4 |
| simplicity | 5 |

## Determinism — 6/10

Through the determinism and saves lens, this is the strongest proposal so far. It takes over almost all of the research: commands only, `strokeStep{ms}`, tasks stored as data, no `setViewFocus`, exact math, `unitHash`, named streams with no draws from a parent, name tables for every catalog, `WorldBase` before any generation hash change, section digests, golden cross-engine CI, and a fast-check property for save, load and N ticks. Four concrete design errors would break save, load and N ticks, replays or lockstep, though, and the migration quietly depends on per-change save translations that the owner rejects.

The four errors:
1. The base is stored *quantized*, so a loaded world is not the world that was played.
2. Structures that carry iteration order are declared derived and rebuilt on load. Plant cell links are inserted at the head, and active sets keep insertion order; today the code saves both on purpose.
3. A lazily rebuilt spatial index is shared with UI queries, so whether someone has the inspector open changes the simulation.
4. State digests are fed from render change trackers that are cleared when read.

On top of that:
- Groups 7, 9 and 10 move state: lava from per-volcano Maps into a field, people from objects into columns, monuments out of plant slots, numeric ids into packed handles. The only rules for old saves are "missing key → default" and "unknown name → fallback/drop". So either in-progress state is silently lost, or every group ships an ad hoc translator, which is a per-version migration.
- "Ship as one minor release" can't work when every merge to main deploys.
- The lockstep clock (a turn of 2 ticks, pause that freezes the tick, single-player stamping) doesn't survive speed 16 or a pause.

All of these can be fixed without changing the overall shape, so the score is 6, not lower.

### Strengths

- Takes the commands-only fix in the right form. `strokeStep { power, x, z, milliseconds }` is sampled on the main thread, so brushing still works while paused and doesn't repeat 16 times at speed 16, yet replays are exact. This resolves the conflict with plan.md:141-146 without keeping real time inside the simulation.
- Makes determinism cover every engine: exact math built from IEEE operations, an integer `unitHash` replacing the `Math.sin` hashToUnit (math.ts:51), named streams with no draws from a parent (fixing `RandomSource.derive` at random.ts:67-71), and named streams for generation too, which fixes the duplicate seed*19+7. A Grit ban starts in warn mode with an offender list.
- Removes real-time and camera inputs: `setViewFocus` goes (simulation.ts:475, 728), tasks become `{dueTick, kind, data}` (they are closures today, simulation.ts:113-116), lake filling counts ticks, and tornadoes, meteors, grabs and jobs are saved, so `snapshot()` stops returning null (simulation.ts:271).
- Saves describe themselves: name tables for every catalog stored by index, each with a fallback or drop policy; `OLDER_SAVE_PLANT_SPECIES` frozen and never extended; the loader keeps the parsed output. That fixes the `z.custom` wrapper at saved-world.ts:116-118, which throws the parsed output away.
- Orders `WorldBase` before any generation hash change, which is the only way saves survive terrain realism v2. Generation changes often: 151 commits have touched src/generation since August.
- Keeps a digest per section so a desync can be traced to one module, asserts no NaN in hashed fields, runs a golden replay in several engines plus fast-check save/load/N = N, and adds save fixtures from 0.8, 0.9 and main in group 0.
- Rejects ECS serializers that remap ids, rejects SharedArrayBuffer and COOP/COEP, has the lockstep relay order commands without simulating, and validates peer commands with zod at the boundary.

### Findings

- **high**: The WorldBase is stored quantized, so a loaded world differs from the world that was played. Save, load and N ticks no longer equals N ticks; replays and lockstep resync from base plus sections diverge; and old saves that get a base attached change terrain slightly.
  - Evidence: Proposal §9: the base 'goes into its own IndexedDB store, quantized and gzipped'. Today terrain diffs are exact (world-state.ts:220-240 uses sparseDifference over Float32 layers), and research/determinism-saves.md §5 asked for lossless byte-plane shuffling plus gzip. Runtime hydrology reads dryness and coastDistance from the base (water-recomputation.ts), so quantization errors spread into rivers and lakes. The proposal's own fast-check property would fail.
  - Fix: Store the base losslessly: shuffle Float32 byte planes, then gzip with CompressionStream. Alternatively, quantize at the end of generation so the live session runs on the dequantized base from tick 0. Compute the base hash over the exact stored bytes, and run the fast-check property through the real envelope (base plus diffs plus structured-clone serialization).
- **high**: The save format is tied to the in-memory layout, and later groups move state with no plan for old saves. Under the stated rules (missing key → default or rest, unknown name → fallback or drop), in-progress state in old saves is silently lost. The alternative is an ad hoc translator in each group, which is the per-version migration the owner rejects.
  - Evidence: Group 7 moves lava from `Volcano.lava: Map<number, number>` (volcanoes.ts:65, one Map per volcano, saved under `volcanoes`) into a field. Group 9 moves `society.people[]` objects with `mover` and `fauna.animals[]` into columns, moves monuments out of the plant store, and replaces monotonic ids (`identifiers.upcoming`, raids' `personId` in the saved-world.ts schema) with packed ThingIds. Group 10 turns `hazards: DangerZone[]` into a field. Monument pieces live in old saves as plant species Menhir, Dolmen, Idol, Pillar and Arch (saved-world.ts:22-55). Once they stop being plant species, `restoreSavedWorld` maps them to Boulder and then removes them (saved-world.ts:181-191). `formerNames` only resolves a rename within one catalog, not a kind that moves from plantSpecies to monuments. The migration table marks groups 9 and 10 as 'S' but gives no mechanism.
  - Fix: In group 4, design the logical save schema once, ahead of the memory refactors: things as records keyed by one kind namespace, with a persistent id and an optional slot; cell fields by name, with lava as a field from day one; jobs and transients as records. Write one frozen reader that maps the SAVE_VERSION=1 snapshot shape into it, and never extend that reader. Groups 7, 9 and 10 then change only memory-side code and section readers. Use one namespace with stable ids, kept separate from display names, so moving a kind between stores never changes its saved identity.
- **high**: Structures that carry iteration order are declared derived and rebuilt on load. Iteration order after a load then differs from before the save, which breaks save/load/N, replays and desync recovery: a resynced peer diverges again at once. It also contradicts the proposal's own 'ascending slot order' guarantee.
  - Evidence: Proposal §9: 'Not saved: derived links, buckets and block counts; they are rebuilt on load.' Plants are linked into their cell at the head of the list (vegetation-store.ts:651-660), so the order within a cell depends on history. Today `nextInCell` and `freeSlots` are saved for exactly this reason (vegetation-store.ts:433-451), and so is the insertion order of each CellSet (cell-set.ts snapshot/restore; `fire: {burning, heated}`, `recovering`). The generic `FieldDefinition` (`storage: sparse`, `active: CellSet`) doesn't say the active order is saved. If sparse fields are saved as an ascending diff, the order is lost. Fire draws from a stream once per cell in iteration order.
  - Fix: Make iteration orders a function of the state, not of history. Store active sets as bitsets and scan them in ascending cell order: about 12.8k Uint32 words at 640², which costs microseconds. Keep each cell's plant list sorted by slot. Then rebuilding on load is safe. Free lists are state, so save them and hash them. Wherever an order can't be made canonical, keep saving it, as the code does today.
- **high**: The lazy spatial index is shared with queries from outside the simulation, so the UI can change the simulation. An inspector query that arrives between ticks builds the buckets before any system moves things. Without that query, the first query in the tick builds them after the moves. The query results then differ, which means a lockstep desync and replays that don't reproduce.
  - Evidence: Proposal §4: '40 m buckets are rebuilt lazily at the first query of a tick'. §4 also says WorldState implements the read view, so picking and ambience share the code, and §4 Commands says 'Inspection becomes a query message' handled by the worker between advances.
  - Fix: Rebuild indexes at a fixed point in the kernel (for example at the start of every phase, or after the moves in `life`). Queries from outside the simulation never build or mutate caches the simulation uses: they read a separate copy or skip lazy builds. Add a test: run N ticks with and without inspect queries in between, and compare the hashes.
- **medium**: Digests fed from the render change trackers either miss writes or depend on how often frames are built. Since the number of ticks per advance depends on real time, a peer with a different frame rate could show a false desync, or a real desync could go unnoticed.
  - Evidence: Proposal §9: 'Fields keep digests per 64×64 chunk, refreshed from the change trackers.' `RowChangeTracker.takeRow` clears the flag when it is read (change-tracking.ts), and the frame builder already consumes it. The trackers are coarse (rows and regions) and fed by about 25 hand-written `mark*` calls. Fire and heat changes go through CellSets, not row marks.
  - Fix: Give each field a dirty-chunk bitset that only the FieldWriter sets and only the hasher clears. Make raw typed-array writes unreachable in simulation code by exposing fields only through readers and writers, enforced by lint. In debug, assert that the incremental digest equals a full digest. In production, also fully re-hash a few chunks in rotation every turn.
- **medium**: Sections can opt out of hashing (`digest: ((hasher) => void) | null`). Authors will leave it null, and every null section is a part of the state where a desync can't be seen.
  - Evidence: The `SaveSection` interface in proposal §4. People, jobs, rivalry and the chronicle are object graphs (Maps, Sets, records), not typed arrays, so writing their digests by hand is the step most likely to be skipped.
  - Fix: By default, a section's digest is a canonical hash of its `write()` output: name-table ids, keys in a fixed order, typed arrays read through Uint32 views. `digest` only overrides it for speed. Only the session section may skip hashing, and a test lists every unhashed key.
- **medium**: The lockstep clock is wrong. A turn of 2 ticks is only 12.5 ms of real time at speed 16, and running commands two turns ahead (25 ms) is less than a typical round trip, so the game would stall constantly. Pause stops `clock.tick` while commands still change the state, so a hash keyed by tick is ambiguous and turns can't advance while paused. Pause gates the kernel yet sits in a session section the hash skips. Stamping commands for `lastFrameTick + 1` only works in single player.
  - Evidence: Proposal §4: `runTick` returns before `clock.tick += 1` when paused. §9: 'A root hash is taken every lockstep turn of 2 ticks'. §10: 'stamps commands for lastFrameTick + 1'. §4 Commands: 'Speed, pause and selection go into a session section that the hash skips.' The speeds are [1, 2, 4, 8, 16] (tick.ts).
  - Fix: Separate a monotonic step or turn counter, which always advances, from game time; key commands and hashes by it. Make a turn a fixed slice of real time (100–200 ms) holding a number of ticks set by the speed. Speed and pause become commands stamped with a turn, logged and agreed by all peers. Define a `TickSource` interface (a local real-time accumulator, or confirmed lockstep turns) now, so the kernel API doesn't change when lockstep arrives.
- **medium**: Batching hash changes into releases can't work when every merge deploys. Players get each change to hashes or generation as soon as it merges. Bases are attached only when the player loads an old save while the generator still matches, so saves not opened in that short window are stuck with the 'land changed' dialog for good.
  - Evidence: CONTRIBUTING.md:34 says CI deploys main on every push, and lines 125-126 say merging the version bump 'deploys it like any other change'. 151 commits have touched src/generation since 2026-08-01. Groups 5+6 and 8–10 are each many PRs. The proposal attaches a base only on load, after a fingerprint match (§9 'Old saves').
  - Fix: When group 4 deploys, attach bases in the background at app start to every save whose fingerprint matches, not only on load. After group 4, keep generation frozen for a fixed window: CI pins generation hashes and rejects changes. Land each hash-changing batch as one stack merged together, or behind a build flag.
- **medium**: Data loss when a newer save meets an older build, made worse by autosave. Unknown sections are dropped, sections that fail their schema reset, and unknown names may be dropped. The first autosave then overwrites the original.
  - Evidence: Proposal §6: a save loaded without the module 'drops the unknown section and logs a warning'. §4: 'A section that fails its schema resets.' Autosave exists (src/features/saves/saves-store.ts, src/app/use-engine-bridges.ts). With deploys on every merge, rolling back a bad deploy is routine, and PWA tabs on different builds share one IndexedDB.
  - Fix: Keep unknown sections, and rows with unknown names, verbatim, and write them back on save. Core sections (terrain, society, vegetation) refuse to load instead of resetting. Never autosave over a save that loaded with losses: write a copy and mark it in the saves list.
- **medium**: The exact-math list is incomplete. Deterministic code uses powers with non-integer exponents and `Math.log2`, so banning `**` leaves those calls with nothing to change to.
  - Evidence: Code using `**` with a non-integer exponent: relief.ts:143 (`** 1.6`), island-layout.ts:435 and 453 (`** 1.6`, `** 1.35`), springs.ts:144, water.ts:213, terrain-editing.ts:120, and wetlands.ts:286 (`wetness[cell] **= clamped`, a variable exponent). `Math.log2` appears at river-chains.ts:100, valleys.ts:160 and springs.ts:145. The proposal lists only sin, cos, atan2, exp, log, asin, acos and tanh.
  - Fix: Add an exact `pow` (a port of fdlibm's e_pow), an exact `log2`, and integer-power helpers. Write the Grit rule as a whitelist: ban every `Math.*` except abs, floor, ceil, round, trunc, sign, min, max, sqrt, fround, imul and clz32.
- **medium**: The golden CI claims more coverage than it has. The '5 engines' are 3: V8 (Node, Chromium), JavaScriptCore (Bun, WebKit) and SpiderMonkey. All run on Linux, so the system math libraries of Safari on macOS and iOS are never exercised. 600 ticks is 60 s of game time, too short to reach seasons, eras, lake filling or raids.
  - Evidence: Proposal §9: 'Golden CI: seeds 3, 7 and 11 run 600 scripted ticks in Node, Bun and Vitest browser instances (Chromium, Firefox, WebKit)'. TICK_SECONDS = 0.1 (tick.ts).
  - Fix: Rely on the whitelist ban for correctness and treat CI as a tripwire. Add a macOS runner for Bun and Playwright WebKit. Have every module contribute a scripted scenario that uses its powers. Run a long scenario nightly on a small grid, for example 20k ticks at 128².
- **medium**: Command payloads aren't defined well enough for lockstep. Floats such as x, z and milliseconds must be bit-identical on every peer, but JSON turns -0 into 0, and the local player could apply its own command before it goes through the wire encoding.
  - Evidence: §4: `strokeStep { power, x, z, milliseconds }`. §10: zod/mini validates commands from peers. Nothing is said about the local peer applying the decoded form.
  - Fix: Commands carry quantized integers (centimeters, whole milliseconds). Every command, local ones included, is applied only after the same encode and decode round trip. Command validation is a pure function of the command and the simulation state.
- **medium**: Packed ThingIds replace the monotonic persistent ids but leave saving, range and reuse open. Old cross-references need remapping. A handle can exceed Int32 and float32 range. The width of the generation counter isn't specified, so heavily reused transient slots, such as embers, risk the ABA problem.
  - Evidence: §4: `packThingId = generation * SLOT_SPACE + slot`, and `collect(..., out: Int32Array)`. Today ids come from the saved `IdentifierSource` (simulation.ts:296 `identifiers: this.identifiers.upcoming`) and are referenced by raids (`personId`), buildings, herds and selection. AGENTS.md warns that float32 loses precision past 16 million.
  - Fix: Keep the monotonic persistent id as the saved and public identity, used in commands, the chronicle and the UI. Slots stay internal, mapped by id, with a saved free list. If packed handles stay, specify 53-bit handles that never go into Int32 or Float32 columns, and keep transients in their own store.
- **medium**: Replays and lockstep depend on artifacts that can't be carried between machines or builds. The replay header names a base id that exists only in one browser's IndexedDB. Peers and replays need an identical build, but with 30–100 deploys a day, two players rarely share a build and replays expire within hours.
  - Evidence: §9: a replay header holds '(build, catalogHash, mods, seed, base id)'. Merging to main deploys (AGENTS.md, CONTRIBUTING.md:34).
  - Fix: Replay export and late-join or resync payloads embed the compressed base. Serve each build at an immutable versioned URL (Cloudflare versions). A lobby pins one build, and the replay loader fetches the build named in the header.
- **low**: Group 7's claim that hashes stay unchanged is doubtful. The new writers clamp values and snap them to rest, and moving lava from per-volcano Maps into one field changes both values (two volcanoes can overlap) and iteration order.
  - Evidence: §4: writers 'clamp, snap to rest'. volcanoes.ts:65 holds a Map per volcano, and lines 243, 276 and 327 check `volcano.lava.has(cell)` per volcano. The migration table marks group 7 as '–'.
  - Fix: Split it in two. 7a: writers with exactly today's behavior, hashes pinned. 7b: clamping and lava as a field, marked H and S, with the volcano section reading the old per-volcano maps.
- **low**: 'snapshot() never returns null' leaves out pending water recomputation, which is still driven by real seconds and is part of `isBusy`.
  - Evidence: water-recomputation.ts:60-72 (`#quietSeconds`, `#filling`, `isPending`) and 96-112 (`update(realSeconds)`). simulation.ts:201-206 includes `waterRecomputation.isPending` in `isBusy`.
  - Fix: Count the quiet time and the filling in ticks, and save them in the water section.
- **low**: A field's `rest` is a single number, but some baselines vary per cell. 'An old save without the field loads at rest' is wrong for those fields.
  - Evidence: world-state.ts:234 saves fuel as `sparseDifference(this.fields.fuel, groundFuel(this.terrain.ground))`, a baseline per cell.
  - Fix: Let `rest` be a function of the base, `(base, cell) => number`. Save diffs against it, and fill missing fields from it.
- **low**: Message ids for saved and wired text aren't pinned. Lingui's `msg` macro derives ids from the source text unless an id is given, so editing an English string orphans chronicle entries already in saves.
  - Evidence: §4 Events and §12: chronicle entries are made of message ids and parameters, and the worker sends `{ id, values }`. Old saves keep English `text` (chronicle.ts:29).
  - Fix: Require explicit, stable ids, enforced by lint, for every message that is saved or sent from the worker. Store the rendered fallback text alongside, and read old `text` entries as an alternative form.
- **low**: Event and kill ordering are left open. The proposal doesn't say whether events that listeners emit during a drain run in the same drain or the next phase, which cell represents events merged per 16×16 block, or what happens when a kill frees a slot during a trait's iteration in slot order.
  - Evidence: Proposal §4 Reactions ('merged per 16×16 block') and Events ('drained at phase ends').
  - Fix: Specify a FIFO drain until the queue is empty, with a cap. A merged event takes the maximum value, ties going to the lowest cell. Slot frees are deferred to `settle`.
- **low**: Smaller determinism gaps: the random stream that powers use (they run in `applyCommands`, not in a system) is unspecified. Seeding `xoroshiro128plus(seed)` from a 32-bit value leaves two constant state words. The ban list leaves out WeakRef, FinalizationRegistry, crypto, timers, Intl and toLocale*, and sort comparators that aren't total.
  - Evidence: plan.md:132-135 gave powers and tasks a shared `powers` stream. research/determinism-saves.md asked for splitmix32 seeding into `xoroshiro128plusFromState`, because today the state is (-1, ~seed, seed|0, 0) (random.ts:74-81).
  - Fix: Give each module a power stream, `power:<module>`, drawn in command order. Seed with splitmix32 into the full 128-bit state. Extend the Grit ban list, and require sort comparators in simulation code to break ties by id.
- **low**: Pinned golden hashes will churn under 30–100 agent PRs a day: agents will re-pin them just to turn the tests green, which defeats the safety net.
  - Evidence: Group 0 pins 600-tick hashes, and groups 5, 6, 8, 9 and 10 change them on purpose across dozens of PRs.
  - Fix: Keep the pins in one file per seed. CI accepts a change to that file only with a `Hash-Change: <reason>` commit trailer and logs it to a hash changelog. The ship workflow's reviewer flags any re-pin without a stated cause.

### Worth grafting

- Store `WorldBase` losslessly (byte-plane shuffle plus gzip), or quantize at the end of generation so the live session runs on the dequantized base from tick 0. Compute the base hash over the exact stored bytes.
- Design one logical save schema in group 4, independent of the memory layout: things as records keyed by one kind namespace, with stable ids separate from display names and a persistent id plus an optional slot; fields by name. Add one frozen reader for SAVE_VERSION=1 and never extend it. Groups 7, 9 and 10 then change only memory-side code.
- Make iteration orders canonical: active sets as bitsets scanned in ascending cell order, and each cell's plant list sorted by slot. Otherwise, keep saving the structures that carry order. Free lists are saved and hashed.
- Rebuild spatial indexes at a fixed point in the kernel. Queries from outside the simulation (inspector, mirror) never mutate caches the simulation uses. Add a test that interleaves inspect queries and compares hashes.
- Give each field a dirty-chunk bitset that only its writer sets and only the hasher clears. A section's default digest is a canonical hash of its `write()` output; opting out of hashing is not allowed for simulation sections.
- Add a monotonic turn counter separate from game time. A turn is a fixed slice of real time holding a number of ticks set by the speed. Speed and pause are logged commands stamped with a turn. Define a `TickSource` interface (local accumulator, or confirmed lockstep turns) now.
- When group 4 deploys, attach bases in the background at app start to every save whose fingerprint matches, then freeze generation for a window: CI pins generation hashes.
- Keep unknown sections and unknown-name rows verbatim and write them back on save. Core sections refuse to load instead of resetting. Never autosave over a save that loaded with losses.
- Write the exact-math rule as a whitelist (abs, floor, ceil, round, trunc, sign, min, max, sqrt, fround, imul, clz32), and add exact `pow` and `log2` to the list.
- Commands carry quantized integers and are applied, local ones included, only after the encode and decode round trip. Command validation is a pure function of the command and the simulation state.
- Ratchet the save fixtures: every change to the save shape adds a fixture written by the previous main. Run the fast-check save, load and N ticks property through the real serializer and envelope.
- Pin the build for lockstep and replays with versioned build URLs. Replay exports and resync payloads embed the compressed base.
- Require explicit, stable Lingui ids for every message that is saved or sent from the worker.
- Allow a change to the pinned hash file only with a `Hash-Change:` commit trailer, logged to a hash changelog.

## Performance — 6/10

On performance, the proposal gets the data layout right: typed arrays, the SoA VegetationStore, a grid-aligned spatial index and no ECS. Its spatial index removes today's largest measured simulation costs, which are the O(n²) neighbour scans. The problem is the extension points. They put per-cell indirection inside the hottest loops: closure-based reactions that look up fields by name, writers on every write, virtual ThingSource dispatch, visitor objects allocated per call, derived properties, and summaries that compute every value. Nothing stops dense fields from feeding reactions that walk all 409,600 cells every tick. The proposal also sets no performance budgets.

I measured the current code at 640², seed 7, with about 470 people and 520 animals. In Node 24 (V8), a tick costs 0.7–1.2 ms. At speed 16, one advance costs 4.6 ms when calm, 6.4 ms with 1.4k burning cells and 8.8 ms after rain. The worst advance took 300–520 ms. Frames transfer 76–372 KB on average and up to 3.4 MB. So at speed 16 the worker is already 30–50% busy with about 1k agents, and the target is thousands.

In my micro-benchmarks:
- the reaction pass is 5–8× slower than a direct loop;
- the writer path is 3.3× slower than raw writes;
- dispatching across five virtual sources is 5× slower than a specialised loop.

Apply those factors to fire, surface and agent queries and speed 16 stops keeping up. The fixes are tractable: batch reaction kernels, field cadences, tiered storage, specialised query loops, opt-in hashing and explicit bench gates. With them, this proposal would be the fastest of the options.

### Strengths

- It keeps the typed-array cell fields, the SoA VegetationStore and the intrusive per-cell plant lists. It rejects ECS libraries, citing a measured 10–18× memory and 150–490× spawn cost. Its own spatial bench shows a grid beating kdbush and flatbush, both to rebuild (22 µs vs 155–179 µs for 5k movers) and to query.
- The bucket index and the Surroundings query API go straight at today's top measured costs. In a CPU profile of my speed-16 run (/private/tmp/claude-501/-Users-svidskiy-Developer-svidskiy-dawnfolk/f224a3c7-cf6b-4066-884d-19a8c99c1ec2/scratchpad/architecture/bench/critic-perf/run/advance-bench.ts), linear neighbour scans take about 14% of CPU outside generation: hunterNear (simulation.ts:594) 5.9%, answerFoes (decisions.ts:158) 5.6%, nearestAnimal 1.8%, nearestPerson 1.2%. These scans grow O(n²), so at 5k agents they would dominate.
- Today an r=140 tornado adds about 1.7 ms per tick (2.85 vs 1.17 ms in Node with about 700 agents). The cost comes from cellsInArea allocating twice, plantsInCell(...).filter arrays per cell, and six linear scans: livingWithin twice, damageArea three times, scare once (tornadoes.ts:118-136). The proposed path of buckets, a radial pattern and no allocation removes most of that.
- Several frame changes cut per-frame work. Inspection becomes a query message, while today it is recomputed every frame. Frame sections can be left out when unchanged. Dirty bitsets per column group replace the per-frame re-description of every building and tribe (frame-builder.ts:36-71).
- WorldBase removes regeneration on load. Generating 640² takes 3.45 s in V8 and 8.8 s in Bun on this Mac, and loading a save does that today.
- The codemod that turns Math.hypot into Math.sqrt is a speed win as well as an exactness win: 8–16× faster in my bench (518 µs vs 65 µs per 80k calls in Node).
- The package changes help startup. Dropping react-markdown and remark-gfm removes a 50 kB gz precached chunk. zod/mini saves about 37 kB gz, and zod is currently duplicated in the main and worker bundles. Leaving out SharedArrayBuffer and COOP keeps embeds working without hurting the pull model.

### Findings

- **high**: Reactions are per-cell closures (when/apply) that call cells.field(name).at() and .scale() inside the loop. That costs 5–8× a direct typed-array loop. If fire or surface logic moves into this framework, a big fire at speed 16 can no longer keep up.
  - Evidence: From evolve-perf.mjs in /private/tmp/claude-501/-Users-svidskiy-Developer-svidskiy-dawnfolk/f224a3c7-cf6b-4066-884d-19a8c99c1ec2/scratchpad/architecture/bench/critic-perf (Node 24 / Bun 1.4):
- 2k active cells: direct 1.5 µs vs reaction 10.2 µs (Bun 17 µs);
- 20k active cells: direct 16.9 µs vs reaction 124 µs (Bun 178 µs).
The proposal's SOAK_DOUSES_FIRE looks up a field by name three times per cell. Implicit threshold rules such as ignitesAt and quenchesInto would put fire ignition, today's hand-tuned #heatCell/#burnCell retain loops in fire.ts:163-230, behind this indirection.
  - Fix: Make a reaction a batch kernel: `{ id, drivenBy, reads, writes, run(active: Int32Array, count: number, arrays: ResolvedFields, tick) }`. It is called once per tick and loops inside, with the field arrays resolved once at setup. Ban field(name) and property(name) calls inside loops with a Grit rule. Core fire, surface and growth stay hand-written kernels that only register as systems. The per-rule API is for sparse module rules.
- **high**: Reactions driven by dense fields, and threshold transitions on dense fields (meltsInto on snow, rules reading wetness), have no cadence or stride. The active set of a dense field is almost every cell, so one rule walks 409,600 cells per tick. Today's surface system touches 20,480 cells per tick.
  - Evidence: surface.ts:5,179-193 processes ROWS_PER_TICK = 32 rows and scales time by rowsPerPass. It also skips settled 32-cell segments using bit compares (surface.ts:262-299). In my bench, one reaction over 409,600 cells takes 7.8 ms per tick in Node and 11 ms in Bun, against 1.7 ms for a direct loop. At speed 16 (160 ticks/s) the whole tick budget is about 6.25 ms. If weather rain or wind ever stamps an island-wide exposure (soak, windX), soak-douses-fire walks all 409,600 cells.
  - Fix: Fields declare `cadence: { rowsPerTick }`. Reactions driven by a dense field run on that row stride with seconds × rowsPerPass, as surface.ts already does, plus settled-block skipping. Dense fields carry no active CellSet. Global weather stays a scalar in EnvironmentReading and never becomes an island-wide exposure. Rules are driven by the smaller set, for example the fire active set reading soak, never the reverse.
- **high**: The proposal sets no performance budgets or bench gates. 'Frame time within noise' and 'Bench budgets' name no numbers, but the current baseline already uses a large share of the worker at speed 16 and the target is thousands of agents.
  - Evidence: advance-bench.ts, Node 24, 640², seed 7, 464–490 people and 480–560 animals, advance(1/60) per frame:
- speed 16 calm: 4.56 ms per advance, worst 388 ms;
- speed 16 with 1,457 burning cells: 6.37 ms, worst 311 ms;
- after rain: 8.75 ms, worst 524 ms;
- transfer: mean 76–372 KB, worst 3.1–3.4 MB.
tick-bench.ts: 0.7–1.2 ms per tick. The proposal's tornado estimate of 113 cells corresponds to r=60 m, while the default radius is 45 m and the maximum 140 m (powers.ts:336-344).
  - Fix: Group 0 adds a scripted bench with numeric gates that fail CI on a regression over 10%. Starting points:
- p95 tick ≤ 2 ms with 5k agents and 2k burning cells at 640²;
- speed-16 advance ≤ 8 ms mean;
- worst advance ≤ 50 ms, with water and navigation tasks time-sliced;
- median frame transfer ≤ 128 KB;
- main-thread frame apply ≤ 1 ms;
- worker heap ≤ 250 MB at 768².
Every kernel and context group (3, 7, 8, 9, 10) is gated on the bench, not only on hashes.
- **medium**: The writers' contract (clamp, snap to rest, keep active current, mark rows dirty on every write) makes hot loops 3× slower. It also forces a choice: route every write through writers, or let the hash and frame dirty tracking miss raw writes.
  - Evidence: For 32 surface rows (20,480 cells, two fields):
- raw writes: 15.4 µs;
- FieldWriter.add: 50.4 µs;
- cells.field(name).add per write: 212.7 µs.
fuel changes today, in recoverFromFire (surface.ts:113-140) and #consumeFuel (fire.ts:236-252), are not tracked by any change tracker. Chunk hashing or frame diffs that rely on writer marks would miss them unless those loops pay the writer cost.
  - Fix: Use writers for brush, sparse and module writes. Kernels write raw arrays, then call bulk `markRows` or `markChunks` once per row or segment. Document which path keeps which invariant, and have a debug-mode verifier compare chunk digests to catch missed marks.
- **medium**: Memory grows from the generic field and thing shapes. Every field gets a Float32 array plus an active CellSet, new fields arrive per module, and CommonColumns adds health, heat and flags to every plant slot.
  - Evidence: CellSet is an Int32Array plus a Uint8Array per cell (cell-set.ts). Float32 plus CellSet is 3.69 MB per field at 640² and 5.31 MB at 768². The 8 existing fields plus lava, soak, windX, windZ, danger, acid and germs come to about 40–55 MB extra in the worker if each gets a CellSet. Plant capacity is 1.25 per cell (world-generator.ts:41), which is 512k slots at 640² and 737k at 768². health, heat and flags add 9 B per slot, 4.6–6.6 MB, which also flows into snapshots and hashes. My Node run already sat at 380 MB RSS. A mobile app is on the roadmap.
  - Fix: Offer storage kinds:
- `f32`;
- `u8` and `u16`, quantized, for soak, danger, germs and trodden;
- `tiled`, 64×64 tiles allocated on first write, for lava, acid and germs.
Exposures are tiled and cleared through a touched-tile list, never with fill(). Active sets exist only when a field declares `tracked: true`. CommonColumns members are optional per source: plants derive health from state and read heat from their cell.
- **medium**: Dispatch through ThingSource.forEachInCell and visitor.visit is polymorphic or megamorphic across at least five source classes. That is cheap for one tornado but expensive for per-agent queries every tick. The walkthrough code also allocates visitor literals per call, which contradicts 'no allocation'.
  - Evidence: fair-sources.mjs, counting conifers over a 113-cell footprint, 1000 queries:
- 5 virtual sources: 5.75 ms in Node, 2.27 ms in Bun;
- pruned by group: 1.88 ms;
- specialised plant loop: 1.18 ms.
For 5k contact queries at r=4 m: hoisted megamorphic visitor 217 µs, inline collect into an Int32Array 91 µs. Sickness `progress` allocates `{ visit: ... }` per sick person per tick, and the tornado allocates two visitor literals per tick. At 5k agents doing nearest or count queries every tick, about 29 ms vs 6 ms.
  - Fix: ThingQuery switches on filter.groups bits into a specialised loop per store, with no interface method per cell. Make `collect(..., out: Int32Array)` and `count` the default for hot per-agent queries, and keep visitors for rare queries or early exit. Hoist filters and visitors as module constants with mutable fields, and drop the allocating walkthrough code.
- **medium**: 16×16-cell (160 m) block counts do not serve the radii actually queried, so 'trees by species answered from block counts' does not hold for the tornado or for agents.
  - Evidence: The tornado radius defaults to 45 m with a 140 m maximum (powers.ts:336-344). A 160 m block has a 226 m diagonal, so it never fits inside a 90 m-wide circle. Every plant in the footprint is scanned per cell, as in today's plantsInCell path. Agent radii such as CONTACT_REACH, ELBOW_ROOM and hunter notice are smaller still. The block-count win in research/spatial-queries.md (about 0.02 µs) was measured at r=300 m.
  - Fix: Use two levels: 4×4 cells (40 m, aligned with the mover buckets) and 16×16 cells. nearest and any skip empty blocks before scanning cells. Re-measure at r = 4, 45 and 140 m.
- **medium**: summarize computes everything on every call, and the proposal moves ambience onto summarize over the mirror. At ambience radii that adds a main-thread spike of about 1 ms or more every 0.5 s.
  - Evidence: Ambience today takes 7×7 = 49 samples (ambience.ts:13) over a reach of up to 1,200 m (ambience.ts:63), every 0.5 s (world-sounds.ts:18). A full summarize at r=1,200 m covers about 45,000 cells through property('biome'), which reads the lava field, then hasWater, then the biome. It also visits about 56,000 plants for tag counts and the people buckets for tribe counts: roughly 1–1.5 ms. On a 120 Hz display the frame budget is 8.3 ms.
  - Fix: Use `summarize(x, z, r, wants: SummaryMask, out)` so callers pay only for what they read. Keep per-block aggregates (biome histogram, water share, burning count, snow cover), recomputed lazily for blocks that are dirty. Large radii then cost O(blocks), about 177 blocks at 1,200 m. Offer a `step` sampling mode for audio.
- **medium**: The state hash is defined per frame and per two-tick lockstep turn. That means hashing in single player, and at speed 16 the vegetation and surface churn makes the per-turn cost large.
  - Evidence: The frame is `{ tick, stateHash, sections }`. research/determinism.md measures about 5 µs per 64×64 chunk of one layer and 4.9 ms for 10 full layers. The surface dirties 10–20 chunks × 4–5 fields per tick. That is about 0.25–0.5 ms per tick, against today's whole tick of 0.7–1.2 ms. Vegetation (9 channels × 512k slots) changes in scattered slots through setFruit and setHeight across all berry bushes every 0.05 days (vegetation-growth.ts:96-102), so its digest chunks are nearly all dirty: a rehash of about 18 MB, roughly 6 ms. At speed 16 a two-tick turn means 80 turns per second.
  - Fix: Leave the hash out of single-player frames; compute it only in lockstep, replay recording and debug. Maintain additive hashes, sum of mix(index, bits) mod 2³², in writer paths and VegetationStore setters, which is O(1) per change. Hash cheap sections (random states, counts, agent columns) every turn and full field chunks every N ticks, chosen by real time.
- **medium**: Buckets rebuilt 'lazily at the first query of a tick' go stale within the tick. Movers shift in the emit and life phases, so bucket membership reflects tick-start positions while distances use live positions. Things spawned during the tick are invisible to queries.
  - Evidence: The tornado's whirl moves agents several metres per tick (FLUNG_SPEED = 26 × force, tornadoes.ts:21,186-197), and movement runs in life. Rebuilding is cheap: 29.5 µs in Node and 37.6 µs in Bun for 5k movers.
  - Fix: Rebuild per phase when dirty, which costs at most about 0.25 ms per tick across 7 phases, or pad the search by the maximum per-tick displacement. Document the snapshot semantics: tick-start membership, live positions, isLive checked. A rebuild must never run per agent move.
- **medium**: The proposal has WorldMirror implement the same read view (CellReader.field for any FieldName). That would require mirroring every field to the main thread, which inflates frames. It would also return quantized values, so code shared by the two threads gives different answers on each.
  - Evidence: The mirror holds only 4 quantized bytes per cell: snow, wetness, scorch and fire (frame-packing.ts:104-130; SURFACE_CHANNELS = 4). Surface packing already takes 5.5% of CPU outside generation (packChangedSurfaceRows), plus 2.1% walking the frame graph (collectBuffers), and frames peak at 3.1–3.4 MB.
  - Fix: Split the type into SimulationCellReader and MirroredCellReader. A field opts into mirroring with `mirror: { channel, quantize }`, so main-thread code can only compile against mirrored fields. Writers mark frame rows dirty only for mirrored fields.
- **medium**: ThingId = generation × SLOT_SPACE + slot overflows the typed-array frame columns. Transient churn from embers and arrows raises generations quickly.
  - Evidence: People ids already travel in Float32 frames (frame-packing.ts:214: buffer[offset + PersonField.Id] = person.id). Float32 is exact only up to 2²⁴. In Int32 with 2²⁰ slots, overflow comes at generation 2,048. A crown fire launches embers continuously (fire.ts #throwEmbers), and the proposal turns embers into things.
  - Fix: Pack ids into a uint32 with a wrapping 8–12-bit generation, using bit operations. Carry ids in Uint32Array frame columns, never Float32.
- **low**: CommonColumns gives positions as Float32Array. Today Mover.x and Mover.z are float64, so moving people and animals to float32 columns adds quantization to slow motion and crowding nudges, and changes hashes for no gain.
  - Evidence: Mover is a plain object with number x and z (movement.ts:28-49). At |x| ≈ 3,000 m the float32 ulp is about 0.24 mm, so a 0.05 m/s step over 0.1 s is only about 20 ulps. keepApart applies small pushes (crowding.ts).
  - Fix: Store mover x and z as Float64Array; 5k agents × 16 B is 80 KB. Plants stay Float32.
- **low**: The cadence check `tick % cadence === 0` lines every cadence-N system up on the same tick, and long tasks are not sliced. Today's 300–520 ms worst advances will survive the kernel rewrite.
  - Evidence: advance-bench: worst advance 311–524 ms at speed 16. Navigation rebuilds and water recomputation run in one go (simulation.ts:540-543, #recomputeWaterWhenSettled).
  - Fix: Give each system a phase offset from a hash of its id. ScheduledTask supports incremental work with a per-tick budget counted in work units (deterministic, not wall time). Hydrology and navigation become resumable steps.
- **low**: Transferables are found by walking the frame graph with buffersWithin, and frame building has no budget.
  - Evidence: collectBuffers takes 220 ms of a 14 s profile, about 2% of simulation time. It spreads every Map and Set and calls Object.values on every object (shared/buffers.ts).
  - Fix: FrameSection.build returns `{ payload, transfer }`, so the sections list their own buffers. Keep buffersWithin only as a test oracle.
- **low**: WorldBase is planned as 'quantized and gzipped'. Lossless compression is already small, and quantizing makes a loaded world differ from the live one unless the quantized base is used from creation onward.
  - Evidence: base-compress.ts on seed 7's 12 layers: 16.0 MB raw, 7.8 MB with gzip (CompressionStream), 5.7 MB with row delta + byte shuffle + gzip. Compression took about 0.85 s in Node. Height alone: 1.64 MB raw, 1.46 MB gzipped, 1.04–1.12 MB after delta and shuffle.
  - Fix: Use lossless delta, byte shuffle and gzip, run in the worker after the world appears, outside the critical path. Count the load-time win (no 3.5–9 s regeneration) as a goal of group 4.
- **low**: Events are object literals. They are cheap at today's volumes, but per-plant thingKilled events in crown fires and chronicle projection per event would add up.
  - Evidence: 10k events per tick: 70 µs as objects vs 12 µs in a typed SoA queue (Node). burnTreesInCell kills every tree in a cell at once (vegetation-store.ts:330-341).
  - Fix: Plants never emit per-plant events; they emit aggregates per block. High-volume kinds use a typed SoA queue, and the chronicle merges entries by kind, block and hour.
- **low**: The exact-math risk is overstated, and the real per-cell transcendental hot spot is not called out.
  - Evidence: My fdlibm exp port runs 1.3× Math.exp in Node (485 vs 365 µs per 80k calls) and 1.8× in Bun, with relative error ≤ 2.2e-16. fire.ts:299 calls Math.exp per neighbour per burning cell: 10k burning cells mean 80k calls per tick. A clamped 1024-entry table with lerp ran 2–4× faster than native exp and is deterministic.
  - Fix: Use tables for clamped per-cell factors (slope factor, wind push) and fdlibm for per-tick scalars. Measure in group 0, as the proposal's risk 2 already suggests.
- **low**: Each module's TerrainLayer adds full-resolution texture samples to the terrain fragment shader, the most expensive full-screen pass, even where the layer is empty. WebGPU's default limit is 16 sampled textures per shader stage.
  - Evidence: Lava, acid and scorch are all planned as terrain layers, each an R8 data texture. The terrain material already samples surface, ground albedo, wetland, heights, patch steps and the outline (terrain-material.ts:89,291-292 plus the height and outline textures).
  - Fix: Pack module overlays into shared RGBA8 overlay textures with a declared channel budget. Gate them with a uniform 'any active' flag, and test the sampler count in the browser.

### Worth grafting

- Reactions run as batch kernels called once per tick, with field arrays resolved at setup. A lint rule bans field(name) and property(name) lookups inside loops. Fire, surface and growth stay hand-written kernels registered as systems.
- Field definitions declare their cadence (rowsPerTick). Reactions driven by a dense field run on that row stride with settled-block skipping. Global weather stays a scalar and never becomes an island-wide exposure. Rules are driven by the smaller active set.
- Numeric performance budgets and a CI bench go in group 0, starting from the measured baseline: 0.7–1.2 ms per tick, speed-16 advance 4.6–8.8 ms, worst advance 300–520 ms, frames 76–372 KB on average and 3.4 MB at worst. Groups 3 and 7–10 are gated on it.
- Tiered field storage (f32, u8/u16, tiled 64×64), opt-in active sets, exposures cleared through a touched-tile list, and CommonColumns members that a source may leave out.
- ThingQuery uses specialised loops per store selected by group bits. Hot per-agent queries default to collect and count into scratch Int32Arrays. Filters and visitors are module constants.
- Two-level block counts: 40 m, aligned with the mover buckets, and 160 m. Block-level aggregates of cell properties make large-radius summaries O(blocks). summarize takes a mask of the values the caller wants.
- Buckets are rebuilt per phase when dirty, with documented semantics: membership at the rebuild, live positions for distances.
- Separate type-level read views for the simulation and the mirror. A field opts into the frame with a channel and a quantization.
- No state hash in single-player frames. Additive incremental hashes are maintained in writers and VegetationStore setters, with hash cadence chosen by real time. One 64×64 chunk dirty bitmap drives the frame diffs, the hash refresh and the WorldBase save diffs.
- WorldBase is stored losslessly: row delta, byte shuffle and gzip, measured at 5.7 MB vs 16 MB raw. It is compressed in the worker after the world appears, and the 3.5–9 s regeneration it saves on load is counted as a win.
- ThingIds are uint32 with a wrapping 8–12-bit generation and travel in Uint32Array frame columns. Mover x and z are Float64Array.
- Systems get phase offsets from a hash of their id. Heavy tasks (hydrology, navigation) run in resumable slices with a work-unit budget.
- FrameSection.build returns its own transfer list, which removes the buffersWithin graph walk.
- Deterministic lookup tables replace per-cell transcendental calls; fdlibm handles per-tick scalars. The hypot-to-sqrt codemod ships early as a speed win.
- Keep the measured win and make it the first payoff of group 8: the bucket index replaces hunterNear, answerFoes, nearestAnimal and nearestPerson, about 14% of non-generation CPU today and growing O(n²) with agent count.

## Extensibility — 5/10

Lens: extensibility and ergonomics. $R is /private/tmp/claude-501/-Users-svidskiy-Developer-svidskiy-dawnfolk/f224a3c7-cf6b-4066-884d-19a8c99c1ec2/scratchpad/ashfolk.

The infrastructure is strong: kernel, save and frame sections, name tables, Surroundings with a fixed tie order. The extensibility claims are much weaker than the walkthroughs suggest. Each walkthrough only looks cheap because the core already holds the trait it needs: `corrodes` exists for acid rain and `buoyant` exists for the boat. Traits, ThingProperties, AreaSummary and cell properties are all closed in core. The first example property, EFFECTIVE_BIOME, reads the volcano module's `lava` field from core. That breaks "core never mentions a module" before any feature is built.

The vocabulary modules contribute is typed as closed string unions: FieldName, ModuleEvent, EffectKind, InspectionKind and DeathCauseId. Nothing says where those unions are assembled. The layer table and the four tsconfig projects leave no legal place for them, and no project can hold modules/*/module.ts or shared/.

For tribe systems, the model has no extension points:
- no API to declare columns, so walkthrough D's "module columns" have no mechanism;
- `effective()` stats and modifiers are mentioned once and never defined;
- no hook for adding jobs to decisions, and today's decideJob is a hand-ordered ladder;
- no tribe entity, no queries over tribe relations, and the filter can only say `tribe: number`;
- modules may not import each other, though sickness, trade and diplomacy depend on each other.

I counted the touch points for two new scenarios against the proposal as written:
- **Beavers that dam rivers:** about 12 module files plus 6 registration lines, plus 5–6 core edits:
  - per-kind behavior in fauna, since there is no AnimalBehavior registry;
  - a flow-barrier input to hydrology in core/world/water;
  - recomputing water after things load, since restore order is base, water, navigation, then sections, so dams load after the water;
  - walkability and crossings, since crossings are planned as a static ThingSource;
  - the InspectionKind union;
  - ANIMAL_LOOKS, if it is keyed by core names.
- **A plague that spreads through trade:** 4–5 core edits:
  - the decideJob ladder, to add a trader job;
  - a place for per-tribe trade and prevalence state;
  - the trade→sickness event, which must move into core/protocol because sibling modules cannot import each other;
  - relation modifiers in core rivalry, so tribes can close borders;
  - a tribe selector in the filter.

A data-only mod cannot express "acid rain" at all, because reactions and powers are code closures.

The tornado query mostly works: biome, fire and people are covered. Two gaps:
- There are no per-species tallies, though "which trees are near" was the owner's literal example.
- The claim that block counts answer it is false at tornado radii. The radius is 45 m by default and 140 m at most, and a 16×16 block is 160 m wide.

Fix these with typed handles, open traits, properties and columns, property contributions, decision and stat hooks, declared module dependencies and a declarative mod tier. With those, the per-feature count really does drop to one folder plus registrations.

### Strengths

- Surroundings is one read API with a fixed tie order (distanceSquared, dz, dx; ascending slot), no RNG and no allocation, and both WorldState and WorldMirror implement it. Picking, ambience and the snow rule then share one code path.
- It keeps specialised stores where they pay: plants stay SoA, people keep their behavior records. It makes only the physical part uniform behind ThingSource. That is a realistic middle ground, and it backs the rejection of an ECS library with numbers.
- The walkthroughs list concrete files for each feature, which makes the proposal testable and lets it be attacked on its own terms. Few proposals do this.
- Field writers clamp, snap to rest, keep active sets current and mark dirty rows. That removes about 40 raw writes and 25 manual mark* calls, and makes 'add a field' cheap.
- strike(Blow) collapses the per-system damageArea, scare and addZone calls. I verified 5 scare and 6 addZone calls outside tests, and the 34 isTree/Shrub/Rock/Monument predicate calls are accurate. Push scales by mass and harm by resistance, which is the property-driven interaction the owner wants.
- Threshold transitions as data (quenchesInto, meltsInto, ignitesAt) and reactions that walk only the drivenBy active set are the right open seam for element interactions.
- Registries use `satisfies { [Id in ModuleId]: X | null }`, so tsc lists every missing module side, with no globs and no declaration merging.
- Frame sections treat a missing key as unchanged, and MirrorSection.apply returns change kinds. That removes the three edits per frame field and the hand-kept hasLandChanged list.
- Lasting effects such as tornadoes, meteors and embers become things with frame rows. That fixes reloads and late joiners, and it removes today's null snapshot() while isBusy is true (simulation.ts:201-209, 272).

### Findings

- **high**: Module vocabularies are closed string unions with no legal place to assemble them. FieldName, CellPropertyName, SimulationEventKind/ModuleEvent, EffectKind, InspectionKind, DeathCauseId and ThingTag must include module contributions. Any type that does so has to import modules from a layer the table forbids. The four composite projects also have no home for modules/*/module.ts and modules/*/shared.
  - Evidence: §4 `field(name: FieldName)`, `drivenBy: FieldName`, `| ModuleEvent`. §11 `EFFECT_PRESENTERS: { [Kind in EffectKind] }`. §12 `INSPECTORS: { [Kind in InspectionKind] }`. Walkthrough B calls `cells.field("soak")` and defines `defineField("acid")` inside the module, yet claims 'no core file mentions acid'. In the §3 table, core imports only lower core sublayers and simulation/state imports only core. §3 tier 1 lists four projects (core, simulation+modules/*/simulation, engine+modules/*/engine, interface+modules/*/interface), and none contains module.ts or shared. Placing them in simulation would make engine reference worker code; placing them in core breaks the import table.
  - Fix: Replace name unions with typed handles created by their owner: defineField, defineTag, defineEvent<Payload>, defineDeathCause, defineEffect<Payload>, defineColumn, defineStat. Each returns a key object that code imports from its owner, and registries are keyed by handle. Core declares only the handle types. At boot, kernel.compose() rejects unknown or duplicate handles, and one test boots every module. Add a fifth composite project, 'contracts', holding modules/*/module.ts and modules/*/shared, which simulation, engine and interface reference. ModuleId stays the only closed union.
- **high**: Traits, ThingProperties, AreaSummary and cell properties are closed in core. The walkthroughs look cheap only because core was seeded in advance with the trait each one needs. The first property example already makes core read a module's field.
  - Evidence: §4 lists the traits 'flammable, grabbable, buoyant, uprootable, frightened, corrodes' as core systems. `corrodes` exists only for walkthrough B and `buoyant` only for walkthrough C; today's code has neither. Kinds take `traits: Partial<TraitConfigs>`, and `ThingProperties { mass; radius; windResistance; heatResistance }` is a fixed core interface. `defineCellProperty({ name, read })` is a single closed function. `EFFECTIVE_BIOME.read` reads `world.field("lava")`, but lava belongs to the volcano module ('Lava stops being a Map inside Volcano'; modules/volcano in §2). Ice sheets, acid, dams and deep snow would each have to edit core's walkable, biome, flammability and fertility reads. Walkability today is already composed from several inputs: $R/src/simulation/world/world-state.ts:366 `isWalkableGround(...) && !this.isObstructed(cell)`, with CROSSING_GROUND occupancy at lines 639-641.
  - Fix: (a) Let modules register traits: `defineTrait({ id, config: zodSchema, phase, step })`, with configs validated at catalog compile. Let catalog patches attach traits and numbers to other modules' kinds, e.g. `kindPatches: { 'building:hut': { traits: { rots: {...} } } }`, checked against the name tables. (b) Make per-kind properties open: `defineThingProperty('buoyancy', { default: 0 })` compiled into a Float32Array indexed by global kind, so existing kinds get defaults. (c) Compute cell properties as a base value plus ordered contributions: `contribute(BIOME, { whenTag: 'molten', value: Ash })`, `contribute(WALKABLE, ...)`, `contribute(FLAMMABILITY, multiply...)`. Contributions run in module order and are pinned by a test. (d) Rewrite walkthroughs B and C to count 'first corrosive thing = new trait' honestly.
- **high**: Tribe systems have no extension points: no column declaration, no stats or modifiers, no hook into decisions, no tribe entity and no relation queries. The roadmap's 'deeper tribes' (sickness, diplomacy, beliefs, trade) would keep editing core society.
  - Evidence: ModuleRuntime has only systems, powers, saves, frames and listeners, and SimulationModule has only fields, reactions and create. Walkthrough D's 'module columns on the person group' therefore has no API, and no spawn or free hook clears a side table when a slot is reused. `effective("energy", person)` appears once (evolve.md:694) and is never defined. JobType exists only for saving. Today $R/src/simulation/society/decisions.ts `decideJob` is a hand-ordered ladder with `NIGHT_JOBS`, `UNWAVERING_JOBS` and `STEADFAST_JOBS` kind sets, so a healer, trader or pilgrim job needs a core edit. Tribes are a fat record ($R/src/simulation/society/tribe.ts `interface Tribe`), relations are `RelationBook`, `Stance` and `Grudge` in rivalry/relations.ts, and neither is extensible. `ThingFilter.tribe: number` cannot express 'hostile to me' or 'any but mine'. §2 says tribe systems are modules, yet rivalry, about 4.4k lines, stays in core `systems/life`.
  - Fix: Add, in core:
- `defineColumn(group, key, type, default)`: saved by name, cleared on spawn, mirrored on opt-in.
- `defineStat` plus ordered modifiers, read through `stat(slot, ENERGY)`.
- Decision contributors, `JobProposal { kind, band: 'survive'|'duty'|'work'|'leisure', score(tick), start }`, in place of the ladder. Interrupt policy becomes a JobType field instead of kind sets.
- A tribe store with columns, `TribeQuery.relation(a, b)` and relation modifiers.
- A filter `TribeSelector`: own, hostileTo, alliedWith, anyBut.
- Lifecycle events: personBorn, personDied, tribeFounded, tribeExtinct.

Then decide whether rivalry becomes a module.
- **high**: Sibling modules may never import each other, so interdependent features must either push their vocabulary into core or merge into one module.
  - Evidence: §3 dependency-cruiser rule: 'no imports between sibling modules'. Cases that break it:
- Plague through trade: sickness has to react to a trade event.
- Walkthrough D's 'future healer job listens to fellIll', if the healer lives in a medicine module.
- Beaver dams that should act as crossings.
- Diplomacy closing borders during a plague.

Each needs one module's event, column or stat type in another module.
  - Fix: Let a module declare `requires: readonly ModuleId[]`. A test over MODULES order checks that the graph is acyclic. Allow imports only from a required module's `shared/`, which holds its handles, events and frame types. Optional dependencies resolve a handle at compose time, which returns null when the module is absent.
- **high**: The filter model does not scale: one 32-bit tag mask, a single Uint8 kind mask over several kind id spaces, no any-of or none-of, and no dynamic state or flags.
  - Evidence: §4: `ThingFilter { groups: number; tags: number; kinds: Uint8Array | null; tribe: number; includeHeld: boolean }`, and 'Tags compile to a Uint32 mask per kind'. That allows 32 tags across plants, buildings, animals, transients, modules and later mods. The walkthroughs already use uprootable, conifer, movable, wooden and corrodible, plus plant forms and materials. §9's save envelope keeps separate name tables for plantSpecies, thingKinds, buildings and monuments, so one `kinds` mask across groups is ambiguous. Plant state is dynamic, not a tag: $R/src/world/vegetation-store.ts PlantState Alive/Burnt/Fallen/Removed. $R/src/simulation/world/obstacles.ts `isStanding` already filters on it, the approved crossings rework needs 'fallen logs near the river', and the tornado must skip fallen trees. `includeHeld` is a one-off special case of flag filtering.
  - Fix: Use one global thing-kind table with a group column and a compiled kind id, and multi-word tag bitsets (Uint32Array of ceil(tags/32) words). The filter becomes `{ groups, all, any, none, kinds: KindSet, states, flagsSet, flagsClear, tribe: TribeSelector }`, plus an optional `where(group, slot)` escape hatch applied after the indexed part. includeHeld becomes `flagsClear: HELD`.
- **medium**: Per-species tallies are missing, though 'which trees are near' was the owner's literal example. The proposal also claims block counts answer the tornado's tree query, which fails at real tornado radii.
  - Evidence: AreaSummary holds only `biomeShares`, `tagCounts`, `tribeCounts` and fixed fire and heat fields. Counting by species takes one `count()` per species or a hand-written visitor. The tornado radius comes from `brushRadius(45, 140)` ($R/src/content/powers.ts around line 345), while a 16×16-cell block is 160 m wide. No whole block fits inside a 45–140 m disc, so 'Trees by species: a tag filter answered from block counts' never uses block counts. The hardcoded `burningCells`, `maximumFire` and `meanHeat` mean module fields such as lava, acid, germs or ice can never appear in a summary.
  - Fix: Add `tally(shape, filter, out: KindHistogram)`. Declare area queries once, e.g. `defineAreaQuery({ fields: { fire: ['max','countAbove:0'], lava: ['any'] }, things: { trees: byKind(TREES), people: byTribe(PEOPLE) } })`. The kernel compiles it to a reusable result object, and module fields join through their handles. Keep block counts, but document where they help: summaries over 160 m or more, such as minimap, ambience and AI planning.
- **medium**: Filters and other catalog-derived constants are built at import time from a catalog that changes per world once mods and scenarios arrive.
  - Evidence: Walkthroughs A and D declare filters at module scope: `const UPROOTABLE = createThingFilter(CATALOG, { tags: ["uprootable"] })` and `const PEOPLE = createThingFilter(CATALOG, ...)`. §4 says compileCatalog runs 'base, then modules (later also mods and scenarios)' and produces a catalogHash, and §9's replay header lists mods per world. A module-scope constant freezes the catalog of the first world loaded on the page, and import order becomes semantic.
  - Fix: Make filters and area queries unresolved descriptors, e.g. `defineFilter({ tags: ['uprootable'] })`. The kernel resolves them per world in `create(setup)`, or lazily keyed by catalogHash. Add a lint or Grit rule against reading CATALOG at module scope in simulation and module code.
- **medium**: The fixed restore order and the static crossings cannot handle things that shape water or walkability: dams, bridges, fallen-log fords, walls, ice.
  - Evidence: §4 restore order is 'base, water, navigation, sections, then afterRestore'. Dams, bridges, walls and ice are things or fields that load in sections, after water and navigation are rebuilt. Navigation rebuilds only on height and water versions ($R/src/simulation/agents/navigation.ts `#builtHeightVersion`, `#builtWaterVersion`). §15 recommends crossings as a 'static ThingSource', though the approved crossings rework (fords, logs, tribe-built bridges) needs dynamic ones. Hydrology in core/world/water takes terrain only, so a beaver dam has no input to feed it.
  - Fix: Derived layers (water, walkability, navigation, coast) declare their inputs as field handles and trait keys. They rebuild after all sections load and when an input's change tracker fires. Add the traits `blocksMovement(radius)`, `bridges` and `barsFlow(height)` to feed walkability and hydrology. Make crossings a dynamic group from day one.
- **medium**: Mod data packs and scenario goals cannot be expressed as data, so the roadmap's 'mods add powers and rules' and 'scenarios with goals' have no representation.
  - Evidence: Reactions are `when` and `apply` closures, and powers need stroke handler code. Only threshold transitions are data. `toJSONSchema (for mods)` is mentioned, but no mod schema is defined. The scenario question in §15 ('a catalog round... so data packs need no code') says nothing about goals or triggers. Surroundings is local only (x, z, radius), with no global census such as population per tribe, forest share or burned area that a goal could test. Acid rain as a mod is impossible without code.
  - Fix: Define a declarative tier compiled into the same runtime objects:
- data powers: a brush that stamps fields or exposures, spawning kinds, a strike with a Blow;
- data reactions: `{ drivenBy, when: [{ field, op, value }], then: [{ field, op, amount }] }`;
- parametric looks.

Add a maintained census (counts by kind, tag and tribe, updated on spawn and kill, plus field totals per chunk) and a small condition language for goals and triggers, evaluated at `settle`.
- **medium**: The walkthrough file counts omit core edits that their own text implies.
  - Evidence: B: FieldDefinition has range, rest, snapBelow, storage and lifetime but no decay, so 'decays over days' needs an extra system or reaction. Plants have no health column today (VEGETATION_CHANNELS: bornDay, fruit, height, rotation, seed, species, state, x, z). `acid-sears-canopy` therefore adds health and heat Float32 columns, about 737k slots at 768² ($R/src/generation/world-generator.ts:41 `VEGETATION_CAPACITY_PER_CELL = 1.25`), plus a new PlantState and its visual. The `barren` ground and `Biome.Barren` do not exist ($R/src/content/biomes.ts has 13 biomes, $R/src/content/grounds.ts runs Ash to Tundra). C: no per-cell flow vector exists for 'drifts with the river flow'; terrain has `riverStrength` and `waterSurface`, and rivers are polylines in $R/src/world/water.ts. boat-inspector.tsx also needs a simulation-side inspection builder and an InspectionKind entry. D: the figureTint core hook, an infection channel in the packed people frame, and the undefined column, stat and job APIs.
  - Fix: Make each walkthrough list 'core edits: N' explicitly, and use it as the acceptance test. Add `decayPerDay` (or a half-life) to FieldDefinition, a derived `flow` field, generic thing inspection (kind rows plus module `inspectorRows`), and per-thing tint and visual-state channels in packed frames that modules can claim.
- **medium**: The main-thread read view shares the worker's interface but covers fewer fields. Module fields not mirrored to the main thread fail silently at runtime.
  - Evidence: §4: 'WorldState and WorldMirror both implement the read view.' Module fields such as acid and germs reach the mirror only if their module adds both a FrameSection and a MirrorSection. Through the same CellReader interface, `cells.field(GERMS)` succeeds in the worker and fails on the main thread.
  - Fix: FieldDefinition declares `mirror: 'rows' | 'regions' | null`, and the kernel derives the frame and mirror sections from it. The main-thread reader is typed over `MirroredField` handles only, so tsc rejects reading an unmirrored field in the engine.
- **low**: API ergonomics: there are two names for one concept, visitor objects need a boilerplate `return true`, and every thing visitor has to branch on group.
  - Evidence: Walkthrough A writes through `tick.cells.field("windX")` but reads through `tick.surroundings.cells.property(...)`. Every visitCells or visit call needs `{ visit: (...) => { ...; return true; } }` under the block-body arrow rule. `ThingVisitor(group, slot, distanceSquared)` makes callers switch on group to reach the right columns.
  - Fix: Make the writer extend the reader and expose it once, as `tick.cells`. Add `collectCells(shape, outCells, outDistances): number` and `collect(shape, filter, outGroups, outSlots): number` so callers iterate with plain for-loops. Expose the common columns through `things.columnsOf(group)`, so the physical part needs no branching.
- **low**: Queries accept only discs, but hazards and tribe systems need paths and regions.
  - Evidence: Every ThingQuery method and visitCells takes (x, z, radius). The tornado moves along a segment each tick (`tornadoPositionAt`, $R/src/simulation/powers/tornadoes.ts). Arrows and lava flows are lines. Territory ($R/src/simulation/society/rivalry/territory.ts), lakes and fields are regions, so 'trees inside our territory' cannot be asked.
  - Fix: Introduce `QueryShape = Disc | Capsule | CellRegion`, all with the same tie order, and use it for summaries, tallies and strike.

### Worth grafting

- Surroundings is the single read API: cell reads, area summaries and thing queries, with a guaranteed tie order (distanceSquared, dz, dx; ascending slot), no RNG and no allocation. Both WorldState and WorldMirror implement it.
- The split between field (saved), cell property (derived, never saved) and exposure (one tick, cleared at settle). Writers clamp, snap to rest, keep active sets current and mark dirty rows.
- The uniform physical part (generational handle, x/z/cell/health/heat/flags, ThingSource), while plants keep a specialised SoA store and people keep side tables. No ECS library.
- `strike(context, x, z, radius, Blow)` replaces the per-system damageArea, scare and addZone calls, with push scaled by mass and harm by resistance.
- Reactions walk only the active set of their drivenBy field and draw chance from unitHash(seed, tick, cell, salt). Threshold transitions (quenchesInto, meltsInto, ignitesAt) are data compiled into rules.
- A module is one folder split by side (module.ts, shared/, simulation/, engine/, interface/, locales/), registered through `satisfies { [Id in ModuleId]: X | null }` maps so tsc lists missing sides. No globs, no declaration merging.
- Every walkthrough carries an explicit file list as the architecture's acceptance test. Keep it, and add a mandatory 'core edits' count.
- Save sections carry a schema, reset on failure, write a digest and load in a defined order. Every indexed catalog has a name table with formerNames and a fallback-or-drop policy. WorldBase stops generator changes from breaking saves.
- Frame sections treat a missing key as unchanged, and MirrorSection.apply returns change kinds. Lasting effects become things with frame rows; only instant effects stay in effects.
- Registries derive the UI: PANELS (tab unions, menus, store resets), INSPECTORS with module inspectorRows, THING_PRESENTERS and EFFECT_PRESENTERS serving both rendering and audio.
- A generated sound catalog plus a test that fails on unreferenced sounds. Module-owned locales and icons, with IconSource `{ core } | { url }`.
- A paused tick still applies commands, so brushes and the hand work while paused and replays stay exact.
- A cross-pair call such as rain calling fire.douse is treated as a bug: emitters write fields or exposures, rules turn fields into fields, and things respond through their traits.

## Migration — 4/10

The target design is sound and most of its counts check out against $R: 151 hypot and 43 hashToUnit sites in deterministic code, 14 damageArea and 5 scare calls, the duplicate seed*19+7, the 12 terrain layers, the z.custom check that throws away its parsed output, snapshot() returning null, setViewFocus, and the hand-kept hasLandChanged list. The migration is the weak part. It does not match how this repository actually ships:
- Every push to main deploys.
- Main has no branch protection and no merge queue.
- Several releases go out per day.
- Merges land in almost every hour from 07:00 to 01:00.

Specific problems:
- Two groups are marked as changing neither hashes nor saves when they do: G7 (lava as a field) and G11 (modules run after core systems).
- Two "groups" are far too big to be single mergeable, verifiable steps: G2 moves about 858 files, and G9 rewrites the people, animal, building and plant stores at once.
- The release batching it relies on cannot happen when every merge deploys.
- Save shape changes are marked compatible ("S") but no mechanism is given. Saves today are structured clones of in-memory objects, and the owner rejects per-version migrations.
- The lane dependencies are missing G12 and G13 as prerequisites of the module lane, and they put the D lane's codemods on the same files the K lane is rewriting.
- The effort is underestimated by about 2×.
- The owner's headline goal, context queries, arrives only after five serial groups.

The plan can be saved if it puts hash-neutral facades first, moves each file once by an explicit move map, fixes saved forms early behind one frozen legacy reader, and turns on merge protection for the migration.

### Strengths

- Every group has an explicit impact column (H/S/–) and a verification criterion, and a safety net comes first (pinned generation and 600-tick hashes; acceptance: 'a 1% erosion change fails'). That is the right skeleton.
- Most quantitative claims about today's code are accurate. Verified: 151 hypot (simulation 106, generation 37, world 8), 43 hashToUnit sites, 14 damageArea and 5 scare calls, seed*19+7 duplicated in generation/wetlands.ts:365 and rock-strength.ts:12, 12 TerrainData layers (16 MB raw at 640²), the z.custom check that throws away its parsed output (saved-world.ts:115), snapshot() returning null when busy (simulation.ts:271), OLDER_SAVE_PLANT_SPECIES, and main-thread value imports of tornadoPositionAt and grab-target.
- WorldBase before any generation hash change is the right instinct. Today every generation change breaks saves through the fingerprint and 'land changed' path.
- Scripted, re-runnable moves (ts-morph plus a move script), and depcruise and Grit starting in report mode with offender lists, are the right way to tighten rules gradually.
- It recognises that plants and people must keep specialised storage, so the store is not forced into one uniform ECS.
- Its risk list is honest about hash churn, exact-math speed, WorldBase size and having two sources of truth for people.

### Findings

- **high**: G7 (lava as a field) and G11 (one PR per module) are marked as changing neither hashes nor saves, but both change hashes, and G7 changes the save shape.
  - Evidence: Lava is a per-volcano Map<number, number> (simulation/powers/volcanoes.ts:65). A volcano is finished when `volcano.lava.size === 0` (:101). `#lava()` merges overlapping volcanoes with Math.max (:578-588). `SimulationSnapshot.volcanoes?: Volcano[]` saves those Maps (simulation.ts:91, 497-501). One global `lava` field loses ownership, which changes behaviour, hashes and saves. For G11, the proposal says 'Systems run in CORE_SYSTEMS order, then MODULES order'. Today tornadoes and volcanoes run in the middle of nature, after embers and before surface and growth (simulation.ts:747-750), and they draw from the shared `this.random` (tornadoes.ts:71,94,144). Turning them into modules puts them after core systems in their phase, which reorders state reads and RNG draws.
  - Fix: Mark G7 'H S' and move the lava field into the G8–10 hash batch, with per-volcano ownership kept as a side table. Make G10 place every future-module system at its final slot (the end of its phase), so that G11 extractions really are hash-neutral. Add a test that fingerprints the system order: it lists system ids per phase, so any reorder fails loudly.
- **high**: Batching hash changes into 'one minor release' is impossible here, and the repository has no merge protection for an XL migration.
  - Evidence: .github/workflows/ci.yml deploys production on every push to main. Releases 0.8.1, 0.8.2, 0.8.3, 0.9.0, 0.9.1 and 0.10.0 were all merged on 2026-10-30. `gh api .../branches/main/protection` returns 'Branch not protected': no required checks, no up-to-date requirement, no merge queue. Over 30 days the merge histogram shows merges in every hour from 07:00 to 01:00. Groups 5+6 and 8+9+10 sit in different lanes (D/K, Q/K), so they reach players as separate deploys.
  - Fix: Drop the batching premise for simulation-only hash changes; they don't break saves. Gate only generation-changing PRs behind WorldBase. Where atomic landing matters, use the repository's existing integration-branch pattern explicitly (audit3/* → refactor/0.8.2-cleanup → one PR). For the migration's duration, enable required status checks and a GitHub merge queue so that semantic conflicts, such as a new file importing an old path, cannot turn main red and stop deploys.
- **high**: Save shape changes have no mechanism. 'S' is asserted for G9 without saying how old snapshot shapes load, and the owner forbids per-version remaps.
  - Evidence: Saves are structured clones of in-memory objects, checked only by a z.custom shape test (saved-world.ts:80-117): `society.people[].mover.{x,z}` (float64), `world.vegetation.x: Float32Array`, `volcanoes` Maps, and absolute animal and building health (`ANIMALS[kind].health` at fauna.ts:444, `BUILDINGS[kind].health` at buildings.ts:185). G9 changes all of these: Float32 x/z columns, health on a 0–1 scale, monuments moved out of vegetation slots (monument-damage.ts:193-232 treats pieces as plants and hashes by plant index at :232). Each change needs a reader for the old shape.
  - Fix: In G3/G4, define a stable saved form per section that is decoupled from the memory layout: records keyed by name with per-field defaults. Write ONE frozen `legacy-snapshot` reader for pre-section saves and never extend it. After that, later groups may only add defaulted fields to saved forms. Keep position columns as Float64Array (or save float64) so positions stay exact. Add save fixtures per save epoch, not per release: pre-fingerprint (null → the doRiversFollowTerrain heuristic), pre-plantSpecies-table, pre-volcanoes, and 0.10.
- **high**: G2 moves every file into five layers in '4 scripted PRs in one quiet hour'. It is the riskiest step, it is mostly cosmetic, and its verification ('screenshots identical') misses its main failure modes.
  - Evidence: There are 555 source and 303 test files, all with relative imports (research/boundaries.md: 4,595 edges, no aliases). The largest PR in history touched 383 files (#237). PR median life is 2.5 minutes, but agents work for hours in worktrees, and all of those break. ts-morph `move()` does not rewrite the 118 `new URL(..., import.meta.url)` literals: the worker entry in game/simulation-connection.ts:42 and about 110 sounds in audio/sound-catalog.ts. Breaking them is invisible to typecheck and to screenshots. `.claude/workflows/ship.js:151-153` picks full or light review from the `src/simulation|world|generation|game` paths, so after the move, auto mode silently downgrades simulation changes to light review. biome.jsonc overrides, vite.config (src/features/testing/browser-setup), scripts/encode-sounds.ts, AGENTS.md and README also hard-code paths. The research found that R1–R3 need only 18 moved files and one retyped import.
  - Fix: Split G2. (a) The 18-file cycle fix (S, no hash change, mergeable any time). (b) Folder-by-folder PRs, each moving files directly to their FINAL location, so tornadoes.ts goes once to modules/tornado/simulation instead of to systems/ and then to modules/. Keep a committed `moves.json` with an `apply-moves` script that rebases in-flight branches. Rewrite `new URL` literals and add a test that every one resolves. Update ship.js, agents, docs and biome in the same PR. Add a CI guard that fails when files reappear under old folders. Run it in the 02:00–06:00 window and freeze worktrees for half a day, not an hour.
- **high**: G9 is an XL 'group' that is not one mergeable, independently verifiable step, and it sits in the hottest feature area.
  - Evidence: Society is 11,427 lines in 75 files. There are 431 `mover.` accesses in 38 source files plus 205 in 22 test files. Mover has 20 fields (agents/movement.ts:28-49): path, hop, nearbyObstacles and splash. The three damageArea implementations differ in semantics: a core radius for people and animals, per-second damage, and a building flag (tornadoes.ts:132-135). The roadmap's 'deeper tribes' and tribe-built bridges both land in society during this period. 'Mover becomes a view over the columns in one PR' with '#242 and hand tests unchanged' cannot both hold once positions turn float32.
  - Fix: Split G9 into at least 6 PRs: (1) ThingSource adapters over today's stores (read-only, no hash change); (2) spatial buckets over the adapters (no hash change); (3) a strike facade that calls the existing damageArea, scare and addZone exactly (no hash change); (4) column migration one store at a time, buildings first and people last (H S each); (5) the monument split through the legacy reader; (6) unified strike constants (H). Announce a society feature freeze only for step 4's people PR.
- **medium**: The lane dependency graph is incomplete. The module lane collides far beyond 'sorted registration lines', and G6 runs alongside K on the same files.
  - Evidence: Volcano and lava appear in 25 non-test files, including simulation.ts, frame.ts, frame-builder.ts, frame-packing.ts, simulation-worker-api.ts, world-renderer.ts, terrain-material.ts, society.ts, person.ts and sound-catalog.ts. Tornado appears in 16. A module's engine and interface sides need RenderLayer, presenters and audio parts (G12) and panel, icon and locale registries (G13), but lane M is gated only on G10. Any extraction that re-pins golden hashes conflicts with every parallel extraction. G6's codemod touches about 350 non-exact sites across simulation, generation and world while K rewrites simulation.ts, fire, tornado, volcano and society.
  - Fix: Gate M on G3, G4, G10, G12 and G13. Extract the tornado alone first as a pilot, count the files it touches, then fan out. Keep golden hashes in per-seed files regenerated by `bun run hashes`. Ship the exact-math replacement as a Grit rewrite applied on every PR, so K's new code is written exact from the start. Land named streams (G6, simulation part) before G3's system list, so later reorders don't shift draws.
- **medium**: WorldBase protects only saves that are opened between the G4 deploy and the first generation-changing deploy.
  - Evidence: §9: 'Old saves: regenerate and compare the fingerprint. On a match, attach a base.' That happens on load only. G6 changes generation: per-stage createRandom(seed*K+C), 12 hashToUnit sites, 49 trig calls and 37 hypot calls in generation. Approved feature plans (terrain realism v2, crossings rework) also change generation, outside the migration lanes.
  - Fix: On the first app start after G4, walk every IndexedDB save in the background and attach bases. Hold all generation-changing PRs, including terrain v2 and crossings, for a fixed window after G4 ships. State in AGENTS.md that generation changes require WorldBase to be live.
- **medium**: The composite tsconfig split ignores colocated tests that cross layers.
  - Evidence: 36 main-thread test files or helpers import simulation or generation directly: game/testing/local-session.ts, rendering/testing/agent-scene.ts and vegetated-mirror.ts, features/testing/world-fixtures.ts, audio/*.test.ts, game/tools/hand-tool.test.ts and others. With references 'engine → core, modules/*/shared', they no longer compile.
  - Fix: In G1, add per-layer test projects (or one `tests` project that references all layers), exclude `*.test.*` and `testing/` from the layer projects, and give dependency-cruiser the same exemption.
- **medium**: G5 silently changes pause behaviour that plan.md deliberately kept.
  - Evidence: Today water recomputation, strokes and tasks run on real seconds before the tick loop (simulation.ts:506-509), so terraforming while paused settles water at once. In the proposal, tasks become dueTick, 'lake filling counts ticks', and a paused runTick returns without incrementing clock.tick. Water settling and scheduled tasks stall while paused. plan.md:141-146 says 'Water settling stays frame-driven'. StampedCommand {tick, player, command} also has no sequence number for several command batches applied on the same paused tick.
  - Fix: Have paused advances run a settle phase, or keep a sub-tick sequence for commands, and add `sequence` to StampedCommand. Add a browser test: terraform while paused, then check that water updates.
- **medium**: Golden CI in '5 engines' on Linux runners does not cover iOS or macOS Safari.
  - Evidence: research/determinism.md:9: JavaScriptCore calls std::sin, cos, exp, log, atan2 and hypot from the platform libm. Playwright WebKit and Bun on ubuntu-latest use glibc, not Apple's libm, so a forgotten Math.sin passes CI and still desyncs iPhone players.
  - Fix: Add a macOS runner job (nightly if cost matters) that runs the golden replay under Bun and WebKit. Keep the Grit ban as the primary guard and the cross-engine run as a backstop. Use small grids: the fingerprint test already needs a 60 s timeout at 128².
- **medium**: Effort and scope are underestimated, and the owner's headline goal arrives last.
  - Evidence: The proposal says 45–55 PRs for the moves and 30–45k changed lines. plan.md budgeted 4–6 weeks for 38 PRs with a smaller scope. Lingui is sized 'L', but there are about 776 content name, description and label strings, 152 chronicle `text:` sites in the simulation (which change the chronicle save shape) and 63 TSX files. zod/mini means 291 `z.` calls in 15 files, including save schemas, moved from methods to the functional API. Saving jobs means 21 job kinds in simulation/society/jobs, each needing a schema. Surroundings (G8) arrives only after G2→G3→G5→G7 on the serial K lane.
  - Fix: Re-estimate at roughly 95–140 PRs and 50–70k changed lines including tests. The critical path G0→1→2→3→5→7→9→10→(12,13)→11 is about 9 serial groups, 8–12 weeks. Ship a read-only `Surroundings` facade over today's stores right after G0: no RNG and no ported callers, so no hash change. Port callers later in the hash batch. Take Lingui and zod/mini out of the architecture migration as separate projects.
- **low**: Some churn has no architectural payoff, and some counts are slightly off.
  - Evidence: Renaming worker/→server/ and tests/→e2e/ touches wrangler.jsonc, playwright.config.ts, tsconfig.node.json, `bun run shots` (tests/shoot-scenes.ts), AGENTS.md and the ship workflow. '34 isTree/Shrub/Rock/MonumentSpecies calls': I count 26 call sites plus 4 definitions in non-test source (46 including tests). G3 says 'today's order as phases', yet the target PHASES put tornado (emit) before fire (nature), the reverse of today's order, so G3 must use a temporary phase mapping. The proposal doesn't say so.
  - Fix: Drop the server/ and e2e/ renames. State that G3 uses a degenerate phase mapping that reproduces today's order, and that the real PHASES arrive in G10 (H).

### Worth grafting

- A per-group impact column (H, S or –) with a concrete verification, enforced by a test: pinned generation and 600-tick hashes, plus save fixtures for each save-shape epoch (pre-fingerprint, pre-plantSpecies-table, pre-volcanoes, current).
- Safety net first, with the acceptance test 'a 1% erosion change fails'. Small grids for the cross-engine replays.
- Hash-neutral facades before storage changes: a read-only Surroundings over today's stores, ThingSource adapters, and a strike facade that calls the existing damageArea, scare and addZone exactly. Storage and constant changes come later, as explicit H PRs.
- Each file moves once, directly to its final location, driven by a committed moves.json plus an apply-moves script that also rebases in-flight agent branches. Rewrite `new URL(..., import.meta.url)` literals and add a test that each one resolves. Update ship.js path routing, agents, AGENTS.md and biome in the same PR. A CI guard fails if files reappear under old folders.
- Split G2: first the 18-file cycle fix from research R1–R3 (small, mergeable any time), then folder-by-folder layer moves in the 02:00–06:00 window.
- For the migration: required checks plus a GitHub merge queue on main, and the repository's integration-branch pattern (audit3/* → refactor/*) for anything that must land atomically.
- One stable saved form per section, decoupled from the memory layout, behind a single frozen legacy-snapshot reader that is never extended. Later groups may only add defaulted fields.
- WorldBase before any generation change, with eager background attachment of bases to every IndexedDB save on first start, and a hold window for generation-changing feature PRs (terrain v2, crossings).
- A test that fingerprints system order per phase. Named per-system streams land before any reorder, and G10 places future-module systems at their final slots so module extraction is hash-neutral.
- Golden hashes in per-seed files regenerated by a script, so parallel PRs resolve conflicts by re-running it instead of hand-merging.
- A macOS runner for the JSC/Apple-libm golden replay, in addition to Linux Chromium, Firefox and WebKit.
- Per-layer test tsconfig projects (or one tests project) so colocated cross-layer tests keep compiling after the composite split.
- Keep positions in Float64 columns, or save them as float64, so the thing-store migration doesn't change movement math through float32 truncation.

## Simplicity — 5/10

The five-layer tree answers the owner's complaint that the current tree is "flat and huge". The registries, the derived cell properties and `strike` are good ideas. But the proposal replaces a flat tree with a large number of concepts. By my count an agent must learn about 85 named abstractions. plan.md has about 20.

The worst cost is the number of ways one thing can affect another. I count at least ten coupling channels: field writes, exposures, explicit reactions, implicit threshold transitions, traits, `strike`, `disturb`, events with per-phase listeners, stat modifiers and scheduled tasks. The tornado walkthrough uses three of them at once, which contradicts the proposal's own principle 3.

The layering also contradicts itself in several places:
- `core/protocol` needs types that only exist after modules are composed.
- `kernel`, the lowest simulation sublayer, defines `TickContext`, which holds types from higher sublayers.
- Modules build filters from a global `CATALOG` at import time.
- Traits and reactions, which are behavior, sit under `state/`.

The generic `ThingStore` would rewrite people and animals as columns plus side tables. A few thousand rich objects have no performance need for this, and the `ThingSource` interface alone delivers the uniform queries. Layer enforcement uses three separate tools plus an 11-row rules table, and the claim that `tsc` blocks `three` in the worker is false. Registering a module goes through five files.

Keep the tree, the registries, the field writers, the derived properties, `ThingSource` and `strike`. Cut the channels, the generic store, the summary struct, the per-tag block counts and the extra tooling.

### Strengths

- Five top-level folders (core, simulation, engine, interface, modules), each with a few sublayers. This answers the owner's complaint that plan.md is "huge and flat". The interface split (design, stores, panels, pages, app) is a known bulletproof-react shape.
- It argues against its own stance with numbers. Plants keep the specialized SoA store. ECS is rejected over memory and spawn cost and because its serializers remap ids. Uniformity is limited to the physical part of things.
- Registries are records keyed by closed id unions with `satisfies`, so `tsc` lists missing entries. No globs, no declaration merging, no topological sort. `POWER_ORDER` stays hand-written, which is the right call for a design choice.
- Field writers that clamp, snap to rest, keep the active `CellSet` current and mark dirty rows remove a whole class of raw-write bugs.
- `defineCellProperty` for `biome`, `flammability` and `airTemperature` is derived on read and never saved. The `biome` property knows about lava and water, which directly answers the owner's tornado example.
- `strike(context, x, z, radius, blow)` merges 14 `damageArea`, 5 `scare` and 5 `addZone` calls into one. I verified the counts in `src/simulation`.
- The walkthroughs count files and registration lines. This makes the cost of the architecture measurable, and it is how I could find the registration fan-out.
- The factual claims I checked against `$R` hold:
- 151 `Math.hypot` calls in deterministic code: 8 in world, 37 in generation, 106 in simulation.
- About 44 `hashToUnit` calls in deterministic code.
- Lava is a `Map` (`volcanoes.ts:65`).
- The duplicate `seed * 19 + 7` is real (`wetlands.ts:365`, `rock-strength.ts:12`).
- `z.custom` in `saved-world.ts:116`.
- `src` has 13 top-level folders.
- Small errors: `addZone` has 5 call sites, not 6. The `isXSpecies` count of 34 includes the 4 definitions.

### Findings

- **high**: Too many coupling channels. An agent must choose among about 10 ways for one element to affect another, and the walkthroughs mix them. This breaks principle 3 ("Elements meet through cells... a per-pair call is a bug").
  - Evidence: The channels are: field writes, exposures (`lifetime: "exposure"`), explicit `Reaction`s, implicit threshold transitions (`quenchesInto`, `meltsInto`, `ignitesAt` compiled into hidden rules), traits, `strike(Blow)`, `things.disturb`, events with `EventListener { kind, phase }`, `effective("energy", person)` stat modifiers (walkthrough D, defined nowhere else) and `schedule`. In walkthrough A the tornado writes the wind exposure, then calls `things.disturb` on uprootable things, then calls `strike` with push and swirl. `strike.heat` duplicates the heat field and the `flammable` trait. To learn what a tornado does, an agent reads the module, two core reactions, two traits and `strike`. By rough count the proposal names about 85 concepts; plan.md names about 20 (Field, Reaction, CellInputs, respond, SimulationModule, SaveSection, FrameSection, THING_SIMULATION, THING_ENGINE, TerrainLayer, phases…).
  - Fix: Write a three-row decision table into the plan and keep only these channels:
(1) Element on element goes through cells: fields, exposures and explicit reactions.
(2) Area on things goes through `strike`. Add `uproot` to `Blow` and drop `disturb`. Things never read wind.
(3) Facts for the chronicle, effects and module listeners go through events.
Threshold transitions become explicit entries made by a `transition()` helper and listed in `REACTIONS`, so every rule is greppable. Defer stat modifiers until sickness actually ships. State principle 3 honestly: cells for chemistry, `strike` for force.
- **high**: The layer graph contradicts itself in four places. Composed things (the frame type, the event union, death causes, `CATALOG`) are needed below where they are composed, and `kernel` depends on higher sublayers. The result is import cycles and ESM TDZ hazards that the proposed `no-circular` rule would reject.
  - Evidence: 1. `core/protocol` holds the frame envelope and events. But `SimulationEvent = … | ModuleEvent`, the frame is "mapped from the registries", and `thingKilled.cause: DeathCauseId` is "derived from the catalog", which `compileCatalog` builds from `MODULES`. All of these come from `modules/*`, which in turn import `core`.
2. `const UPROOTABLE = createThingFilter(CATALOG, …)` and `const PEOPLE = createThingFilter(CATALOG, …)` are top-level constants in module simulation files. They import a compiled global `CATALOG`, which imports `MODULES`, which imports the same module's `module.ts`. That is a value cycle evaluated at import time.
3. The rules say `kernel` is the lowest sublayer (`kernel → state → context`). Yet `TickContext`, defined in kernel, holds `Surroundings` (context), `CellWriter` and `ThingWriter` (state), and `runTick` calls `contextFor` to build them.
  - Fix: Name a composition layer explicitly, for example `src/assembly/` or `modules/registry/`. It sits above `core` and `modules/*/{module.ts,shared}` and below simulation, engine and interface. It owns `MODULES`, `CATALOG`, `DeathCauseId`, the event union and the frame type. Keep `core/protocol` generic over section maps. Build filters inside `create(setup)` from `setup.catalog`, never at import time. Move `TickContext` and `contextFor` to the top of the simulation stack (`simulation/worker` or `context`), so the kernel only runs `(tick) => void` steps.
- **high**: The generic `ThingStore` (columns, side tables, generational handles) rewrites people and animals without any performance need. It is the largest single cost in the plan: group 9 is XL, with "two sources of truth for people".
  - Evidence: `Person` (`src/simulation/society/person.ts:46`) has 27 fields, among them `job`, `carrying`, `weapon` and a nested `Mover` (`agents/movement.ts:28`, 20 fields including `path: Waypoint[]` and `nearbyObstacles`). `Animal` (`fauna/fauna.ts:55`) has the same shape. They number in the thousands, not hundreds of thousands. Monotonic ids already exist through `IdentifierSource`, and the snapshot already saves `identifiers`. The proposal already defines `ThingSource { columns, isLive, kindOf, forEachInCell }`, which is all that queries and `strike` need.
  - Fix: Keep `ThingSource` as the uniform contract and implement it as adapters over the existing Society, Fauna, Buildings and Vegetation stores. `columns` can be views kept in sync, or getters. Keep monotonic ids and drop generational packing. Add a small store for transients (embers, tornadoes, meteors) only when they need to be queried. This turns group 9 from XL into M and removes risk 4.
- **medium**: Layer rules are enforced by three tools with an 11-row table, and one stated guarantee is false: a composite tsconfig does not stop a worker file from importing `three`.
  - Evidence: The tools are four composite tsconfig projects, Biome `noRestrictedImports` plus `noRestrictedGlobals` plus a GritQL plugin, and dependency-cruiser 18.7 with `@swc/core`. TS6307 applies only to source files outside a project's `include`. `.d.ts` files resolved from `node_modules` are always allowed, so `import "three"` compiles in any project. The `*-api.ts` facade rule for sibling systems is one more convention to learn: today there are about 90 cross-system imports between `src/simulation/{agents,fauna,hand,nature,powers,society}`, mostly `agents/navigation` and `agents/movement` for types such as `Waypoint`. It is also unclear whether "sibling" means `systems/life` vs `systems/nature` or `life/society` vs `life/navigation`.
  - Fix: Use a tsconfig project only where compiler options differ: the engine side with `noUncheckedIndexedAccess` off and the interface with it on (2–3 projects). Use Biome `noRestrictedImports` for layers and packages, as today. Use Grit for determinism. Add dependency-cruiser only if module-to-module leaks actually appear in review. Drop the `*-api.ts` rule. Move shared types such as `Waypoint` down into `core`, and let systems talk through state, context and events.
- **medium**: Registering a module needs more places than a power needs today, including required `null` entries.
  - Evidence: Acid rain lists six lines in five files: `modules.ts` (MODULES and POWER_ORDER), `simulation-modules.ts`, `engine-modules.ts`, `interface-modules.ts` (with a `null` entry) and `e2e/scenes.ts`. The boat has five, sickness five. The brief says a power today registers in four places. The owner asked for "one folder plus a typed registration".
  - Fix: Make records exhaustive only where a missing entry is a bug: simulation and engine. Make interface sides optional (`satisfies Partial<…>`), or flag them in `module.ts`. Make scenes opt-in. Target: `MODULES`, `POWER_ORDER` and one record per thread, with no `null` lines.
- **medium**: Modules split into too many files: six fixed subfolders and per-side wiring files, even for small features.
  - Evidence: Acid rain is 17 files for a brush that stamps two fields: `shared/acid-frame.ts`, `simulation/acid-field.ts`, `acid-reactions.ts`, `acid-rain-power.ts`, `acid-rain-simulation.ts`, `engine/acid-rain-engine.ts`, `acid-rain-cue.ts`, two `locales/*.po`, and more. Every module is laid out as `module.ts, shared/, simulation/, engine/, interface/, locales/`.
  - Fix: A side folder exists only when the side has code. A small module may keep its field, reactions and power handler in one `simulation/<name>-simulation.ts`. The frame payload type goes in `shared/` only when there is a frame section. Put a guideline in the plan: split a file only when it passes about 300 lines or has a second reader.
- **medium**: The tree overloads its names. Behavior also sits under `state/`, which contradicts principle 2 ("behavior in systems").
  - Evidence: `core` means three things: the top layer, "CORE_SYSTEMS" and `engine/render/core`. `terrain` is used for `core/catalog/terrain`, `core/world/terrain` and `TerrainLayer`. `life` is used for `catalog/life`, `systems/life` and the `life` phase. `world` is used for `core/world`, `state/world-state.ts` and `WorldMirror`. Traits ("core systems that iterate their members") live in `simulation/state/things/traits/`, and reactions in `state/cells/reactions`. Paths reach depth 5 under `src/`, for example `src/simulation/state/things/traits/flammable.ts`. `context/` is a whole sublayer for one interface family.
  - Fix: Give each word one meaning: for example `catalog/land` instead of `catalog/terrain`, and `render/frame` or `render/base` instead of `render/core`. Move traits and reactions to `simulation/systems/{traits,reactions}`. Fold `context/` into `state/` as `state/queries`. Keep paths at most 4 levels deep under `src/`.
- **medium**: `AreaSummary` is a fixed struct that every caller pays for in full. A module's own field cannot appear in it without editing core. It overlaps with `things.count` and `visitCells`. The per-tag block counts behind it are a speculative index on the store with the most churn.
  - Evidence: The struct holds `biomeShares`, `tagCounts`, `tribeCounts`, `waterShare`, `burningCells`, `maximumFire` and `meanHeat`, all filled on every `summarize`. Walkthrough A calls both `summarize`, which already has `tagCounts`, and `things.count(CONIFERS)`. The 16×16 block counts per tag must be kept current for up to 500k plants with "constant churn". The tornado radius is about 113 cells, and the proposal itself says "a few block reads, about 113 cells", so a plain scan is cheap.
  - Fix: Drop `AreaSummary` and the block counts for now. Offer `fieldStats(name, x, z, radius, out)` (max, mean, count above a threshold) and the thing queries. Add block counts only when a bench in group 0 shows a caller over budget, for example ambience at the camera.
- **medium**: Things are classified along four axes, and the query and cell-read APIs repeat that overlap.
  - Evidence: Things have a group (`ThingGroup`), a kind, tags (a `Uint32` mask) and traits, and `ThingFilter` has five fields (`groups`, `tags`, `kinds`, `tribe`, `includeHeld`). `ThingQuery` has five methods: `any` is `count > 0` and `collect` is `visit` into an array. `CellReader` has three read paths: `field(name)`, `property(name, cell)`, and special methods `height`, `slope`, `ground`, `hasWater`. Biome is a property, but ground (also derived: ash, basalt) is a method. `TickContext.cells` (the writer) collides with `surroundings.cells` (the reader) in the same destructuring in `rage`.
  - Fix: Make tags the only query axis. A group and a kind compile to implicit tags (`group:person`, `kind:oak`), and a trait implies its tag. Reduce `ThingQuery` to `visit`, `count` and `nearest`. Read stored arrays through `field()` on hot paths, and every other cell fact (height, slope, ground, biome, water, flammability) through `property()`. Rename the writer to `write` or `edit`.
- **medium**: The split between core and modules is undecided for several listed modules, and modules cannot reach the systems they extend.
  - Evidence: `lightning/` is a module, but natural lightning comes from core weather (`simulation.ts` `#strikeNaturalLightning` calls `strikeLightning` from `powers/catastrophes.ts`). `wildlife/` is a module, but fauna is the core `systems/life/fauna`. The rules table lets `modules/*/simulation` import only `kernel`, `state` and `context`, so a wildlife or healer module cannot spawn animals or reach society. `ModuleSetup` is never defined.
  - Fix: Write down which current systems are core and which are modules, one line each. Define `ModuleSetup` as the narrow API modules get: spawn, kill, chronicle, effects, schedule and so on. Natural lightning either stays core or becomes a weather event that the lightning module listens to.
- **medium**: `module.ts` lives in the core project, which both threads import, yet it carries interface-only data.
  - Evidence: `ModuleDefinition` has `messages: MessageCatalogs`, and the acid rain module lists an "icon key" in `module.ts`. `module.ts` is imported by `MODULES` and `compileCatalog`, which the worker uses, so the worker bundle would pull in the locale catalogs. The worker only needs `{ id, values }`. Lingui adds five packages and two `.po` files per module. Localization is a separate decision from structure.
  - Fix: Limit `module.ts` to ids, numbers, zod schemas and catalog rows. Messages and icons go on the module's interface side. Treat Lingui as its own roadmap item, not part of the restructure.
- **low**: The TypeScript sketches break CONTRIBUTING and codebase conventions in small ways and carry boilerplate.
  - Evidence: 1. `SOAK_DOUSES_FIRE` orders its keys `drivenBy, emits, id, apply, when`. The codebase sorts keys alphabetically, functions included (`grab-handlers.ts` `plantGrab`; `simulation.ts` `#createServices` puts `schedule` between `rules` and `tornadoes`), and the boat example in the same proposal follows that.
2. Destructuring is unsorted: `{ phases, events, clock }` and `{ surroundings, cells, things }`.
3. `progress(tick, columns, germs, slot)` puts options before the subject, against "context, then subject, then options".
4. `tick.emit({ kind: "fireWhirl" })` is not in the event union.
5. Required empty fields: `formerNames: []`, `deathCauses: {}`, `grounds: []`, `tags: {}`, `heat: 0`, and seven required members on `SaveSection` with `| null`. The codebase uses optional fields, such as `RouteOptions` in `movement.ts`.
6. "`z.looseObject` with per-field `.default()`" is not `zod/mini` syntax (`z._default`).
7. `SimulationModule` has no `id`, so `SIMULATION_MODULES` could map `rain` to `snowSimulation` without a type error.
  - Fix: Sort keys and destructuring alphabetically. Use the order context, subject, options. Make empty catalog contributions optional under `exactOptionalPropertyTypes`. Add `id: Id` to `SimulationModule` and check that each key equals its value's `id`. Write schemas in `zod/mini` syntax.
- **low**: Some machinery is built for mods, scenarios and lockstep that do not exist yet.
  - Evidence: `compileCatalog` runs three rounds (base, modules, "final fixes") and produces a `catalogHash`. Events are merged per 16×16 block and drained after each of seven phases, with listeners bound to phases, all for about eight glue facts (`#landEmber`, `#recordBuildingIncidents`, `#recordSplashes`, `#settleNewWater`, the weather chronicle, lightning, the ember launch, `#keepAgentsApart`). Every system also gets a `cadence`.
  - Fix: Merge the catalog in one round and add rounds when mods land. Drain events once at the end of the tick in emission order; phase-bound listeners can come when a real ordering need appears. Drop `cadence` until a system needs it; today the only throttles are navigation every 50 ticks and crowding every 2.

### Worth grafting

- Five top-level folders (`core`, `simulation`, `engine`, `interface`, `modules`), each module split into per-thread side folders that exist only when the side has code. Paths at most 4 levels deep under `src/`.
- A named composition layer (`assembly` or `modules/registry`) that owns `MODULES`, `CATALOG`, the event union, death causes and the frame type, so core never needs module types.
- Records keyed by closed id unions with `satisfies`, so `tsc` lists missing entries. Exhaustive only for the simulation and engine sides. `POWER_ORDER` hand-written.
- `FieldWriter` (`set`, `add`, `scale`) that clamps, snaps to rest, keeps the active `CellSet` and marks dirty rows. Raw field writes banned.
- Derived cell properties (`defineCellProperty`) for `biome`, `flammability`, `airTemperature`: read-only, never saved. Lava becomes a field.
- Two cell read paths only: `field()` for stored arrays on hot paths, `property()` for every other cell fact.
- `ThingSource` as the uniform contract over the existing stores, with shared read columns and tag masks per kind. Tags are the only query axis; groups and kinds compile to implicit tags.
- `strike(context, x, z, radius, Blow)` as the single area-on-things call (harm, push, swirl, heat, fright, uproot, danger), replacing `damageArea`, `scare` and `addZone`.
- A three-channel coupling rule: cells and reactions for chemistry, `strike` for force on things, events only for facts to the chronicle, effects and module listeners.
- A determinism contract for queries: radial order `(distanceSquared, dz, dx)`, ascending slot order within a cell or bucket, no RNG and no allocation.
- Frame and save sections assembled from registries: a missing key means unchanged, transfers come from `buffersWithin`, and mirror sections return change kinds.
- Walkthrough accounting (files and registration lines per new power, kind or panel) as an acceptance metric for the final plan.
- Package removals: `comlink`, `react-markdown`, `remark-gfm`. Switch to `zod/mini` (measured at about 37 kB gzip less across the two bundles).
- A Grit determinism plugin in warn mode with an offender list, switched to error after the exact-math codemod.
