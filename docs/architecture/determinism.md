# Determinism, replays and lockstep

Replays and lockstep online play need the simulation to reach the same bits for the same seed and commands in every
browser engine, and a loaded save to continue exactly as the live game would have. This file covers the exact math and
random streams, the iteration orders that make save, load and run match an uninterrupted run, the order-free hashes
that locate a desync, and the replay and lockstep machinery. How a save is written is in [Saves](saves.md).

## Exact math and randomness

ECMAScript lets each engine approximate `Math.hypot` and the transcendental functions such as `Math.sin` and
`Math.exp`, so Chromium, Firefox and WebKit may disagree in the last bit. Exact operations (`+`, `-`, `*`, `/`,
`Math.sqrt`, `Math.imul`) give the same result everywhere, so deterministic code is built from them alone. A thing's
serial, used below, is its monotonic id (see [Things](cells-and-things.md#things-kinds-tags-flags-and-properties)).

### Math

- `core/foundation/exact-math.ts` holds `sin`, `cos`, `atan2`, `exp`, `log`, `log2`, `pow`, `tanh`, `asin` and
  `acos`, ported from fdlibm with exact operations only and pinned by golden tests. A port of `exp` costs 1.3–1.8×
  native in a fire-spread loop and about 3× per call. Per-cell factors (fire's slope and wind terms) use clamped lookup
  tables instead.
- A codemod rewrites about 150 `Math.hypot` calls in simulation, generation and world as
  `Math.sqrt(dx * dx + dz * dz)` or as squared comparisons. The 185 other transcendental calls (including
  `shared/astronomy` and content) and 13 lines with `**` follow, moving to exact math. The codemod reports its own
  counts.

### Hashes and random streams

- `unitHash(seed, a, b, c)`, built on `Math.imul` and lowbias32, replaces the `Math.sin`-based `hashToUnit` at its 43
  deterministic sites. Its seed parameter is a branded `WorldSeed`, so a call without a seed fails typecheck. About 25
  of the 43 take no seed today (succession, volcanoes, plots, drainage, deposits, springs, crossings, footing), so the
  same cell gets the same choice on every island. The generation sites change worlds and belong to D5. `hashToUnit`
  itself stays in `engine/render/base` for rendering and models.
- Randomness comes from named streams, such as `stream(worldSeed, "fauna.instincts")`. Each stream is seeded through
  splitmix32 into the full xoroshiro128plus state and draws nothing from a parent. Each module gets `power:<id>` for
  its powers. Stream states are saved in `randomStreams`; a missing one is re-derived. Generation gets named streams
  too, which fixes the `seed * 19 + 7` that `wetlands.ts` and `rock-strength.ts` share.
- The simulation has no presentation stream. Ember durations look visual, but they decide where embers land, so they
  are state. Randomness that is only visual is derived on the main thread from `hash(serial, tick)`.

### Generation becomes exact only in D5

The determinism work on everything reachable from `generateWorld` happens only in D5, the generation step of
[Phase D](migration.md#phase-d-determinism); D2 covers the rest of the simulation. The boundaries graph already
computes reachability, so CI rejects a D2-labeled edit to such a file. Runtime hydrology and crossings stay non-exact
until D5, so lockstep waits for D5 as well as D2. Other generation work, such as the relief phases, goes ahead at any
time ([decision 8](decisions.md#owner-decisions)).

## Canonical orders

Iteration order must be a function of saved state. Otherwise a game that is saved, loaded and run for N ticks
diverges from one that runs the same N ticks without the save.

- Sort comparators in simulation code break ties by serial, through the `sortBy` helper.
- Active sets become bitsets, scanned in ascending order over a snapshot taken at the start of each pass: about 12,800
  words at 640², which takes microseconds. Today `CellSet` keeps insertion order, and `FireSnapshot` saves it. Until
  D3, the logical form of a sparse field carries an optional `order` that keeps it; loaders after D3 ignore it.
- Each cell's plant list is kept sorted by slot, so `nextInCell` becomes derivable. The free list is state, saved and
  hashed.
- Lazy indexes refresh at phase boundaries, never on a query.
- Change trackers that feed simulation decisions are saved. Frame trackers never feed the simulation.
- Derived layers swap at the same step in a live game and after a load ([Derived layers](kernel.md#derived-layers)).

## Hashing

A hash of the world state lets peers, replays and tests confirm they agree, and points at the first place they don't.
Hashes are taken once per turn, the slice of real time that lockstep peers confirm together
([Replays and lockstep](#replays-and-lockstep)).

- **Field digests are order-free.** Each 64×64 chunk keeps a multiset hash over `(cell, value bits)`. The field
  kernels of the systems that own a field ([Writing fields](cells-and-things.md#writing-fields)) fold
  `mix(cell, oldBits) ^ mix(cell, newBits)` at write time, and `FieldWriter` does the same. A full recompute
  therefore equals the incremental digest by construction, and nothing rereads dirty chunks. Plant columns hash the
  same way per 1,024-slot page. Movers and transients are small and rehash in full.
- **Digests nest.** A section digest combines its chunk and page digests in a fixed order, and the root hash folds the
  section digests, so a desync points at a section and then at a chunk. The logical canonical dump is a debug artifact
  that property tests compare directly, not by hash.
- **A rolling check catches missed folds.** In debug and test builds a rolling pass recomputes 1/K of the chunks from
  raw data every turn, so a missed fold shows within K turns.
- **Hashes are computed only when something consumes them:** a lockstep peer, the replay recorder, a test or debug
  mode. Single-player frames carry none. Rereading costs 7.9 µs per 64×64 chunk of one f32 field under Bun, so a rain
  sweep at speed 16 would cost 1.3–2.4 ms per turn to reread. Write-time folding keeps it inside the hash
  [budget](migration.md#budgets).

## Replays and lockstep

In lockstep every peer runs the whole simulation, and only commands travel between them. Replays use the same pieces:
a command log and root hashes. [Phase L](migration.md#phase-l-lockstep) builds lockstep once D2, D5 and D6 have
merged, before the deeper-tribe modules ([decision 6](decisions.md#owner-decisions)). D2 and D5 make the simulation
and generation exact, which L1's check in Chromium, Firefox and WebKit needs, and D6 brings replays.

- **`TickSource`** lives in the worker and decides when steps run. The local one accumulates real time with speed,
  pause, the backlog and the 40-step cap, and stamps commands. The lockstep one hands out confirmed turns. The kernel
  doesn't know which one it runs.
- **Turns** are 100–200 ms of real time, each holding `speed` ticks, so speed 16 doesn't mean 80 turns a second. Speed
  and pause are relay-ordered commands applied at turn boundaries.
- **Tasks** run in steps: `{ dueStep, kind, data }`, dispatched to the `TaskHandler` of that kind in
  `ModuleRuntime.tasks` and saved by kind. A task of an unknown kind is kept. Anything with a visible flight, such as
  the meteor, is a transient whose flight advances in ticks, so its look and its impact share one clock.
- **Replay:** a header (build, catalog hash, seed, base hash, name tables), the command log, root hashes per turn and
  optional keyframes. Exports and resync payloads embed the compressed [world base](saves.md#the-world-base). The
  kernel runs headless in Bun and in workerd, so the server can verify replays.
- **Relay:** one Cloudflare Durable Object per room, that is per match, orders and broadcasts commands, keeps the log
  and the latest snapshot, and never simulates. The socket lives in the worker. The handshake compares the build id,
  the catalog hash and the module list. Each build is served at an immutable versioned URL (Workers versions or R2),
  and a lobby pins one.
- **Desync:** when root hashes differ, peers swap section digests, both dump the first bad turn, and the host sends a
  snapshot.
