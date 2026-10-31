# Determinism, lockstep, replays and saves: research for Ashfolk (Oct 2026)

## 1. What the platform guarantees

- **Exact everywhere:** `+ - * /` follow IEEE 754 binary64 with roundTiesToEven (ECMA-262 §6.1.6.1). `Math.sqrt` returns 𝔽(√n), so it is correctly rounded. `fround`, `imul`, `floor`, `abs` and bit operations are exact. JS never fuses multiply-add.
- **Not guaranteed:** `sin cos tan atan2 exp log pow hypot` and `**` are all "implementation-approximated". fdlibm is only "recommended (but not specified)". https://tc39.es/ecma262/#sec-function-properties-of-the-math-object
- **Engines differ:**
  - V8 uses an fdlibm port (`base/ieee754.cc`). https://chromium.googlesource.com/chromium/src/+/32379a7ecd41186b344803923fe9f19a028f9e45/third_party/fdlibm/README.chromium
  - JavaScriptCore calls `std::sin/cos/exp/log`, `atan2` and `std::hypot` from the platform libm. https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/MathCommon.h
  - SpiderMonkey switches between libm and fdlibm for sin/cos/tan. https://bugzilla.mozilla.org/show_bug.cgi?id=1823880
- **Measured here (M-series Mac, Node 24.22 = V8 vs Bun 1.4.4 = JSC, 200k seeded inputs each; scripts in `architecture/bench/`):** the share of results that differ:

  | Function | Results that differ |
  |---|---|
  | `sin` | 4.6% |
  | `cos` | 4.6% |
  | `exp` | 9.8% |
  | `log` | 2.0% |
  | `atan2` | 17.8% |
  | `hypot` | 37.8% |
  | `pow` | 0% (the spec still allows it to differ) |
  | `sqrt(a*a+b*b)`, `+ * /` | 0% |

  FingerprintJS uses these same differences as entropy. https://github.com/fingerprintjs/fingerprintjs/blob/master/src/sources/math.ts
- **NaN encoding:** a NaN written to a `Float32Array` may take "any implementation chosen … NaN encoding". Byte hashes must normalize NaN or assert there is none.
- **Prior art:** Factorio replaced every trig, exp and log function "to ensure determinism across platforms" (https://lua-api.factorio.com/1.1.67/Libraries.html). Fiedler says floating point is only deterministic on one compiler and instruction set unless you restrict the operations you use (https://gafferongames.com/post/floating_point_determinism/).

**Ashfolk today:**
- 336 non-exact calls in engine code: simulation 209, generation 86, world 18, shared 22, content 1. By function: `hypot` 151, `sin` 60, `cos` 60, `atan2` 37, `exp` 17, `log` 5, `asin`/`acos` 3. Plus 13 lines that use `**`.
- `hashToUnit` is a `Math.sin` hash (`src/shared/math.ts:51-55`) used in 33 files.
- `derive` draws from its parent stream (`src/shared/random.ts:67-71`).
- Fire, embers, vegetation and populating share one stream (`src/simulation/simulation.ts:166,746-756`).
- `plan.md:145` limits determinism to "within V8", which rules out lockstep across browsers.

## 2. Exact math

1. **Replace `hypot` with `Math.sqrt(dx*dx+dz*dz)` now.** That is 151 of the 336 calls, is mechanical and becomes exact at once. Write `x*x` instead of `x**2`.
2. **Write our own `exact-math.ts`** with `sin cos atan2 exp log asin acos log2` (and `pow` if needed).
   - Port them from FreeBSD msun/fdlibm using only exact operations, reading words through `Float64Array`/`Uint32Array` views (every target is little-endian).
   - `@stdlib/math-base-special-sin` 0.3.1 (Apache-2.0) is such a port with no `Math.*` calls, but it pulls about 6 micro-packages per function. Port the code into the project's style rather than depending on it. https://github.com/stdlib-js/math-base-special-sin
   - Pin the results with golden tests: 10k inputs and a hash.
3. **Reject** fixed point (too invasive), a wasm libm (adds a toolchain) and `Math.sumPrecise` (Node lacks it; BCD 8.1.7).
4. **Enforce it with a Biome GritQL plugin,** `deterministic-engine.grit`, using `includes` for engine paths. It flags the non-exact `` `Math.$f($x)` `` calls, `**`, `Math.random`, `Date.now` and `performance.now`. `noRestrictedImports` can't express this. https://biomejs.dev/linter/plugins/
5. **Rendering, audio and UI keep native `Math`.**

## 3. Hashes and random numbers

- **`hash.ts`:**
  - Finalizer: `lowbias32` (`x^=x>>>16; x=imul(x,0x7feb352d); x^=x>>>15; x=imul(x,0x846ca68b); x^=x>>>16`). It "beats the … MurmurHash3 32-bit finalizer" (https://github.com/skeeto/hash-prospector); `fmix32` is also fine.
  - `hash(seed,a,b,c)` by chained mixing; `unit = (h>>>0)/2**32`, which is exact.
  - If we want Eiserloh's noise, use SquirrelNoise5, not Squirrel3, which has a known weakness (https://docs.rs/crate/squirrel-noise/latest/source).
- **Stateless chance for rules and cells:** `hash(seed, tick, cell, ruleId)` doesn't depend on order, has no saved state, and works with active sets iterated in any order.
- **Stateful streams for sequential choices** (populating, agent decisions):
  - Keep `pure-rand` 8.4.2 `xoroshiro128plus`: it is already a dependency, its state can be read and restored, and `jump()` moves 2^64 ahead. https://github.com/dubzzz/pure-rand
  - Seed each system by id: `lowbias32(worldSeed ^ fnv1a32("fire"))`, saved in `randomStreams[id]`. A missing entry is re-derived.
  - Drop `derive`'s draw from the parent.
  - No sfc32 or splitmix32: they gain nothing.
- **Rollout:** these changes alter worlds. Ship them in one batched pull request that bumps the generation fingerprint (`plan.md:148`).

## 4. Hashing state

- **Bench, pure JS murmur3 over `Uint32Array` views of `Float32Array` layers:**

  | Measure | Result |
  |---|---|
  | Throughput (Node and Bun) | ~3 GB/s |
  | 10 × 409,600 cells (16.4 MB) | 4.9 ms |
  | One 64×64 chunk of one layer | ~5 µs |
  | Node and Bun hashes | identical |

  Too slow for a full hash every tick at speed 16.
- **Design:**
  - Each section has its own hash. World layers cache one per 64×64 chunk, refreshed only for dirty chunks from the existing change trackers. Entities, random stream states, calendar and tick are separate sections.
  - Fold them into one **root hash per lockstep turn**.
  - Section hashes localize a desync the way Age of Empires checksummed the world, objects and pathfinding separately (https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond).
  - Debug mode hashes everything every tick, like Factorio's per-tick CRC (https://factorio.com/blog/post/fff-47).
- **No wasm needed:** `xxhash-wasm` 1.1 or `hash-wasm` 4.12 only if profiling demands it.
- **Keep the quantized `generationFingerprint`** (`generation-fingerprint.ts:24-32`, rounds to 0.01) for "land changed". It is wrong for desyncs because it hides drift.

## 5. Commands, replays and desyncs

- **Input becomes commands:** every input is a zod-validated `{tick, player, kind, payload}`.
  - Strokes become per-tick command samples. This departs from `plan.md:141` ("real time stays real time"), which lockstep can't keep.
  - Lightning stops using the camera's `viewFocus`.
  - Meteors and lake filling move to ticks.
  - Real time stays only in visual interpolation.
- **Lockstep:**
  - Commands are scheduled two turns ahead with an adaptive turn length (Age of Empires). Turn = 2 ticks (200 ms).
  - Relay: one Cloudflare Durable Object per match over WebSockets. It orders and broadcasts commands but does not simulate. https://developers.cloudflare.com/durable-objects/best-practices/websockets/
  - No rollback needed.
- **Replay:** a header (format, build and content hash, seed, world request, name tables, scenario), the command log, root hashes per turn, and optional keyframe snapshots for seeking. SC2 replays store no derived state (https://sc2reader.readthedocs.io/en/latest/articles/whatsinareplay.html).
- **Desync:** the root hashes differ → peers swap section hashes → each side dumps its state at the first bad tick → the host sends a snapshot. Factorio reconnects desynced players and they download the map again (https://factorio.com/blog/post/fff-55).
- **CI:**
  - A Vitest browser project with `chromium`, `firefox` and `webkit` instances (https://vitest.dev/config/browser/instances): seeds 3, 7 and 11, 600 ticks of scripted commands, root hash pinned.
  - Also run the pinned hashes under Bun: with exact math, JSC is a free second engine. This inverts the "never `bun --bun`" rule.

## 6. Saves and snapshots

- **One envelope everywhere:** local save, resync, replay keyframe and cloud save share `{format, version, names: {grounds, biomes, species, technologies, buildings, resources}, sections: {id: data}}` with typed arrays inside.
- **Local saves:** keep IndexedDB structured clone (`save-database.ts:227`). It stores typed arrays natively.
- **Bytes** (cloud, resync, export):
  - Encoding: `msgpackr` 2.x with `moreTypes: true` and `useRecords: false` (https://github.com/kriszyp/msgpackr), or `cbor-x` 1.6.
  - Compression: `CompressionStream("gzip")`.

  | Format | Chrome | Firefox | Safari |
  |---|---|---|---|
  | gzip | 80 | 113 | 16.4 |
  | brotli | none | 147 | 18.4 |
  | zstd | none | 138 | none |

  Source: BCD 8.1.7. So gzip only. It works in workers and in Node.
  - `fflate` 0.8 only if we need synchronous compression or zip.
- **Surviving generator changes:** store the base layers, with height quantized to `Uint16` before gzip. How well it compresses is unmeasured.
- **Schema:**
  - Keep zod 4.6. Valibot only saves bundle size, and two validators are worse.
  - Each section has a `z.looseObject` schema with defaults. On failure, that section resets with a warning.
  - `z.codec` (Zod 4.1+) maps names to indices both ways (https://zod.dev/codecs).
  - Name tables cover every enum stored in typed arrays. Technologies are raw strings and grounds have no table today (`saved-world.ts:10-55`). An unknown name falls back with a warning. There are no per-version remaps.

## Packages

- **Add:**
  - No runtime dependency now. `exact-math.ts`, `hash.ts`, the state hasher and the save envelope are written in-house.
  - `msgpackr` (or `cbor-x`) when cloud saves or online play land.
  - The GritQL plugin is a file in the repo, not a dependency.
- **Keep:** `pure-rand`, `zod`, `comlink`.
- **Skip:** wasm hashers, `fflate`, `valibot`, `@stdlib/*` as dependencies, fixed point, a wasm libm.
