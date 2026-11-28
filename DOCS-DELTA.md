# Notes for the next documentation rewrite

The architecture plan describes main after [#243](https://github.com/imsvidskiy/ashfolk/pull/243).
The roadmap records progress through 0.10.0. Later edits corrected names and added a recording list for the
0.12 powers. This inventory follows the shipped game through 0.12.5.

## Changes since the plan

| Release | What a rewrite should account for |
| --- | --- |
| 0.8.x | Raids resume with their loot. The generation fingerprint also covers vegetation and biomes. People settle on open ground. Close-camera fading applies to buildings and vegetation, and distant forests and rivers have their own representations. |
| 0.9.x | Audio runs on the main thread and follows the camera, weather and time of day. Players can set volumes, take photos, install the PWA and reopen it offline after a visit. The roadmap already lists these as shipped. |
| 0.10.x–0.11.1 | The deployed game lives at ashfolk.com. The Whop supporter checkout shipped. Island generation and downloading the game overlap, shader warm-up accounts for software adapters, and earlier cleanup kept pinned seeds reproducible. Storage belongs to the current origin. |
| 0.12.0 | The first-island guide follows an actual tribe through feeding and reading its chronicle. Settings remembers the last section and groups world rules. Painted game icons follow the three-spruce reference. Meteor, lightning and tornado gained selectable variants. Active black holes and tornadoes became saveable. |
| 0.12.1 | Bombs fall on the simulation clock, freeze on pause and survive saving in midair. The drop and impact share an ID. A black hole pulls inhabitants across obstacles, clears buildings and vegetation in stages and lowers the terrain once on collapse. |
| 0.12.2 | The worker advances the clock up to each queued command before applying speed and pause changes. Stationary powers on pause need only the ordinary heartbeat. RPC failure tracking lasts for the lifetime of each request. A damaged or temporarily unreadable save enters recovery before generation or autosave can replace it. The title screen shows the island film beside its launch controls. The HUD groups world views and game controls. Settings keeps project links and the build version visible while the section scrolls. |
| 0.12.3 | The model catalog dispatches to dedicated builders for dwellings, the storehouse and camp landmarks. Catastrophe simulation, visual effects, title-screen navigation and settings sections have separate modules. The home menu uses floating paper panels with an orange main action. Installation is a separate action when the browser offers it. Phone power buttons wrap into rows, and the minimap and parameter panels share the available height. Loading, recovery and Privacy use the same paper and text colours as the HUD. The black hole draws dust and fine particles in from the surrounding surface. |
| 0.12.4 | On the narrowest phones the power categories use text labels. The hand and selection tools keep their full touch targets when the browser falls back to a system font. |
| 0.12.5 | The start screen keeps branding, world selection and project links together in a centered panel sized to its contents on desktop and phones. The island film respects reduced motion. Project links open directly and the home screen no longer requests the GitHub star count. Sound settings own the master switch. World rules have padded disclosures. Waterfalls have a local sound, and power effects, tools and interface actions use new recordings. |

## Implementation details to carry forward

- **Power definitions and saves.** The catalog and variant pairs live in [powers.ts](src/content/powers.ts).
  Commands still reach a typed handler map in [power-registry.ts](src/simulation/powers/power-registry.ts).
  Save version 1 accepts optional arrays for tornadoes, wells and falling bombs. A missing array represents an
  older save. [Save schema](src/simulation/saved-world.ts)
- **Catastrophes.** New bombs drop for 4.4 simulation seconds. Saved drops from 0.12.1 retain their
  2.8-second flight. The approach builds into the worker-confirmed impact, and a separate rolling tail follows it.
  The cloud feeds smoke into a rising crown, cools and drifts apart. The gravity radius now defaults to 500 m and
  reaches 1,100 m. Faults open before collapse and the exposed terraces remain in the saved terrain.
  Black holes bend the scene and draw fragments
  from the objects removed at each stage. Their opening, sustained pull and collapse have separate recordings.
  [Effects](src/simulation/effects.ts) · [Catastrophe audio](src/audio/disaster-sounds.ts)
- **Sound playback.** Sound unlocks on a player gesture, including on the title screen. A switch, disclosure or
  tab gets one response. Waterfalls use the nearest river mouth with a visible drop. The meteor shower chooses
  from two rising approaches and plays its impact at contact. Close lightning uses two thunder recordings.
  [Sound catalog](src/audio/sound-catalog.ts) · [World sound](src/audio/world-sounds.ts)
- **Rendering and models.** Local paint edits now update the affected ground rows plus the two-row neighborhood
  used by farms. A seasonal recolor still repaints the island. Hidden markers skip projection and terrain checks.
  The camera, targeting cursor, water strikes and funnels use the visible surface. Mines show mineral seams at high and low detail.
  [Ground rendering](src/rendering/terrain/ground-albedo.ts) · [Effects](src/rendering/effects/effect-view.ts) ·
  [Mine models](src/models/structures/mine-model.ts)
- **Code layout in 0.12.3.** The [building catalog](src/models/structures/building-models.ts) dispatches model
  builders. [Lightning](src/simulation/powers/lightning.ts), [blasts](src/simulation/powers/explosions.ts) and
  [earthquakes](src/simulation/powers/earthquakes.ts) own their simulation rules and share monument damage
  reporting. Rendering effects use the [effect context](src/rendering/effects/effect-context.ts).
  The [world menu](src/app/world-menu.tsx) handles island choices and the
  [settings sections](src/features/settings/settings-sections.tsx) handle the tab list and compact selector.
- **Deployment.** Since 0.12.2 the application uses the Cloudflare CLI and Vite plugin. The worker and client assets
  build together under the Cloudflare output directory. [Worker configuration](cloudflare.config.ts)
- **Browser state.** World metadata and simulation state occupy separate IndexedDB object stores. Only a confirmed
  absence in both stores is an empty slot. Explicitly starting a fresh island can bypass storage. Notices expire
  with the world session even while the interface is hidden. [Save database](src/features/saves/save-database.ts) ·
  [World feed](src/features/world/world-store.ts)
- **Runtime changes after 0.12.5.** Hydraulic erosion and slope relaxation are separate generation stages.
  River courses provide distances and positions for crossing placement. Navigation measures the walkable slope
  once per cell and keeps hop destinations for connected brook banks. Terrain and water reuse patch origins at a
  stable level of detail. Trees and their shadow proxies share static mesh attributes. A HUD frame publishes its
  news and snapshot together, and save feedback follows the session that started the write.
  [Terrain slopes](src/generation/terrain-slopes.ts) · [Brook hops](src/simulation/agents/brook-hops.ts) ·
  [Terrain patches](src/rendering/terrain/patch-grid.ts) · [World feed](src/features/world/world-store.ts)
- **What is still a proposal.** The module/reaction registry, per-system saved random streams, replay format,
  localization, scenarios and cloud saves remain roadmap items. The first-island guide is available in the sandbox.
  [Architecture migration](docs/plan.md#migration) · [Roadmap](docs/roadmap.md)

## Verification points

Use the pinned round and square islands in [the fingerprint tests](src/generation/generation-fingerprint.test.ts).
Check older saves and interrupted drops with [the save tests](src/simulation/saved-world.test.ts) and
[the flight tests](src/simulation/powers/falling-bombs.test.ts). The named [visual scenes](tests/scenes.ts)
cover a bomb in flight, its impact, a waterspout, an active well over water and the basin left in woodland.
