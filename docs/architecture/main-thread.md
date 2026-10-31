# Engine and interface

The main thread holds two layers. `engine` renders, presents things and effects, builds models and plays audio, without
React. `interface` is the React HUD. Both read the world through the [mirror](bridge.md) and never import the
simulation. This file covers render layers, presenters, models, audio, the interface folders and translated strings.
[Phase E](migration.md#phase-e-engine) and [Phase I](migration.md#phase-i-interface) build them.

## Rendering

`engine/render/base/render-layer.ts`:

```ts
export const RENDER_STAGES = ["sky", "ground", "water", "cover", "figures", "overlays", "effects"] as const;

export interface RenderLayer {
  readonly changed: ((changes: WorldChanges) => void) | null;
  readonly dispose: () => void;
  readonly object: Object3D;
  readonly stage: (typeof RENDER_STAGES)[number];
  readonly update: (frame: RenderFrame) => void;
}

export type LayerFactory = (services: RenderServices) => RenderLayer;
```

- **Stages.** `WorldRenderer` loops over the stages. Today's ordering constraints become stage order: atmosphere
  before vegetation (for the shadow frustum), water after terrain patch levels. A browser test pins the order.
- **Shared outputs** (plant chunks, plant weather, patch levels, height sampling, shake) go through `RenderServices`,
  never from layer to layer.
- **Terrain and water layers** receive a channel node from the cell-state pages (the `rows` frame sections, see
  [Frame sections](bridge.md#frame-sections)), not a texture of their own, so the terrain shader stays under WebGPU's
  default 16 sampled textures. A browser test counts samplers.
- **Compiled from the start.** Every registered layer is compiled in from the start and gated by a uniform, so a field
  that appears mid-game never compiles a pipeline.
- **One patch-step rule, one outline.** The rule for reading a neighbor cell across level-of-detail patches lives in
  one shared `neighborSample` node, and every layer is cut by the island outline.
- **No layer allocates per frame.** Fire picks its nearest cells through block culling, not a sort of all burning
  cells.

## Presenters

Presenters turn things and events from the frame into what the player sees and hears.

- **`THING_PRESENTERS`** in `engine/runtime` has an entry for every kind manifest with a packed frame. An entry covers
  the layer, pick candidates, hover and selection rings, spot, heading, footing, hand pose, and visual-state channels
  (tint, pose overrides) that modules may claim.
- **`SkinnedFigures<Visual>`** holds the draw loop that people and animals duplicate today: rest position, hand pose,
  footing, LOD, frustum, marker, palette. A new figure kind supplies `visualFor`, `parts`, `writePose` and `marker`.
- **`EFFECT_PRESENTERS`** is keyed by presented event: `{ clock, look, cue }`. One channel feeds rendering and audio,
  which replaces the two switches in `effect-view.ts` and `effect-sounds.ts`.
- **Picking** reads the mirror's `WorldReader`, not rendering's vegetation chunks.

## Models

`PLANT_LOOKS` and `ANIMAL_LOOKS` are keyed by name. They replace `VARIANT_COUNTS`, `TREE_LOOKS`, `FOLIAGE_KEYS`,
`APPEARANCES` and `ANIMAL_MARKERS`. A module contributes looks for its own kinds. A look may be overridden (a paid
look), with the default as the fallback. Material slots become a named list with a derived count. `HUMAN_PARTS`, the
rig's bone lists and the animation clips stay order-coupled, guarded by a test.

## Audio

Audio has two interfaces: `AudioPart { hearFrame, hearCommand, hearRender, dispose }` and
`EmitterSource { sound, collect }`.

- **Cues sit with their owner:** a power's cue in its module, a chronicle cue with its category, an ambience group
  with its biome tag.
- **`cues.json`** gives each cue its owner, output path, bus, priority and volume, and `scripts/encode-sounds.ts`
  writes each file next to its owner. The sound catalog is generated from the cue list, and a test fails on any sound
  nothing references.
- **Ambience** measures the mirror through `MirrorSurroundings`, with the snow rule from `core/world/queries`, so the
  rule exists once.

## Interface

The interface folders go from low to high: `design`, `stores`, `panels`, `app`, `pages`, and imports only go down
([Layers](structure.md#layers)).

- **`design`**: primitives, `island.tsx`, `game-icon.tsx`, `settings-group` (out of a feature) and backdrops (out of
  `app`). `GameIcon` takes an `IconSource`: a core name or a module's
  `new URL("./icon.webp", import.meta.url).href`. Records carry `icon` fields, which retires the eight icon maps.
- **`stores`**: engine, launch, preferences, world, interface, guide, saves, sound, focus. Stores subscribe to mirror
  section readers. Panels read the engine through the handle and narrow selectors, never through `app`.
- **`panels`**: each panel is a folder that imports only `stores`, `design`, `core` and manifests.
  - `PANELS` (in `interface/app`) entries are `{ id, placement, label, icon, load, connect, store }`, with the
    placements `menu`, `settings`, `journal` and `dock`.
  - HUD overlays (labels, notices, guide tips, minimap, time, filming) stay wired by hand in `app`, because their
    placement is design.
  - `load` is a dynamic import, so the HUD chunk doesn't carry every panel. A chunk-load failure after a deploy offers
    a reload through `reload-page.ts`.
  - `PANELS` derives the tab unions, both menus and the store resets.
  - `INSPECTORS` is keyed by inspection kind, and modules add `inspectorRows`.
- **`app`**: the shell, the launcher, the hand-written `WideHud` and `CompactHud`, and the registries.
- **`pages`**: `pages.ts` feeds Vite's inputs. The privacy page is TSX already; its `privacy.md` text becomes JSX in
  `privacy-page.tsx`.

### Strings

Every string the player reads is translated on the main thread with Lingui 6
([decision 3](decisions.md#owner-decisions)). I2 brings it right after M4, and its chronicle part follows R5
([Phase I](migration.md#phase-i-interface)).

- **Packages.** `@lingui/core` and `@lingui/react` at runtime, about 10 kB gzip together; `@lingui/cli`,
  `@lingui/vite-plugin` and `@lingui/babel-plugin-lingui-macro` in development. The macro runs in the Babel chain that
  already runs the React Compiler.
- **Message ids.** A module's `module.ts` declares its message ids as a typed list. The worker uses only these ids:
  whatever it sends or saves is `{ id, values }`, never text. Ids are explicit because Lingui's default ids hash the
  text, which would break saved chronicles, and they stay stable once saved. Until R5 gives the built-in chronicle
  entries their ids, the chronicle section keeps those entries' English `text`.
- **Built-in text** follows the same rule: its ids are declared in `core/catalog`, its descriptors sit on the main
  thread next to the code that shows them, and its catalogs are `interface/locales/`.
- **Descriptors.** The module's `messages.ts` maps each id to a Lingui `msg` descriptor with the same literal id, since
  Lingui's extractor reads ids statically. The record `satisfies` a record over the ids, so `tsc` names a missing
  message, and a test checks that each descriptor's id equals its key. Only the engine and interface sides import
  `messages.ts`, so the worker bundle carries no strings.
- **Catalogs.** Each module keeps `locales/en.po` and `locales/ru.po` in its folder, and built-in text uses
  `interface/locales/`. `lingui.config.ts` lists these catalog paths. `interface/app` loads the catalogs for the
  language into `I18nProvider`; the browser language is the default, and a setting changes it.
- **Plurals.** ICU plurals cover the Russian one, few and many forms.
- **Adding a string.** Declare its id in `module.ts`, add its descriptor to `messages.ts`, run `lingui extract` and
  translate the new lines in `ru.po`. CI runs `lingui check sync` and `lingui check missing`, so a stale catalog or a
  missing Russian line fails the build.
