# Boundaries: the real dependency graph of `src/`

Method: every relative `import`/`export … from`, side-effect import, `import()` and `new URL(…, import.meta.url)` in `$R/src` was resolved to a file (scripts: `architecture/tools/graph.py`, `analyze.py`, raw edges in `tools/edges.json`). That gives 4,595 edges: 3,112 in production code (830 of them `import type`) and 1,483 in tests. All imports are relative; there are no path aliases.

## 1. Folder→folder edge matrix (production, value + type)

Rows import columns. `*` marks a back edge that closes a cycle.

| from \ to | shared | content | world | gen | sim | workers | models | render | audio | game | design | features | app |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| content | 5 | | | | | | | | | | | | |
| world | 8 | 6 | | | | | | | | | | | |
| generation | 43 | 16 | 76 | | | | | | | | | | |
| simulation | 69 | 142 | 71 | 13 | | | | | | | | | |
| workers | 2 | | 1 | 2 | 3 | | | | | | | | |
| models | 76 | 18 | 9 | | | | | | | | | | |
| rendering | 57 | 27 | 79 | 1 | 21 (4 value) | | 53 | | | **27\*** (0 value) | | | |
| audio | 5 | 5 | 6 | | 8 (1 value) | | 1 | | | 1 | | | |
| game | 13 | 5 | 16 | 3 | 21 (3 value) | 2 | 8 | 5 | | | | | |
| design | | 1 | | | | | | | | | | | |
| features | 6 | 22 | 7 | | 41 (4 value) | | | 4 | 4 | 19 | 122 | | **26\*** |
| app | 2 | | 5 | 3 | 1 | | | 4 | 1 | 7 | 13 | 33 | |

`main.tsx` and `privacy.tsx` add app 1 and features 2. On the engine side the graph is already a clean stack: shared < content < world < generation < simulation < workers, with models below rendering.

## 2. Cycles

**Top level.** There are two strongly connected components: {game, rendering} and {app, features}. Counting value imports only, just {app, features} remains, because all 27 rendering→game edges are `import type`.

**Features.** There are 68 feature→feature edges across 44 pairs, all value imports, forming 3 strongly connected components:
- {guide, powers}: `guide/connect-guide.ts:4 → powers/power-store.ts`, and back through `powers/power-dock.tsx:20-21 → guide/guide-store.ts, guide-tips.ts`.
- {interface, journal, inspector, rivalry, sound}:
  - `interface/menu-buttons.tsx:6 → journal/use-side-panel.ts`, and back through `journal/use-side-panel.ts:3 → interface/interface-store.ts`.
  - `inspector/inspector-details.tsx:19 → rivalry/tribe-relations.tsx`, and back through `rivalry/relation-list.tsx:6 → inspector/use-focus-camera.ts`.
  - `interface/compact-menu.tsx:19 → sound/use-sound-toggle.ts`, and back through `sound/connect-interface-sounds.ts:3 → interface/interface-store.ts`.
- {saves, settings, filming}: `settings/island-section.tsx:12 → saves/saves-group.tsx`, and back through `saves/saves-group.tsx:6 → settings/settings-group.tsx`. Here `settings-group` is a design primitive stored inside a feature.
- Fan-in by feature: world 12 (mostly `world-store.ts`), interface 10, tribes 8, inspector 6.

**Subfolders.**
- `simulation/` root and 6 of its subfolders form one component. The root mixes the composition file (`simulation.ts` has 26 imports into subfolders) with leaf types that the subfolders import back (`chronicle.ts` 5, `identifiers.ts` 4, `effects.ts` 4; for example `society/society-context.ts:5-8`).
- `rendering/` root, its 7 subfolders and `game` form one component. The subfolders import root helpers (`node-helpers.ts` 14, `instancing.ts` 10, `data-textures.ts` 9, `view-input.ts` 8), while `world-renderer.ts` in the same root composes the subfolders.
- `models/plants` ↔ `models/structures`: `structures/monuments.ts:11 → plants/tree-mesher.ts`, and `plants/plant-models.ts:6 → structures/monuments.ts`.

**Files.** There are no value cycles between files. Counting type imports too:
- a 63-file component in `simulation/society` (jobs ↔ `society-context.ts` ↔ `society.ts`; `society-context.ts` has 54 importers),
- a 29-file component across app and features,
- `simulation.ts` ↔ `frame-builder.ts` ↔ `command-handlers.ts`,
- `frame.ts` ↔ `inspection.ts`,
- `tornadoes.ts` ↔ `volcanoes.ts` ↔ `power-handler.ts`.

## 3. Offenders, worst first

1. **rendering → game: 27 edges, all `import type`.** 23 of them target `game/world-mirror.ts` (36 counting tests), for example `rendering/world-renderer.ts:3`, `terrain/terrain-view.ts:9`, `vegetation/vegetation-chunks.ts:4` and `effects/fire-view.ts:5`. The other 4 target `game/camera/god-camera.ts` (`world-renderer.ts:2`, `agents/people-view.ts:3`). In the other direction, game → rendering has 5 edges, all from `game/game-engine.ts:3-6` plus `game/filming.ts:2`. The read model of the world lives in the layer above its main consumer.
2. **features → app: 26 edges.**
   - Targets: `app/use-engine.ts` (13), `launch-store.ts` (6), `preferences.ts` (5), and two images (`privacy/privacy-page.tsx:4-5 → app/start-backdrop/*.webp`).
   - app → features has 33 edges (`hud.tsx`, `use-engine-bridges.ts:3-9`, `launch-options.ts:3-4 → new-world/seeds.ts, world-names.ts`).
   - The worst single link is `app/engine-store.ts:2`, which types its status by `engine-launcher.ts`. That file dynamically imports `hud.tsx` (`engine-launcher.ts:26`), and `hud.tsx` imports every feature.
3. **features → features: 68 edges** (see §2). `settings` alone imports 9 features, and `journal` imports 5.
4. **Main-thread code imports simulation modules as values: 12 edges.** Six simulation files end up in the main bundle: `hand/grab-target.ts`, `nature/calendar.ts`, `tick.ts`, `saved-world.ts`, `powers/tornadoes.ts`, and `world/terrain-editing.ts` (pulled in through `tornadoes.ts:5`). Examples:
   - `rendering/effects/tornado-funnel.ts:4` and `audio/effect-sounds.ts:2` call `tornadoPositionAt`.
   - `rendering/agents/people-view.ts:14`, `game/input/entity-picker.ts:5` and `rendering/hand-motion.ts:2` use `grab-target`.
   - `features/saves/save-database.ts:3` uses the zod save schema.
5. **audio has no fixed place.**
   - It is compiled in the engine tsconfig, yet it imports the game (`audio/world-sounds.ts:1 → game/engine-handle.ts`) and the models (`audio/work-sounds.ts:1 → models/people/human-clips.ts`, a value import).
   - React wires it up (`app/use-engine-bridges.ts:2`), and `features/sound` imports it 4 times.
6. **simulation → generation: 13 edges.** For example `simulation/world/water-recomputation.ts:1-3` (hydrology, drainage, crossings), `nature/succession.ts:12` and `world/world-state.ts:2-4`. The direction is fine, but generation is used as a runtime library.
7. **The type hubs**: `simulation/frame.ts` (33 production importers in 6 folders), `content/plants.ts` (37), `shared/math.ts` (170), and `PowerServices` (`simulation/powers/power-handler.ts:14`, which extends `SocietyContext`).

Biome enforces none of items 1–4. `biome.jsonc:31-91` only stops the engine from importing the UI and stops simulation and generation from importing rendering, game or models.

## 4. How one frame field travels: `lava`

| # | Step | Location |
|---|---|---|
| 1 | Producer | `simulation/powers/volcanoes.ts:570` `takeLava()` |
| 2 | Pack | `simulation/frame-packing.ts:399` `packLava` |
| 3 | Build | `simulation/frame-builder.ts:53` |
| 4 | Declare | `simulation/frame.ts:34` (`LavaView`) and `:151` |
| 5 | Transfer | `workers/simulation-worker-api.ts:74-75`, hand-listed in `frameBuffers` |
| 6 | Mirror | Nothing: `game/world-mirror.ts:192` keeps `frame` as received; only diffed stores get `apply` code (`:169-194`) |
| 7 | Consumers | `rendering/world-renderer.ts:242 → terrain/lava-field.ts:30`, `effects/fire-glow.ts:72`, `audio/world-sounds.ts:53` |
| 8 | Test fixture | `features/testing/world-fixtures.ts` must fill every required field (for example `:233`) |

The UI reaches the frame through `GameSession` listeners (`game/game-session.ts:233-246`). `features/world/world-store.ts:70-79` then copies a hand-picked subset of fields.

**Edits per new field, from git history:**

| Kind of field | Commit | Pipeline files edited |
|---|---|---|
| Plain object (`held`) | 5122855 | 3: frame, frame-builder, fixture |
| Typed array (`lava`) | e1c53dd | 4–5: the 3 above, the transfer list, and `frame-packing` when the data is packed |
| Diffed store (`waterLevels`) | dd7e003 | 8 of the commit's 15 files: frame, builder, packing, worker API, mirror (a new tracker, `apply`, and the hand-written `hasLandChanged` list at `world-mirror.ts:181-182`), `rendering/world-changes.ts`, `world-renderer.ts`, fixture |

Two of these mistakes give no error. A buffer missing from the transfer list is silently structured-cloned. A field missing from `hasLandChanged` silently skips `landVersion`.

## 5. The smallest set of layer rules that makes the graph acyclic

I checked this by simulation: moving 18 files and retyping one import turns the graph of folders and features into an acyclic graph.

- **R1. Rendering never imports game.** Move `WorldMirror` (with `game/landmarks.ts`, which it imports) and a camera view type below rendering, into a client read-model module, or let rendering own a `WorldView` interface. All 27 edges are type imports, so nothing changes at runtime.
- **R2. Features never import app, and only the entry imports app.**
  - Move `engine-store`, `use-engine`, `launch-store`, `launch-options` and `preferences`, along with `new-world/seeds.ts` and `world-names.ts`, into a UI-state layer.
  - Retype `engine-store.ts:2` to use `game/engine-handle.ts`.
  - Move the start-backdrop images to `design`.
- **R3. A store or helper that more than one feature imports lives in a shared UI layer, not in a feature.** That covers `interface-store`, `world-store`, `use-focus-camera`, `guide-store`, `guide-tips` and `settings-group` (into design). After the move, 37 feature→feature edges remain, and they are acyclic: composing shells such as settings and journal over leaf features.
- **R4. Main-thread folders (game, rendering, audio, features, app) import simulation only through a protocol module.** That module holds the frame, command and effect types, plus pure shared functions such as `tornadoPositionAt` and grab-target predicates. They never import system files. Today 12 value edges break this.
- **R5. A folder's root never holds both the composition file and the leaves its children import.**
  - Move `simulation/{chronicle,identifiers,effects}.ts` into a kernel subfolder.
  - Move `rendering/{node-helpers,instancing,data-textures}.ts` into a core subfolder.
  - Move `models/structures/monuments.ts` off `plants/tree-mesher.ts`.
  - This removes the 3 strongly connected components between subfolders.

R1–R3 alone make the top-level graph and the graph between features acyclic. R4 and R5 keep it that way as the code grows. All five can be enforced with Biome `noRestrictedImports` overrides, in the same form as `biome.jsonc:57-91`, or with `dependency-cruiser` for rules about which feature may import which.
