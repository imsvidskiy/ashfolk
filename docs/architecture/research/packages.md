# Packages: audit and additions (Ashfolk, 31 Oct 2026)

Method: npm registry dates; a real `vite build --sourcemap` of `$R`, bytes attributed per package (minified); gzip via `bun build --minify` + `gzip -9`. Scripts: `architecture/npm/attribute.ts`, `closure.ts`.

## 1. Current dependencies

| Package | Use | Verdict |
|---|---|---|
| react-markdown 10.1.0 + remark-gfm 4.0.1 | `features/privacy/privacy-page.tsx:2-3,36`, one 3.4 KB `privacy.md` with one table | **Drop** |
| clsx 2.1.1 + tailwind-merge 3.7.0 | `design/cn.ts:1-6`, 33 files | Keep |
| comlink 4.4.2 | `game/simulation-connection.ts:1,46,57,65`, `workers/simulation-worker-api.ts:1` | **Replace** |
| pure-rand 8.4.2 | `shared/random.ts:1-2` | Keep |
| simplex-noise 4.0.3 | `shared/noise.ts:1` | Keep |
| zod 4.6.7 | 16 files (`simulation/commands.ts:49-59`, `saved-world.ts`, stores) | Keep, **move to `zod/mini`** |
| vite-plugin-pwa 2.0.0 | `vite.config.ts:54-89` | Keep |
| zustand 5.0.16, @base-ui/react 1.9.0, lucide-react, three 0.186, fontsource, @tailwindcss/typography | — | Keep (three 0.187 out 30 Oct) |

- **react-markdown + remark-gfm**: account for 100 of the 122 runtime packages in the dependency tree. They make up the `privacy` chunk, 167 kB min / 50 kB gz (micromark, mdast, hast). Workbox precaches it, so every player downloads it. Convert `privacy.md` to TSX once. If it must stay Markdown, render it at build time with `marked` 18.1.2 as a devDependency. Keep `@tailwindcss/typography` for `prose`.
- **tailwind-merge**: 26.8 kB min (≈8.5 kB gz) in the shared chunk. It earns its place while design components accept `className` overrides. clsx is 0.4 kB.
- **comlink**: last release 2024-11-07. The last commit (2025-06-18) merged #678, "Fix message ports not being closed when proxy is released", and that fix was never released. Ashfolk calls `proxy(onProgress)` on every create and load (`simulation-connection.ts:57,65`). Lockstep needs a *message protocol*, not RPC: tick-stamped commands in, frames and hashes out, with the same messages going to the worker, replay files and network peers. Replace comlink with a ~120-line typed `postMessage` layer: a discriminated union validated by the schema, plus transfer lists from the frame registry. It saves 3.9 kB in each of 2 chunks.
- **pure-rand**: active (released Jul 2026, by the fast-check author). fast-check depends on it, so property tests add no second RNG. Fix `derive` (plan) in place.
- **simplex-noise**: unchanged since 2024-07-26 ("make sqrt constants"), but it is finished. It uses only arithmetic, `floor` and constants, so its output is bit-identical across engines, unlike our `Math.sin` hash.
- **zod**: **91.7 kB min in `main` and 95.2 kB in `simulation-worker`**. For the same 3-variant command union: zod 25.4 kB gz, `zod/mini` 6.5 kB, valibot 1.9 kB. Mini shares the core, `z.output`, `looseObject`, `custom` and `toJSONSchema` (verified), and the last is useful for JSON schemas of mods and scenarios. Migration is syntax only: `.min(0).max(16)` becomes `.check(z.minimum(0), z.maximum(16))`. Saving: ≈37 kB gz.
- **vite-plugin-pwa**: maintained (2.0.0, 2026-10-03). It is a devDependency but pulls 232 packages (workbox-build). Its value is the hashed precache manifest.
- **Babel chain** (`@babel/core`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler`): `@vitejs/plugin-react` 6.1 has an *experimental* native compiler (`react({ compiler: true })` + `oxc-transform-react`). Keep Babel, because the Lingui macro (below) runs there.
- **TypeScript 7.0.2 ships no compiler API**: the package exports only `./lib/version.cjs` and `unstable/*`. 7.1 is in beta. This constrains the tool choices below.

## 2. Add for the rewrite

- **ts-morph 28.0.0 (dev)**: for moves. `@ts-morph/common` 0.29 bundles **TypeScript 6.0.2** (`dist/typescript.js`), so it works despite TS 7. `sourceFile.move()` rewrites imports. Keep re-runnable scripts in `scripts/moves/`.
- **dependency-cruiser 18.7.0 (dev), once a second module exists**: Biome's `noRestrictedImports` can't say "module X never imports module Y" generically; dependency-cruiser's `$1` path groups can. It can't use TS 7.0's compiler, so it needs `@swc/core` as its parser (18.3 added tsx and type-only detection, and 18.7 fixed swc detection) or TS ≥7.1 (18.8.0-beta-1). Cost: 18 dependencies plus a native swc binary.
- **fast-check 4.10.2 (dev)**: its only dependency is pure-rand. Properties to test:
  - the same seed and command list give the same state hash;
  - save → load → N ticks equals N ticks;
  - no fire or plants on `hasWater` cells;
  - name-table saves load after catalogs are reordered;
  - commands round-trip through the schema.

  `fc.commands` + `modelRun` shrink command sequences, and `replayPath` replays a failure.
- **Benchmarks: no package.** Vitest 5 ships a `bench` fixture on tinybench 6.2.2, which is already in the lockfile. It offers `bench.compare`, `toBeFasterThan({ delta })`, and baselines through `writeResult` and `bench.from`. Put budgets (tick at 640², frame build, context queries) in a `bench` project that runs nightly, not as a PR gate, because CI timings are noisy. Skip mitata (last release Feb 2025).
- **Worker boundary schema**: `zod/mini`, not valibot. The extra 4.6 kB doesn't justify switching libraries.
- **Deterministic math: no package; vendor it.** The deterministic layers have **336 non-exact calls**: 151 `hypot`, 61 `cos`, 60 `sin`, 37 `atan2`, 17 `exp`, plus a few `log2`, `tanh`, `log`, `asin`, `acos`.
  - `hypot` → `Math.sqrt(x*x+y*y)`, by codemod. `sqrt` and `+ − × ÷` are exact IEEE-754 in every engine, and JS forbids FMA contraction.
  - Port 9 functions from fdlibm/musl into `shared/math/exact`, with golden-vector tests in Node and in Playwright Chromium, Firefox and WebKit.
  - Not stdlib (`@stdlib/math-base-special-sin` 0.3.1, …): each function pulls 7–22 micro-packages.
  - Enforce it with a **Biome GritQL plugin** scoped by `includes` that bans `Math.<transcendental>` and `Math.random` in `src/{shared,content,world,generation,simulation}/**`. Plugins can also carry safe rewrites.
- **Hashing: no xxhash-wasm** (last commit Nov 2024). Its async WASM init forces an `await` into worker start. A synchronous `Math.imul` xxh32/murmur3 over `Uint32Array` views (the plan's `shared/hash.ts`) is enough if lockstep hashes every N ticks. Add xxhash-wasm only if a bench shows more than 1 ms per check.
- **Save compression: no fflate.** `CompressionStream` has been Baseline since May 2023, works in workers, and supports `gzip`, `deflate` and `deflate-raw` (MDN also lists `brotli` and `zstd`, which some browsers lack). Use `"gzip"` for stored base layers and cloud saves. fflate (9.3 kB min) is only needed for sync compression inside a tick.
- **i18n: Lingui 6.11.0** (`@lingui/core`, `@lingui/react`; dev: `@lingui/cli`, `@lingui/vite-plugin`, `@lingui/babel-plugin-lingui-macro`). Reasons:
  1. The simulation writes English today (`simulation/simulation.ts:125,715`), and content holds about 280 English labels. With Lingui, the worker emits `msg` descriptors `{ id, values }`: plain data that cross `postMessage` and saves and are translated on the main thread, so old journals re-render in Russian. Use explicit ids for anything saved, because default ids hash the text.
  2. Per-folder catalogs (`{name}/locales/{locale}`) keep a power's strings inside the power's folder.
  3. ICU plurals cover Russian one/few/many.
  4. `i18n.load()` lets mods add catalogs at runtime.
  5. Babel is already in the pipeline. With the OXC compiler, the Lingui preset must run first (discussion #2657).

  Cost: I measured 10.2 kB gz for core + react; the docs claim ~2 kB at runtime with precompiled catalogs. CI gains an extract step plus `lingui check missing`.

  Runner-up: Paraglide 2.29.3 (typed, tree-shakable functions), but dynamic ids from the worker and saves lose the typing, and it has no runtime mod catalogs. Not i18next 26: 17.2 kB gz, runtime string keys.
- **idb 8.0.4 (optional, ~1 kB)**: replaces the hand-rolled promise wrappers in `features/saves/save-database.ts` (304 lines; `:99-136`) before save sections and cloud saves grow.

## 3. Don't add

- ECS libraries (bitECS, Koota, Miniplex): the grid is already structure-of-arrays.
- Event buses, DI containers (inversify or tsyringe need decorators and `reflect-metadata`), RxJS, XState, immer or mutative: the stores are typed arrays.
- A router: one screen plus the separate privacy entry.
- Fixed-point or decimal libraries for lockstep: only transcendentals differ between engines.
- seedrandom (last published 2022).
- ast-grep or jscodeshift: Biome GritQL (lint plus rewrites) and ts-morph already cover this.
- `@typescript/typescript6`, unless a tool needs the TS API (ts-morph bundles its own).

**Net result.** Remove react-markdown, remark-gfm and comlink: 100 runtime packages, the 50 kB gz privacy chunk, and 3.9 kB in each of two chunks. `zod/mini` saves about 37 kB gz. Add Lingui at runtime (idb optional). Add ts-morph, fast-check, the Lingui tooling, and later dependency-cruiser with `@swc/core` as devDependencies.

## Sources

- npm registry: https://registry.npmjs.org/{package}
- Comlink commits: https://github.com/GoogleChromeLabs/comlink/commits/main
- Zod Mini: https://zod.dev/packages/mini
- TypeScript 7.0 (no API, 7.1 planned): https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- dependency-cruiser releases: https://github.com/sverweij/dependency-cruiser/releases
- ts-morph bundled TS: https://unpkg.com/@ts-morph/common@0.29.0/dist/typescript.js
- fast-check model-based testing: https://fast-check.dev/docs/advanced/model-based-testing/
- Vitest benchmarking: https://vitest.dev/guide/benchmarking
- Biome plugins: https://biomejs.dev/linter/plugins/
- CompressionStream: https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream
- Lingui catalogs: https://lingui.dev/ref/conf
- Lingui lazy translations: https://lingui.dev/guides/lazy-translations
- Lingui intro: https://lingui.dev/introduction
- Lingui and the OXC compiler: https://github.com/lingui/js-lingui/discussions/2657
- Paraglide: https://github.com/opral/paraglide-js
- Paraglide strategy: https://paraglidejs.com/strategy
- plugin-react 6.1: https://github.com/vitejs/vite-plugin-react/releases/tag/plugin-react%406.1.0
- vite-plugin-pwa 2.0.0: https://github.com/vite-pwa/vite-plugin-pwa/releases/tag/v2.0.0
- fdlibm in V8 and Firefox: https://bug635044.bugzilla.mozilla.org/show_bug.cgi?id=531915
