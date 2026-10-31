# Main-thread extension points: rendering, game, audio, models, features, design, app

## How a kind gets wired in today

- **Tornado:** 16 non-test files mention it today: `content/powers.ts:330`, `game-icon-sources.ts:93,196`,
  `power-icons.ts:25`, 8 in `simulation`, `effect-view.ts:145`, `tornado-funnel.ts`, `effect-sounds.ts:19-128` and
  `sound-catalog.ts:342`. Volcano (`e1c53dd`): 30 files. Hand tool (#239): 30 non-test files, 17 of them on the main
  thread.
- **Rendering and audio import simulation runtime code:** `tornado-funnel.ts:4` and `effect-sounds.ts:2` import
  `tornadoPositionAt` from `simulation/powers/tornadoes.ts`.
- **One effect stream arrives two ways:** the renderer drains `session.takeEffects()` (`game-session.ts:164`,
  `game-engine.ts:333`), while audio reads `frame.effects` (`world-sounds.ts:176`).

## Extension points

### 1. Render layers

**Today:** `WorldRenderer` wires everything by hand: 26 fields (`world-renderer.ts:87-128`), 22 `scene.add` items
(185-207), 26 `dispose` lines (303-330), and routing of 6 change kinds to 11 views (332-370). Views have five
different `update` signatures:

- `(camera, frustum, detail)`
- `(input)`
- `(mirror, camera, darkness)`, in fire
- `(season)`, in lilies
- `(camera, viewDistance)`, in grass

Views reach each other through constructor arguments: grass and crops take `vegetation.weather`, fire takes
`vegetation.chunks`, and water takes `terrain.patchLevels` (279-281).

```ts
interface RenderLayer {
  readonly object: Object3D;
  readonly changed?: (changes: WorldChanges) => void;
  readonly update: (frame: RenderFrame) => void;
  readonly dispose: () => void;
}
type LayerFactory = (services: RenderServices) => RenderLayer;
// RenderServices: textures, axes, ring pool, plantWeather, plantChunks, patchLevels, heightAt, shake
// RenderFrame: camera, frustum, quality, sky {daylight, sun, palette}, wind, precipitation,
//              gameSeconds, realSeconds, mirror, hand, highlighted
export const RENDER_STAGES = ["sky", "ground", "water", "cover", "figures", "overlays", "effects"] as const;
```

- Order is an explicit stage list, then list order within a stage. No topological sort.
- Shared outputs go through services, never from one layer to another.
- Terrain and water looks are sub-layers, as in plan.md's `TerrainLayer`. Lava sits in `terrain-textures.ts:40` and
  `terrain-material.ts:340-349` today.

### 2. Effect presenters

**Today:** the effect union is in `simulation/effects.ts:78-87`. One switch is in `effect-view.ts:127-150`. A second
switch is in `effect-sounds.ts:36-77`, with its own tornado bookkeeping (19-24, 79-128).

```ts
interface EffectPresenter<Kind extends EffectKind> {
  readonly clock: "game" | "real";
  readonly look: ((context: EffectContext, effect: EffectOf<Kind>) => ActiveEffect) | null;
  readonly cue: ((context: CueContext, effect: EffectOf<Kind>) => ActiveCue | null) | null;
}
export const EFFECT_PRESENTERS: { readonly [Kind in EffectKind]: EffectPresenter<Kind> };
```

`ActiveCue` has the same shape as `ActiveEffect`. One `session.effects` channel feeds the renderer and audio. Path
math moves into a pure module file that both threads import.

### 3. Thing presenters: figures, picking, hover, selection, hand

**Today:**

- The people and animal views repeat the same draw loop line for line: `people-view.ts:194-251` vs
  `animal-view.ts:234-279`, and `#mark` at 253 vs 282.
- Code branches on the kind in `world-renderer.ts:59-66, 212-214, 523-535`, `game-engine.ts:134-143` and
  `entity-picker.ts:83-84, 172-176, 197-200, 274-328`.

This refines plan.md's `THING_ENGINE`:

```ts
interface ThingPresenter<Kind extends ThingKind> {
  readonly layer: LayerFactory;
  readonly pick: { readonly candidates: (scene: PickScene, ray: PickRay, out: PickList<Kind>) => void } | null;
  readonly rings: { readonly hover: number; readonly selection: number };
  readonly spot: (id: number) => GroundPoint | null;
  readonly heading: ((id: number) => number | null) | null;
  readonly footing: (x: number, z: number) => number;
}
export const THING_PRESENTERS: { readonly [Kind in ThingKind]: ThingPresenter<Kind> };
```

A generic `SkinnedFigures<Visual>` does the shared work (rest position, hand pose, footing, LOD, frustum, marker,
palette). Each kind supplies only `visualFor`, `parts`, `writePose` and `marker`, so a new figure kind such as birds
is one presenter.

### 4. Audio parts and cues

**Today:**

- Cues sit in six tables, each keyed differently:
  - `CASTS` and `BRUSHES` by power (`power-sounds.ts:10-36`)
  - `CUES` by chronicle category (`story-sounds.ts:17-30`)
  - `STRIKES` by pose (`work-sounds.ts:19-26`)
  - `LAND_GROUPS` by biome (`ambience.ts:21-32`)
  - the effect switch
  - fire and lava emitters, hardwired (`world-sounds.ts:53-89, 140-141, 181-189`)
- `SOUNDS` is one flat 66-entry catalog.
- Audio has 9 imports from `simulation` and `game`.

```ts
interface AudioPart {
  readonly hearFrame?: (frame: SimulationFrame, view: HearingView) => void;
  readonly hearCommand?: (command: SimulationCommand, now: number) => void;
  readonly hearRender?: (gameSeconds: number, now: number) => void;
  readonly dispose: () => void;
}
interface EmitterSource {
  readonly sound: SoundDefinition;
  readonly collect: (frame: SimulationFrame, world: WorldReader, view: HearingView) => readonly Emitter[];
}
```

Cue data moves next to what it voices: a power's sounds into its module, a chronicle cue next to its category, an
ambience group next to its biome. `new URL(..., import.meta.url)` works from any folder (`sound-catalog.ts:14-17`),
so sound files can live in modules. `connectWorldSounds` becomes a loop over `AUDIO_PARTS`.

### 5. Context queries on the main thread

**Today:**

- The rule for whether rain or snow falls at a point exists twice: `world-renderer.ts:457-464` and
  `ambience.ts:120-127`.
- Code reads `terrain.biome[cell]` and similar arrays directly in `spring-view.ts:47`,
  `lily-placement.ts:60,96,139` and `ambience.ts:91`.
- The mirror has ad hoc helpers (`world-mirror.ts:208-232`).

The proposal is one `WorldReader` in `world/`, implemented by both `WorldState` and `WorldMirror`:

```ts
interface WorldReader {
  heightAt(x: number, z: number): number;      // + surfaceAt, isWaterAt, isBrookAt, crossingAt
  biomeAt(x: number, z: number): Biome;        // + groundAt
  airTemperatureAt(x: number, z: number): number;
  precipitationAt(x: number, z: number): Precipitation;
  sampleArea<Field extends ReaderField>(x: number, z: number, radius: number, fields: readonly Field[]): AreaSample<Field>;
}
```

The renderer, audio and the simulation then share one rule instead of copies.

### 6. Interface registries

**Today:**

- The inspector branches on the kind in `titleOf` and `subtitleOf`, keeps its own icon map
  (`inspector-card.tsx:13-19, 39-60`), and has one details component per kind (`inspector-details.tsx`).
- Journal `TABS` (`journal-panel.tsx:11-15`) and settings `SECTIONS` (`settings-dialog.tsx:26-33`) repeat their union
  types in `interface-store.ts:5,7`.
- Engine bridges are listed by hand (`use-engine-bridges.ts:31-45`).

```ts
interface InspectorEntry<Kind extends InspectionKind> {
  readonly icon: IconSource;
  readonly title: (inspection: InspectionOf<Kind>) => string;
  readonly subtitle: (inspection: InspectionOf<Kind>) => string;
  readonly Details: ComponentType<{ readonly inspection: InspectionOf<Kind> }>;
}
export const INSPECTORS: { readonly [Kind in InspectionKind]: InspectorEntry<Kind> };
export type JournalTab = (typeof JOURNAL_TABS)[number]["id"];
export type EngineBridge = (engine: EngineHandle) => () => void;
```

The HUD layout (`hud.tsx:23-83`) stays written by hand, because where panels sit is a design choice, not data.

### 7. Icons and presentation metadata

**Today:** icons are mapped per kind in 8 places:

- `power-icons.ts:4-62`
- `power-dock.tsx:47`
- `tribe-icons.ts:5,28`
- `world-status.tsx:7`
- `inspector-card.tsx:13`
- `chronicle-icons.ts:4`

Each new icon also takes two edits in `game-icon-sources.ts`.

**Proposal:**

- Records carry an `icon` field: powers, buildings, resources, weather, chronicle categories, and choice options
  (which replace `POWER_OPTION_ICONS`).
- `GameIcon` takes an `IconSource`: a core name, or a module's `new URL("./icon.webp", import.meta.url).href`.

### 8. Model looks

**Today:**

- Plant species are spread over many tables: `VARIANT_COUNTS`, `SHAPE_SEEDS`, `CANONICAL_HEIGHTS` and `TREE_LOOKS`
  (`plant-models.ts:16/41/72/97`), `TREE_GENERATORS`, an if-chain (`plant-models.ts:136-175`) and `FOLIAGE_KEYS`
  (`plant-palette.ts:23`).
- Animals already have one record each (`animal-models.ts:40`), but `APPEARANCES` (`animal-appearance.ts:18`) and
  `ANIMAL_MARKERS` (`marker-look.ts:41`) run beside it.

**Proposal:**

- `PLANT_LOOKS: { [Name in PlantSpeciesName]: PlantLook }`, where each look has
  `{ variants, shapeSeed, height, build(seed, variant, level), foliage, hasOwnFarForm }`.
- `ANIMAL_LOOKS` holds `{ model, appearance, marker }`.
- Both are keyed by name, not index, so saves stay safe.

### 9. Tools

`ToolGestures` (`pointer-controls.ts:14-23`) is already right. One fix: `PowerTool` guesses the cursor radius from
parameter names (`power-tool.ts:7-8, 34-50`). Each power definition should declare `cursorRadius(parameters)`
instead.

## Self-contained modules

```
modules/tornado/
  module.ts              power definition (from content/powers.ts:330), icon, strings
  tornado-path.ts        tornadoDuration, tornadoPositionAt; pure, both threads
  simulation/            system, handler (element-powers.ts:199), save + frame sections
  engine/tornado-look.ts EffectPresenter.look (today tornado-funnel.ts)
  engine/tornado-cue.ts  EffectPresenter.cue (today effect-sounds.ts:19-128) + tornado.webm
  interface/             inspector entry if tornadoes become selectable
```

Adding the tornado then takes the folder plus one line each in `MODULE_IDS` and `POWER_ORDER`.

- **Volcano:**
  - The plume in `fire-view.ts:443-502` becomes a volcano layer.
  - `LavaField` becomes a `TerrainLayer`.
  - `lavaEmitters` (`world-sounds.ts:53-89`) becomes an `EmitterSource`.
  - The `volcanoRise` cast becomes a module cue.
- **Wildlife:** each species is one module (power, look and call, `power-sounds.ts:11-17`), or all species share one
  wildlife module.
- **Strings:** the simulation writes English text (`inspection.ts:17-25`, `society.ts:48`,
  `element-powers.ts:209`), which blocks localization. It should emit codes and leave the wording to the module's
  `interface/`.

## Placement on the main thread

```
src/engine/      no React: session/ (with mirror/), render/{layer.ts, services/, layers/…}, audio/parts/…,
                 input/ (camera, picking, tools), presenters.ts
src/interface/   React: design/, stores/, hud/, panels/…
```

## Packages

- None are needed here.
- The listener sets (`game-session.ts:42-47`, `game-engine.ts:97`) can become a small typed `Channel<T>` in
  `shared`.
- No R3F, because the engine never imports React. No Howler, for the reasons in plan.md.

## Caveats

- Use registries only where there are 3 or more entries and more are coming: effects (9), layers (22), things (4,
  growing to 6), audio parts (8), inspectors (5). Tools and the HUD layout don't qualify.
- Render order constraints are real (`world-renderer.ts:254-299`): the atmosphere updates before vegetation, and
  water after the terrain patch levels. The stage list must encode them, and a browser test should pin the order.
