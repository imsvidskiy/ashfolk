# Decisions and risks

What the owner decided about the plan, the risks of the migration and how each is met, what the design rules out on
purpose, and what is gone by the end of the [migration](migration.md).

## Owner decisions

The owner made these nine decisions, and the other architecture files follow them. Each entry gives the decision, the
reason and a link to the file that holds the details.

1. **Old worlds: not kept while the game is in beta.** Saves written before format 2, the envelope that S2 ships, are
   refused with a notice, and the player can delete them. There is no frozen generator copy, no v1 dual-write and no
   save fixture before format 2. Reason: the game is in beta, and carrying today's saves forward would cost a frozen
   reader, a release of dual writes and fixtures for every shape since 0.8. See
   [Older and newer builds](saves.md#older-and-newer-builds).
2. **No legacy reader.** No reader converts saves from before format 2. Format 2 describes itself from its first
   release, with name tables, `formerNames`, defaults and additive keys. Reason: decision 1 refuses the older saves,
   so `legacy-snapshot-1.ts` is not written, and a self-describing format keeps later saves loading across content
   changes without per-version migrations. See [Saves](saves.md).
3. **Translation: Lingui, and early.** Lingui 6 translates the game, Russian first. It lands in I2, right after M4.
   Reason: the owner chose Lingui, and [research/reports/packages.md](research/reports/packages.md) recommended
   Lingui 6.11.0 for its extraction, PO catalogs, ICU plurals (Russian one, few and many) and the CI check for
   missing lines. See [Strings](main-thread.md#strings).
4. **Merge protection: required checks on the user-owned repository.** Main is protected by required status checks,
   "require branches to be up to date" and the lock-label check, and the repository stays user-owned. Reason: GitHub's
   merge queue needs an organization, and moving the repository to one would change its URLs, the Cloudflare
   environment secret and the Whop links. See [Rules for every PR](migration.md#rules-for-every-pr).
5. **Rivalry: a built-in system.** It stays in `simulation/systems/rivalry`. T3 still adds the tribe extension points,
   and diplomacy builds on them. Reason: raids and claims feed society, the rival gods of online play stand on it, and
   nothing would remove it, so a module boundary buys nothing. See
   [Built-in systems and modules](structure.md#built-in-systems-and-modules).
6. **Lockstep: in scope now.** [Phase L](migration.md#phase-l-lockstep) is part of this plan. It starts once D2, D5 and
   D6 have merged and comes before the deeper-tribe modules (sickness, trade, beliefs). Reason: online play with rival
   gods is where the game is heading, and the tribe modules that follow are then built and tested under lockstep from
   the start. D2 brings the exact simulation math that L1's three-browser check needs, D5 makes generation exact, and
   D6 brings the command log and replays. See [Replays and lockstep](determinism.md#replays-and-lockstep).
7. **Mods: none from outside.** Players won't load third-party mods. New content is written in this repository as
   modules and catalog rows, and the registry by name and the catalog rounds serve save name tables and scenarios, not
   data packs. Reason: code mods can't be held to the determinism rules in lockstep (decision 6), and without outside
   authors a declarative data tier of power archetypes and reactions has no one to serve. See
   [The catalog per world](modules.md#the-catalog-per-world).
8. **Generation work doesn't wait.** Relief phases, terrain realism v2 and the crossings rework go ahead at any time,
   without waiting for any migration step. S3 follows S2, and D5 doesn't wait for S3. Until S3, a generation change
   shows today's land-changed dialog for current saves; from S3 on, a world keeps its land in its `WorldBase`. Reason:
   old worlds are not kept (decision 1), so the land-changed dialog is fine in beta and nothing needs S3 early. D5
   changes generation once on purpose, so the roadmap's
   [restructure item](../roadmap.md#restructure-the-code-as-in-planmd) asks for the same island in every browser, not
   the same island as today. See [The world base](saves.md#the-world-base).
9. **Storage: the whole world on the device; R2 for the cloud later.** A world stores its whole island in a `WorldBase`
   in IndexedDB, so a save never depends on the generator, loads without regenerating and plays offline. Cloud saves
   and shared worlds, later and after sign-in through Whop, upload the same base and sections to Cloudflare R2 per
   account. Reason: the device needs no account and works offline; R2's free tier (10 GB-month of storage, 1 million
   writes and 10 million reads a month, no egress fees) fits a cloud copy at about 5.7 MB per world. See
   [The world base](saves.md#the-world-base).

## Risks

| Risk | Mitigation |
| --- | --- |
| Hash churn re-rolls promo seeds and pinned scenes | Hash changes are labeled; re-pick seeds after D2, R3 and D5 |
| Agents re-pin digests by reflex | Merge-base comparison of shared keys only, no committed simulation hashes; the label; the ship reviewer flags hash changes without cause |
| Generic paths slower than today's kernels | Two write tiers, batch reactions, compiled cell properties, inline query loops; A/B gates on K, Q and R |
| Events become hidden coupling | Facts only; listeners write only their own state; the extension-point list is closed |
| Move conflicts with in-flight agent work | Announced move freezes, `apply-moves` on branches, a rebase recipe |
| Version skew from per-merge deploys and the PWA | S0 first; inert placeholders; the chunk-failure reload |
| Players lose their beta worlds when S2 ships | An in-game notice on the old save and a line in the release notes |
| `WorldBase` size on phones | 5.7 MB per world lossless at 640²; check `navigator.storage.estimate()` before writing |
| Exact math speed | 1.3–1.8× in a fire-spread loop; lookup tables for per-cell factors |
| Water settling counted in steps settles faster in real time at high speed | Accepted; a constant per speed if players notice |

## What we deliberately don't do

- **No ECS library and no generic column store for agents.** People and animals stay objects behind `ThingSource`.
- **No workspace packages.** Layers are composite projects; a module stays one folder across threads.
- **No closures per cell in the reaction pass, and no dense drivers.**
- **No state hash in single-player frames.**
- **No lazy index built by a query, and no presentation stream in the simulation.**
- **No per-version save migrations and no legacy reader.** Format 2 describes itself with names, defaults and additive
  keys; older saves are refused during beta ([decisions 1 and 2](#owner-decisions)).
- **No globs, no declaration merging, no topological sort.**
- **No event bus semantics.** Events are facts drained once per step; changes to the world go through cells.
- **No SharedArrayBuffer, no OffscreenCanvas renderer, no router.**
- **No GPU compute for reactions.** Active sets keep the pass small.
- **No block counts until a bench needs them.** The [query API](queries.md) leaves room for them.
- **No outside mods: modules are written in this repository** ([decision 7](#owner-decisions)). Scenarios still arrive
  in G1.
- **Catalogs stay catalogs.** A species or building is a row with properties, not a module.

## Deleted by the end

Each row names the [migration step](migration.md#phases) that removes it.

| What goes | Step |
| --- | --- |
| The `PowerServices` and `SocietyContext` bags | K2, R3 |
| Field lists in `simulation.ts` snapshots, `FrameBuilder` and the worker API's buffer list | K1, S2 |
| `setViewFocus` and `viewFocus` in saves | K3 |
| The 40 raw field writes and about 25 manual `mark*` calls | K4 |
| `isTreeSpecies`, `WOODED_BIOMES` and the three other wooded-biome groups (`REGROWING_BIOMES`, the second `WOODED_BIOMES` in `spring-view.ts`, `WOODS` in `monuments.ts`) | C1 |
| `fire.douse` outside fire (four callers), `buildings.blowOut`, the tornado's `blowOut` loops | R2 |
| 14 `damageArea`, 5 `scare` and 5 `addZone` calls; `DangerZone[]`; three copies of "a burning cell hurts" | R3, R6 |
| The grab chain (`grab-target.ts`, `grab-handlers.ts`, `entity-picker.ts` kind switches, `hand-motion.ts` cases) | R6, E2 |
| The `decideJob` ladder, `NIGHT_JOBS`, `UNWAVERING_JOBS`, `STEADFAST_JOBS` | T1 |
| `power-registry.ts`, `POWER_GROUPS` in content, `power-icons.ts`, power entries in `game-icon-sources.ts` | X, I1 |
| The eight icon maps | I1 |
| The hand-kept `hasLandChanged` list in `world-mirror.ts` | K1 |
| The switches in `effect-view.ts` and `effect-sounds.ts` | E2, E3 |
| `VARIANT_COUNTS`, `TREE_LOOKS`, `FOLIAGE_KEYS`, `APPEARANCES`, `ANIMAL_MARKERS` | E4 |
| `hashToUnit` and `RandomSource.derive` in deterministic code | D2, D5 |
| `z.custom` in `saved-world.ts`; `OLDER_SAVE_PLANT_SPECIES` and the v1 snapshot loader | S2 |
| Comlink, react-markdown, remark-gfm, full `zod` | K1, I4, I3 |
| `ts-morph` | after M7 |
