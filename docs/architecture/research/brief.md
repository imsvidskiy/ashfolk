# Brief: the target architecture for Ashfolk

Read this first. It is the shared context for every agent in this research run.

## Where things are

- Latest code (origin/main, v0.10.0+), read-only snapshot:
  `/private/tmp/claude-501/-Users-svidskiy-Developer-svidskiy-dawnfolk/f224a3c7-cf6b-4066-884d-19a8c99c1ec2/scratchpad/ashfolk`
  (called `$R` below). Read code here.
- The current restructure plan: `$R/docs/plan.md`. The product roadmap: `$R/docs/roadmap.md`. Rules: `$R/AGENTS.md`,
  `$R/CONTRIBUTING.md` (code style), `$R/biome.jsonc`, `$R/tsconfig.*.json`, `$R/package.json`.
- Git history (read-only, never write, never create worktrees or branches there):
  `/Users/svidskiy/Developer/svidskiy/dawnfolk` — use `git -C <that path> log origin/main ...` and
  `git -C <that path> show --stat <sha>`.
- Your scratch space for any files: `/private/tmp/claude-501/-Users-svidskiy-Developer-svidskiy-dawnfolk/f224a3c7-cf6b-4066-884d-19a8c99c1ec2/scratchpad/architecture`.
  Never write anywhere else.

## What the owner asked for (translated from Russian)

> Study the plan and research, with many agents and critic agents, the cleanest architecture and structure for the
> project, so that everything is modular and clean, easy to extend, and everything has its own properties — so that,
> for example, a tornado can easily get which biome it is in, which trees are near, whether there is fire, and so on.
> The architecture described in plan.md feels huge and flat. Everything must be modular, clean and extensible. Maybe
> some packages are needed? Maybe something is superfluous? A deep rewrite and refactor of the project is planned. I
> want a clean, ideal, structured plan, researched by many agents and confirmed by critic agents.

Read this as:

1. **Modularity**: a new power, hazard, thing kind, tribe system or UI page is one self-contained folder plus a typed
   registration, not edits across 4–40 files (today the volcano touched 35 files, the hand tool 41).
2. **Properties everywhere**: things (plants, people, animals, buildings, monuments, crossings, deposits, lava,
   tornadoes, meteors, embers) and cells (biome, ground, water, fire, heat, wetness, snow, scorch, fuel…) expose
   declared properties, so elements interact through properties and rules, not hand-written per-pair calls.
3. **Context queries**: any system can cheaply ask "what is around this point/cell/area": biome, ground, water, fire,
   heat, nearby trees by species, people, tribes, animals, buildings, slope, height, season, weather, wind. One clean,
   typed, fast query API instead of ad hoc loops.
4. **Not flat and huge**: plan.md's target tree is a long flat list of top-level folders. The owner wants a structure
   that reads as a few clear layers with nested modules.
5. **Packages**: which libraries would help (and which to drop). Workspaces/packages are on the table.
6. **A deep rewrite is allowed.** Big moves are acceptable if they pay off; still, the game must keep working on
   main, and saves must keep loading.

## Hard constraints (keep)

- Generation and the simulation are deterministic for a seed (tests pin worlds by seed). Randomness only from seeded
  streams; `Math.random` only in rendering effects.
- The simulation runs in a Web Worker; the main thread renders (three.js WebGPU, TSL node materials) and runs the React
  HUD. The engine never imports React; the simulation never imports rendering.
- Large stores stay in typed arrays (grid is up to 768×768 = 590k cells, default 640² = 409,600 cells of 10 m).
- Saves keep loading across content changes **without per-version migration tables** (the owner explicitly rejects
  "old index → new index" remaps that must be extended each release). Self-describing saves: name tables, defaults for
  new keys.
- Code style from CONTRIBUTING.md: `function` declarations, block-bodied arrows, no `??`, no `as`, no `!`, no `&&` for
  values, full-word names, kebab-case files named after what they hold, colocated tests, no comments except
  workarounds.
- Stack: Bun, Vite, React 19, TypeScript (strictest), three.js 0.186 WebGPU only, Base UI, Tailwind 4, Zustand, Zod,
  Comlink, Biome (ultracite), Vitest (unit in Node, browser in Chromium), Playwright, Cloudflare Workers hosting, PWA.

## Constraints that may be challenged (with evidence)

plan.md rules out: an ECS library, a full rewrite, an event bus in the worker, registration by glob, topological rule
order, a router, GPU compute for reactions, big-bang moves. Comlink, the folder names, the Simulation class shape, the
frame format and the store layout are all open.

## Roadmap drivers the architecture must serve

- **Online play by deterministic lockstep** (2–4 players, later rival gods with their own tribes): command-only
  simulation, per-tick state hash, replays, identical results across Chromium/Firefox/WebKit (own exact math instead of
  `Math.sin/cos/atan2/exp/log/pow/hypot`, ~400 non-exact call sites).
- **Scenarios** (data: start, rules, goals), **mods** (data packs adding powers, species, rules), **localization**
  (Russian first), **deeper tribes** (sickness, diplomacy, beliefs), **tribe-built bridges**, **better models and
  animation**, **terrain realism v2** (stream-power erosion, rivers by discharge), cloud saves, a mobile app.

## Facts about today's code (from a full read)

- ~92k lines of source in 524 files, ~36k lines of tests in 304 files. Top-level `src/` folders: shared, content,
  world, generation, simulation (36k lines), workers, game, audio, models (22k), rendering (20.6k), design, features
  (12.4k), app. Two tsconfig projects: engine (no `noUncheckedIndexedAccess`) and app.
- **Simulation**: `src/simulation/simulation.ts` is a god object (~900 lines) that builds ~20 systems, lists every
  snapshot field, holds commands, strokes, grabs, tasks, splashes, incidents and notices. Fixed tick 0.1 s, speeds
  1–16, ≤40 ticks per `advance`. Step order: calendar, weather, environment, fire, embers, tornadoes, volcanoes,
  surface, vegetation growth, buildings, society, rivalry, fauna, hazards, crowding, incidents, splashes, navigation.
  A `PowerServices` bag (extends `SocietyContext`) is the dependency hub passed to powers, society, rivalry, fauna.
  Cell state lives in `Float32Array` fields on `WorldState` (fire, fuel, heat, wetness, snow, scorch, crop, trodden)
  with `CellSet` active sets. Element interactions are per pair (rain calls `fire.douse`, lava quenches itself at water,
  the tornado has its own `blowOut` loops over cells and buildings).
- **Frames**: `src/simulation/frame.ts` declares every field, `FrameBuilder` fills it, the worker API lists every
  buffer to transfer: three edits per field. Diffs (row runs, region patches, vegetation patches) are transferred.
- **Layers leak**: `rendering` imports `game/world-mirror.ts` ~33 times while `game` imports `rendering`; `features`
  imports `app` ~20 times and other features ~60 times.
- **A power is registered in four places**: `src/content/powers.ts`, `src/simulation/powers/power-registry.ts`,
  `src/features/powers/power-icons.tsx`, `src/design/game-icon-sources.ts`. A grabbable kind needs edits in
  `simulation/hand/grab-target.ts`, `grab-handlers.ts`, `game/input/entity-picker.ts`, `rendering/hand-motion.ts` and
  each view.
- **Content** (`src/content`): typed records (`POWERS`, `BUILDINGS`, `GROUNDS`, `PLANT_SPECIES`, `TECHNOLOGIES`, 13
  biomes, 19 grounds, 28 plant species incl. 6 monument pieces stored as "plants", 5 animals, 15 buildings, 24
  powers, 19 technologies, 6 eras, 20 resources). Numeric index enums must stay in order.
- **World** (`src/world`): `TerrainData` (12 layers), `hasWater`, `touchesWaterCell`, `hasRoomFromCoast`,
  `VegetationStore` (SoA, per-cell linked plants), crossings, footing, brooks, change trackers.
- **Generation**: `generateWorld(seed, options)`: layout archetype → relief → erosion → lakes/valleys → hydrology →
  climate/biomes → woodland → monuments, crossings, vegetation, deposits. Per-stage `createRandom(seed*K+C)` streams;
  `hashToUnit` (a `Math.sin` hash) for per-cell choices. Hydrology reruns at runtime after terrain edits.
- **Saves**: IndexedDB; loading **regenerates** the island from the seed and applies sparse diffs. A generation
  fingerprint warns ("land changed" dialog) on mismatch. Name table only for plant species; technologies are saved as
  raw strings (renaming one throws on load); grounds have no name table. Jobs are not saved. `SAVE_VERSION = 1`.
- **Determinism gaps**: `RandomSource.derive` draws from its parent (order-dependent); `hashToUnit` uses `Math.sin`;
  natural lightning is placed around the camera's `viewFocus`; strokes, meteors and lake filling run on real seconds.
- **Rendering**: WebGPU only; terrain in 64-cell patches with 4 LOD steps and heights from a texture; water shares the
  LOD via a `patchSteps` texture; island outline (2048 radii) cuts terrain, water, grass, rain; grass and rain fully
  procedural on GPU; vegetation instanced per species×variant in 16-cell chunks with 5 levels; agents skinned on GPU
  from a palette DataTexture, posed on CPU by procedural clips; outlines, bloom, FXAA. `WorldRenderer.render` order
  matters (atmosphere before vegetation for the shadow frustum).
- **Models**: CPU-built procedural meshes with 9 vertex channels (slot, shade, sway, flutter, part, bones…); 56
  material slots; order-coupled lists (`HUMAN_PARTS` order = part index).
- **Main thread**: `EngineLauncher` → `GameEngine` → `GameSession` (Comlink to worker, command queue sent with the next
  `advance`), `WorldMirror` applies frame patches, `GodCamera`, pointer/keyboard controls, `PowerTool`, `HandTool`,
  `EntityPicker`. Dev handle `window.ashfolk`.
- **UI**: ~10 Zustand stores (engine, launch, world, powers, interface, saves, guide, sound, install, stars), ~20 feature
  folders (powers dock, journal, minimap, inspector, guide, filming/photo, install, labels, notices, saves, settings,
  sound, time, tribes, rivalry, new-world, project, privacy, parameters, world). Design system in `src/design`.
- **Audio**: Web Audio engine with buses and a 24-voice cap, ambience from 15 layers by biome/weather/hour, cues for
  powers, work sounds synced to animation clips, music by hour.
- **Tooling**: Biome boundaries via `noRestrictedImports`, knip, lefthook, CI (check, typecheck, knip, test, build),
  `/ship` workflow with reviewer agents. The repo merges 30–100 PRs a day, mostly by agents.
