# Notes for the next documentation rewrite

The architecture plan describes main after [#243](https://github.com/imsvidskiy/ashfolk/pull/243).
The roadmap records progress through 0.10.0. Later edits corrected names and added a recording list for the
0.12 powers. This inventory follows the shipped game through 0.12.2.

## Changes since the plan

| Release | What a rewrite should account for |
| --- | --- |
| 0.8.x | Raids resume with their loot. The generation fingerprint also covers vegetation and biomes. People settle on open ground. Close-camera fading applies to buildings and vegetation, and distant forests and rivers have their own representations. |
| 0.9.x | Audio runs on the main thread and follows the camera, weather and time of day. Players can set volumes, take photos, install the PWA and reopen it offline after a visit. The roadmap already lists these as shipped. |
| 0.10.x–0.11.1 | The deployed game lives at ashfolk.com. The Whop supporter checkout shipped. Island generation and downloading the game overlap, shader warm-up accounts for software adapters, and earlier cleanup kept pinned seeds reproducible. Storage belongs to the current origin. |
| 0.12.0 | The first-island guide follows an actual tribe through feeding and reading its chronicle. Settings remembers the last section and groups world rules. Painted game icons follow the three-spruce reference. Meteor, lightning and tornado gained selectable variants. Active black holes and tornadoes became saveable. |
| 0.12.1 | Bombs fall on the simulation clock, freeze on pause and survive saving in midair. The drop and impact share an ID. A black hole pulls inhabitants across obstacles, clears buildings and vegetation in stages and lowers the terrain once on collapse. |
| 0.12.2 | The worker advances the clock up to each queued command before applying speed and pause changes. Stationary powers on pause need only the ordinary heartbeat. RPC failure tracking lasts for the lifetime of each request. A damaged or temporarily unreadable save enters recovery before generation or autosave can replace it. The title screen shows the island film beside its launch controls. The HUD groups world views and game controls. Settings keeps project links and the build version visible while the section scrolls. |

## Implementation details to carry forward

- **Power definitions and saves.** The catalog and variant pairs live in [powers.ts](src/content/powers.ts).
  Commands still reach a typed handler map in [power-registry.ts](src/simulation/powers/power-registry.ts).
  Save version 1 accepts optional arrays for tornadoes, wells and falling bombs. A missing array represents an
  older save. [Save schema](src/simulation/saved-world.ts)
- **Effects and sound.** The worker decides when an impact occurs. The renderer draws its flight, cloud or disk,
  and Web Audio plays the existing land or water impact. New drops share the meteor’s sky-entry altitude and take 4.4 simulation seconds. Saved drops from 0.12.1 retain their 2.8-second flight. The dedicated nuclear tail and black-hole recordings
  listed in the plan are still to record. The cloud feeds rolling smoke into a rising crown, cools and drifts apart.
  Black holes bend the scene and draw fragments from the objects removed at each stage. [Effects](src/simulation/effects.ts) · [Audio](src/audio/effect-sounds.ts)
- **Rendering and models.** Local paint edits now update the affected ground rows plus the two-row neighborhood
  used by farms. A seasonal recolor still repaints the island. Hidden markers skip projection and terrain checks.
  The camera, targeting cursor, water strikes and funnels use the visible surface. Mines show mineral seams at high and low detail.
  [Ground rendering](src/rendering/terrain/ground-albedo.ts) · [Effects](src/rendering/effects/effect-view.ts) ·
  [Mine models](src/models/structures/mine-model.ts)
- **Browser state.** World metadata and simulation state occupy separate IndexedDB object stores. Only a confirmed
  absence in both stores is an empty slot. Explicitly starting a fresh island can bypass storage. Notices expire
  with the world session even while the interface is hidden. [Save database](src/features/saves/save-database.ts) ·
  [World feed](src/features/world/world-store.ts)
- **What is still a proposal.** The module/reaction registry, per-system saved random streams, replay format,
  localization, scenarios and cloud saves remain roadmap items. The first-island guide is available in the sandbox.
  [Architecture migration](docs/plan.md#migration) · [Roadmap](docs/roadmap.md)

## Verification points

Use the pinned round and square islands in [the fingerprint tests](src/generation/generation-fingerprint.test.ts).
Check older saves and interrupted drops with [the save tests](src/simulation/saved-world.test.ts) and
[the flight tests](src/simulation/powers/falling-bombs.test.ts). The named [visual scenes](tests/scenes.ts)
cover a bomb in flight, its impact, a waterspout, an active well over water and the basin left in woodland.
