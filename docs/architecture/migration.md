# Migration

How the code gets from today's layout to the target in [Structure](structure.md): the rules every PR follows, the
performance budgets, the move script, the phases as PR-sized steps, and the lanes they run in. Each step has an id
(`0.1`, `S3`, `M5`, `K3`, `D5`, `L1`…) that `/ship` and agents cite. Main deploys green through every step.

## Rules for every PR

- **Checks.** Every PR passes `check`, `typecheck`, `knip`, `test` and `boundaries` (`boundaries` arrives in
  [0.4](#phase-0-safety-net)). It keeps the `save, load, run N` property and, from S2 on, every fixture loading. Each
  step's definition of done includes its docs and tooling: AGENTS.md, CONTRIBUTING, the README code map,
  `.claude/agents`, review rules and `ship.js`.
- **Hash-neutral by default.** A hash-neutral PR leaves the section digests unchanged; section digests are the
  per-section state hashes described in [Hashing](determinism.md#hashing). CI computes them at the merge base and at
  the head, for seeds 3, 7 and 11 on small grids, over 10 game days at the shortest day length, with a scripted log
  that casts every power and saves and loads halfway. It compares only the sections and keys present on both sides;
  new keys must hold their defaults.
- **Hash changes are labeled.** A PR that changes digests carries the `hash-change` label and a "Hash change:"
  sentence in its body before `Verified:`; the body becomes the merge commit body. CONTRIBUTING gets that line in 0.4.
  Hash-changing PRs merge one at a time. A push-to-main job compares the `main^1` and `main` digests against the merged
  PR's label.
- **Committed hash files** exist only for generation fingerprints, and are re-pinned under the `hash-change` label.
- **Generation-changing PRs** (relief phases, terrain realism v2, the crossings rework) don't wait for any step
  ([decision 8](decisions.md#owner-decisions), [the world base](saves.md#the-world-base)).
- **World-changing releases.** Every merge deploys, so PRs can't be batched into a release. Simulation-only hash
  changes break no save and need only a line in the next release notes. A release that changes worlds raises the
  minor version, as CONTRIBUTING says. Where several PRs must land at once, they go through an integration branch
  (`migration/<phase>`) merged as one PR.
- **Merge protection.** The repository stays user-owned, so GitHub's merge queue is not available. Instead, main is
  protected by required status checks, "require branches to be up to date" and a lock-label check, so a new file
  importing an old path can't turn main red. The owner sets this up before the first move PR
  ([decision 4](decisions.md#owner-decisions)).
- **Benches.** Gated PRs (kernel, fields, queries, rules) run allocation counts and a same-runner A/B of merge base and
  head, gated on the median of N runs. The absolute [budgets](#budgets) run nightly, on a fixed runner and in JSC
  through Bun.

## Budgets

The budgets start from a measured baseline: 640², seed 7, about 1,000 agents, 0.7–1.2 ms per tick, 4.6–8.8 ms per
advance at speed 16, a worst advance of 300–520 ms, and frames of 76–372 KB. An advance is one worker call that runs
up to 40 ticks and returns one frame ([Messages](bridge.md#messages)).

| Measure | Budget |
| --- | --- |
| p95 tick, 5,000 agents, 2,000 burning cells, 640², V8 and JSC | ≤ 2 ms |
| Advance at speed 16, mean | ≤ 8 ms |
| Worst advance (derived-layer rebuilds sliced) | ≤ 50 ms |
| Frame transfer, median | ≤ 128 KB |
| Frame apply on the main thread | ≤ 1 ms, no allocation in layers |
| Hash per turn, when consumed | ≤ 0.3 ms at speed 1, ≤ 1 ms at speed 16 in rain (bench case) |
| Worker heap at 768² | ≤ 250 MB |
| Tornado `rage()` at radius 140 m | ≤ 25 µs per tick |
| A winter lake freezing at speed 16 | no full navigation rebuild per tick |

## The codemod

Leaf code moves by script.

- **The move map.** `scripts/moves/moves.json` maps old paths to final paths. It is generated from the
  [old to new](structure.md#old-to-new) and [powers to modules](structure.md#powers-to-modules) tables.
- **The move script.** `bun run apply-moves` (ts-morph `sourceFile.move()`) is idempotent: an agent runs it on its own
  branch, then rebases. It also rewrites the 118 `new URL(…, import.meta.url)` literals and the HTML entry scripts,
  which ts-morph doesn't touch, and a test checks that each one resolves.
- **Each file moves once, to its final path.** `tornadoes.ts` goes straight to
  `modules/hazards/tornado/simulation/tornado-system.ts`, and `tornadoPositionAt` and `VolcanoView` go straight to
  their modules' `shared/`, even before the module contract exists. Files that hold several future modules are split
  first, in hash-neutral hand-edit PRs (M5).
- **Tooling moves with the code.** Each move PR also updates `.claude/workflows/ship.js`, `.claude/agents`,
  `biome.jsonc`, `vite.config.ts` (test globs, `setupFiles`), knip, `tsconfig.*`, AGENTS.md, CONTRIBUTING and the
  README code map. In `ship.js` routing, `core/` and `<module>/simulation` count toward `touchesCore`; `engine/`,
  `interface/`, `<module>/engine` and `<module>/interface` count toward `touchesLook`. A guard test fails if a file
  appears under an old folder, and another checks that the `ship.js` and Biome globs each match at least one file.
- **CI checks the move.** It re-runs the move script on the merge base and diffs the result against the PR tree. Hand
  edits are listed explicitly.
- **Move freeze.** Move PRs run under an announced move freeze: a `move-freeze` label with a required check, and the
  owner merges. AGENTS.md gets a rebase recipe: merge the pre-move commit, run `apply-moves`, merge main.
- **Exact math.** The [exact-math](determinism.md#exact-math-and-randomness) rewrite is a Grit rewrite, so new code is
  written exact from the start.

## Phases

Each phase is a table of steps. Columns:

- **Size:** S is under 400 changed lines, M up to 1,500, L above. "L, 3 PRs" is an L-sized step split into three PRs;
  "2× L" is two L-sized PRs.
- **Needs:** the steps that must merge first.
- **Impact:** **H** changes hashes. **S** changes what saves hold; from format 2 on, compatibly. S2 is the one step
  that refuses older saves ([decision 1](decisions.md#owner-decisions)). **–** changes neither.

### Phase 0: safety net

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| 0.1 | Canonical dump and section digest harness: layout-independent (entities by serial, float64, fields by cell), keys present at both sides only, the merge-base comparison in CI, generation fingerprint files | M | — | A 1% change to an erosion constant fails | – |
| 0.2 | The schema-hash ratchet, `bun run fixtures` (fixtures start with format 2 in S2), the `save, load, run N` property as a ratchet with known failures (fire insertion order included) | M | — | The property runs in CI with its known failures listed | – |
| 0.3 | Bench project: budgets nightly, A/B and allocation counts on labeled PRs; cases for rain at speed 16 and a freezing lake | M | — | Baseline recorded | – |
| 0.4 | `bun run boundaries` in report mode with the shrink-only allowlist; Grit in warn mode; `exact-math.ts`, `hash.ts` and the ratchet that new files comply; the `hash-change` label and CONTRIBUTING line; ship gate runs `boundaries` and the digest check; AGENTS.md lists five commands | M | — | CI green; planted type-only import and `new URL` edge reported | – |
| 0.5 | Spike on a throwaway branch: the composite projects with module sides, editor speed, `tsc --build` time, Vitest projects, knip; a written result | – | — | Nothing merges | – |

### Phase S: saves

S0 ships in the first week, off the critical path but ahead of everything else. S2 ships format 2, the
self-describing envelope ([Saves](saves.md)), and S3 adds the [world base](saves.md#the-world-base).

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| S0 | Newer-save guard: never autosave over an unknown or newer format; "newer build" notice; versioned schema for the worlds listing record | S | — | A v2 record shows the notice in the previous release's reader | S |
| S1 | Name tables for index-coded catalogs; `formerNames` and unknown-name policies for name-coded ones; `catalogRef` codecs | M | 0.2 | Reordering a catalog in a test still round-trips a save | S |
| S2 | The logical envelope and section registry; sections write logical forms through adapters in new files; health as a share; lava as per-volcano runs; sparse-field `order`; inert placeholders; the journal into the chronicle; unknown sections kept; essential sections refuse; a save from before format 2 shows the older-beta notice and can be deleted | 2–3× L | S1 | Every format-2 fixture loads; a fast-check test plays an N+1 save on N and reloads it on N+1; a v1 save shows the notice | S |
| S3 | `WorldBase`: lossless, with header name tables and pond radii; the envelope's `base` field references it; first save waits for the base commit; orphans collected after a grace period under a lock; loading reads the base | M | S2 | Base hash equals stored bytes; load skips generation; a killed tab never leaves a save without a base | S |
| S4a | Paths, claimed plants, transients through adapters, grabs, tasks in steps as data; `snapshot()` never null | L, 2 PRs | S2 | Known `save, load, run N` failures shrink | S |
| S4b | `JobDefinition` schema and codec for all 28 job kinds; jobs saved as `{ kind, data }` | M | S2 | Every `JobKind` has a definition; `save, load, run N` known failures reach zero | S |

### Phase M: moves

Folder by folder, leaves first, each file once, by `apply-moves`, under the move freeze.

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| M1 | Untangle in place (18 files, one retyped import): mirror below rendering, stores and launch state out of `app`, shared stores out of features, `settings-group` to design, `chronicle`, `identifiers`, `effects` out of the simulation root, render helpers out of the render root | M | 0.1, 0.4 | Top-level and feature graphs acyclic; screenshots identical | – |
| M2 | `core`: foundation, catalog, world (the shared generation rules and the ten-file hydrology cluster, `Waypoint`, `agent-poses`, island shape and size), protocol (frame and command types, the save schema, and every main-thread import of simulation and generation: inspection types, rivalry, relation and raid views, `CalendarView`, `TICK_SECONDS`, `SIMULATION_SPEEDS`, snapshot types from `simulation.ts`, `WorldRequest`, `GenerationProgress`, `IslandSketch`, `DEFAULT_GENERATION_OPTIONS`); `VolcanoView` and `tornadoPositionAt` to their modules' `shared/` | 2× L | M1 | Boundaries zero for `core` and for engine and interface → simulation | – |
| M3 | `engine`: bridge, mirror, models (with `rig`), render, audio, input, runtime | L | M2 | Screenshots at three sizes, near and far, headless GPU Chrome | – |
| M4 | `interface`: design, stores, panels, app, pages; HTML entries | L | M2 | Browser tests, Playwright smoke | – |
| M5 | Split multi-power files into per-power files at final module paths: `element-powers.ts`, `catastrophes.ts`, `land-powers.ts`, `life-powers.ts`; `explode`, `shakeLand` and `strikeLightning` into `simulation/rules` as core actions | M, one PR per power group | M2 | Digests identical | – |
| M6 | `simulation`: kernel and runtime split from `simulation.ts` as files only, systems with society and rivalry nested, generation; the `*-api.ts` files for the 66 cross-system imports; powers into `<module>/simulation` | 2× L | M5 | Digests identical | – |
| M7 | Composite projects switch on; boundaries fails on anything not in the allowlist | S | M3, M4, M6 | `tsc --build` | – |

The allowlist reaches zero after X and T.

### Phase K: kernel

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| K1 | Bridge: the message protocol replaces Comlink; frame and mirror sections hold today's fields; sections accumulate dirty state across ticks; `transfer` lists; new files at final paths | L, 3 PRs | 0.1 | Frame time within noise; `bun run shots` identical | – |
| K2 | Kernel shell: today's systems as `SimulationModule` adapters in today's exact order under one transitional phase, sharing the root `RandomSource`; `simulation.ts` shrinks to the runtime; the system-order fingerprint | M, 3 PRs | M6 | Digests identical | – |
| K3 | Commands only: `StampedCommand` with step and sequence; the step clock with pause as clock state and speed in the tick source; held strokes; tasks and water settling in steps; paused steps drain events; lightning at a seeded site weighted by height and canopy; the weather chronicle entry anchored to the world, not `viewFocus`; `setViewFocus` removed | L, 3 PRs | K2 | Paused-brush browser test kept as a regression guard; casting while paused shows the effect next frame | H |
| K4 | Field store, tier one: `FieldWriter` with exactly today's semantics per field (lazy removal, insertion order, no new clamps), raw kernels with bulk marks, dirty chunks and write-time digests; the 40 raw writes and about 25 manual `mark*` calls go | M, 2 PRs | K2 | Digests identical; digest verifier | – |

### Phase C: catalog

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| C1 | The compiled catalog as a hash-neutral facade over today's content: per-group local indices, tags, multi-word flags, properties by handle, damage types, per-world `compileCatalog`, the registry by name; every per-kind table built from it; the module-scope table ban | L, 2 PRs | M2 | Digests identical; the extra-ground, extra-species test | – |

### Phase Q: queries (the owner's headline, early)

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| Q1 | Read-only `Surroundings` over today's stores, at final paths: cell side in `core/world/queries`, `ThingSource` adapters and mover buckets in `simulation/queries`, the radial pattern, a compatibility iterator that sorts candidates by array order (serial) and scans the spawned tail | M | 0.1 | No callers changed; digests identical; bench | – |
| Q2 | Ports that keep order: `inspectCell`, picking through the mirror's reader, the shared snow rule for rendering and ambience, `livingWithin`, `nearestPerson`, `hunterNear`, `answerFoes` (about 11% of the whole profile, 14% of non-generation CPU, growing with the square of agents) | M, 3 PRs | Q1 | Fast-check equivalence against the linear scan before each port; digests identical; interleaved-inspect test | – |
| Q3 | Filters with masks and flags, area queries, `tally`, `CellFilter`, capsules and regions, materialized cell properties, `MirrorSurroundings` | M | Q1, C1 | Bench budget for the whole tornado `rage()` | – |

### Phase D: determinism

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| D1 | Cross-engine CI: a determinism Vitest project (worker-side simulation only, no WebGPU) with Chromium, Firefox and WebKit instances, Bun, a nightly macOS runner for Apple's libm; golden math tests | M | — | Engines agree on exact-math goldens | – |
| D2 | Simulation code not reachable from `generateWorld`: the `hypot` codemod, exact math, `unitHash`, named streams with saved states, power streams; Grit becomes an error there | 3× M | K3 | Engines agree on the 10-day digests | H |
| D3 | Canonical orders: bitset active sets, sorted plant lists, saved free lists, derived links no longer saved; derived layers double-buffered with saved pending lists and slice offsets; walkability hysteresis | M, 2 PRs | K4, S2 | `save, load, run N` holds, including a save mid-slice | H S |
| D4 | Order-changing query ports: radial `nearest` with squared compares, `nearestShore` as a true nearest without random probes | M | Q2, D2 | Behavior tests | H |
| D5 | Generation and everything reachable from it (hydrology cluster, crossings, vegetation rules, climate, ponds, island shape): exact math, `unitHash` with the world seed, named streams, the `seed * 19 + 7` collision | M, 2 PRs | 0.4 | Engines agree on generation hashes | H, fingerprint |
| D6 | Replays: a worker-side command-log recorder, a replay player, root hashes per turn, export with the embedded base | M | K3, D3, S4a, S4b | A recorded scripted game replays to the same root hash in Chromium | – |

### Phase R: rules

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| R1 | Adopt the phases; every system that will become a module sits at its final slot (end of its phase), so extraction is hash-neutral; floors move into decay passes; clamping per field | M | K4, Q1 | Order fingerprint updated on purpose | H |
| R2 | Exposures, the batch reaction pass, transitions; the first rules (`soak-douses-fire`, `wind-blows-out-fire`, `molten-beside-water`, `heat-source-melts-snow`, embers and burning buildings adding heat); rain and snow stop calling `fire.douse`, the volcano's quench at water (`volcanoes.ts:295`) becomes `molten-beside-water`, the tornado loses its `blowOut` loops | L, 3 PRs | R1 | #242 tests unchanged; one test per rule; lava at a river stops and steams near and far | H |
| R3 | `strike` and `Blow`: first a facade that calls today's `damageArea`, `scare` and `addZone` exactly (–), then unified constants and mass and resistance scaling, then danger sources as transients | 3× M | R2, Q3, C1 | Design sign-off per behavior change (earthquakes now hurt animals); behavior tests per power; screenshots | H |
| R4 | Lava as a field in memory; volcano ownership as a side table; the lava terrain layer reads the cell-state channel | M | R3 | Volcano tests; far view | H |
| R5 | Events: typed channels drained every step; chronicle message ids; one fire discovery path; presented events as effects; `powerUsed` | M, 2 PRs | R1 | Chronicle tests | H |
| R6 | Traits (`declareTrait`, `respondTo`) with driver contracts (`flammable`, `grabbable`, `uprootable`); the `TransientStore` with column blocks per kind; the feature group for crossings and deposits; the grab chain collapses into `grabbable` and `THING_PRESENTERS` | L, 3 PRs | C1, R3 | Hand tests; pick tests | H S |

### Phase T: tribe and fauna extension points

Announce a short society freeze for T1.

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| T1 | Bands and scoring on S4b's `JobDefinition`; `decideJob` ported so bands reproduce today's order for all 28 kinds | L, 2 PRs | S4b, R3, R5 | Digests identical | – |
| T2 | Columns, property modifiers folded per tribe and kind, considerations | M | C1, T1 | Inspector explains a property | – |
| T3 | Tribe store with columns and stock, relations, `TribeRelation` queries, the `claim` field derived from saved `Claim` circles (the rivalry section keeps reading `claims`), the membership API, lifecycle events | M | T1 | Rivalry tests | H |
| T4 | Fauna brains by kind tag; world-layer contributions to hydrology and walkability (`barsFlow`, `blocksMovement`, `bridges`) | M | R6 | A test dam raises a lake after load | – |

### Phase X: module extraction

The tornado goes first and alone, as the pilot. It waits for Q3, R5, R6 and D2; D2 brings named streams, so creating
a system inside a module draws nothing from a shared parent stream. The number of files the pilot touches is recorded
against the [tornado walkthrough](walkthroughs.md#the-tornado-one-tick).

Then each module from the [powers table](structure.md#powers-to-modules) gets one PR, with one agent and worktree each;
the volcano waits for R4. Each extraction is hash-neutral, because R1 put its systems at their final slots. New
modules append to `MODULES`.

### Phase E: engine

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| E1 | Render stages, `RenderLayer`, `RenderServices`; cell-state pages over today's surface packing; terrain layer channels; the sampler test | L, 3 PRs | M3, K1 | Screenshots at three sizes, near and far; stage order test | – |
| E1b | Cell-state pages fed by field `mirror` definitions | S | E1, K4 | Screenshots | – |
| E2 | Effect presenters on one channel; thing presenters; `SkinnedFigures` | L, 3 PRs | E1, C1 | Screenshots; pick tests | – |
| E3 | Audio parts, emitter sources, cues next to owners, `cues.json` with owners and outputs, the generated sound catalog | M, 2 PRs | M3 | Unreferenced-sound test; each cue by ear in Chrome, Safari, Firefox | – |
| E4 | Looks keyed by name with overrides; named material slots | M | C1 | Screenshots | – |

### Phase I: interface

I2, translation with Lingui, goes first, right after M4 and without waiting for I1
([decision 3](decisions.md#owner-decisions)); its chronicle part follows R5. [Strings](main-thread.md#strings)
describes how Lingui fits.

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| I1 | `PANELS` and `INSPECTORS` registries, lazy panels with the chunk-failure reload, `IconSource` | M, 2 PRs | M4 | Browser tests; HUD chunk size | – |
| I2 | Lingui: config, Vite and Babel macro plugins, `I18nProvider`; `msg` descriptors per module and for built-in text; catalogs for en and ru; the worker sends `{ id, values }`; Russian complete; the browser language by default; a language setting | L, 3 PRs | M4; chronicle part after R5 | `lingui check missing` passes in CI and fails on a removed Russian line; the whole interface shows in Russian; the browser language picks the default | S |
| I3 | `zod/mini` (about 280 `z.` calls in 15 files) | M | — | Bundle sizes | – |
| I4 | `privacy.md` as JSX; react-markdown and remark-gfm removed | S | — | Privacy screenshots | – |

### Phase G: goals and scenarios

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| G1 | `ScenarioDefinition { start: WorldRequest and spawns, rules: RulesPatch, goals: GoalDefinition[] }`, goals as declarative predicates over area measures and tribe queries, named through the registry by name; a built-in goals system at a cadence with a saved, hashed section and goal events; a `PANELS` entry | L, 2 PRs | Q3, R5, S2, I1 | Three scenarios each play to their goal in a test | S |

### Phase L: lockstep

Phase L starts once D2, D5 and D6 have merged, and it comes before the deeper-tribe modules: sickness, trade and
beliefs ([decision 6](decisions.md#owner-decisions)). [Replays and lockstep](determinism.md#replays-and-lockstep)
describes the design.

| # | Step | Size | Needs | Verify | Impact |
| --- | --- | --- | --- | --- | --- |
| L1 | Lockstep `TickSource`: confirmed turns of 100–200 ms of real time holding `speed` ticks; speed and pause as ordered commands applied at turn boundaries; two workers in lockstep in a test | M | D2, D5, D6 | Two workers fed one command log reach the same root hash every turn in Chromium, Firefox and WebKit | – |
| L2 | Builds at immutable versioned URLs (Workers versions or R2); the handshake compares the build id, the catalog hash and the module list | S | K1 | A peer on another build is refused with a notice | – |
| L3 | Relay: one Durable Object per room in `server/` orders and broadcasts commands, keeps the log and the latest snapshot and never simulates; the socket lives in the worker; a room link for two to four players | L, 2 PRs | L1, L2 | Two browsers play one island for ten minutes without a desync | – |
| L4 | Desync and resync: peers swap section digests, both dump the first bad turn, the host sends a snapshot with the embedded base | M | L3, S3 | A forced desync in a test resyncs both peers to one root hash | – |
| L5 | Rival gods: each player owns a tribe and powers of their own | M | L3, T3 | A two-player test where each god acts only through their own tribe and powers | S |
| L6 | Late join, reconnect, speed limits per room | M | L4 | A player who reloads rejoins the room at the current turn | – |

## Lanes and the critical path

Lanes run side by side. "Starts after" names the steps outside the lane that it waits for.

| Lane | Steps | Starts after |
| --- | --- | --- |
| 0 | 0.1–0.5 | — |
| Saves | S0; S1 → S2 → S3, S4a, S4b | —; 0.2 |
| Moves | M1 → M2 → M3, M4, M5 → M6 → M7 | 0.1, 0.4 |
| Bridge | K1 | 0.1 |
| Kernel | K2 → K3, K4 | M6 |
| Catalog and queries | Q1 → Q2; C1 → Q3 | 0.1; M2 |
| Determinism | D1 any time; D2 after K3; D3 after K4, S2; D4 after Q2, D2; D5 after 0.4; D6 after K3, D3, S4a, S4b | — |
| Rules | R1 → R2 → R3 → R4; R5 after R1; R6 after C1, R3 | K4, Q1 |
| Tribes | T1 → T2, T3; T4 after R6 | S4b, R3, R5 |
| Modules | X pilot, then fanned out | Q3, R5, R6, D2 (volcano: R4) |
| Engine | E1 → E1b, E2; E3; E4 | M3, K1; E1b also K4; E2 and E4 also C1 |
| Interface | I2 first, right after M4; I1 after; I3, I4 any time | M4 for I1 and I2 |
| Goals | G1 | Q3, R5, S2, I1 |
| Lockstep | L1 → L3 → L4 → L6; L2 any time after K1; L5 after L3 and T3 | D2, D5, D6 |

**Critical path:** 0.4 → M1 → M2 → M5 → M6 → K2 → K4 → R1 → R2 → R3 → R6 → X, with K3 → D2 and C1 → Q3 joining
before X. Lockstep runs on a second long path: K4, S2 → D3 → D6 → L1 → L3 → L4 → L6, with D2 and D5 joining
before L1.

**Size:** about 120–150 PRs, 60–80k changed lines with tests, 10–14 weeks at agent pace, lockstep included.

Feature work continues throughout. Short freezes cover `simulation.ts` for K2, society for M6 and T1, and
`generation/` for its move in M6, scheduled between relief phases.
