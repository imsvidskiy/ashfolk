# ECS libraries for TypeScript (late 2026) and whether Ashfolk should adopt one

## Verdict

- **Don't adopt an ECS library for the simulation.** No candidate gives Ashfolk what it lacks: kind properties, spatial context queries, transferable frames, and exact deterministic snapshots. Compared with the typed arrays Ashfolk already has, each one costs 10–18× more memory per entity and 150–490× more time per spawn or despawn.
- **Build a small in-house "thing store" in ECS shape**: generational ids, typed-array columns declared by a schema, tag bitsets, cached queries, id-column relations, dirty bitsets, and a per-cell spatial index. bitECS 0.4 is the closest model to copy.
- **If a library is ever used, use bitECS 0.4** and keep your own typed-array columns. Koota only fits a main-thread React world, Miniplex and Javelin are stale, and Becsy is heavy and opinionated.

## Libraries (npm registry and GitHub API, read 2026-10-31)

| | bitECS | Koota | Miniplex | Becsy | Javelin |
|---|---|---|---|---|---|
| Latest | 0.4.0, 2025-12-06; last push 2026-08-24 | 0.6.6, 2026-04-09; canaries daily (perf PRs #304–#317, Oct 2026) | 2.0.0, 2023-07-16; one deps-only commit 2026-04 | 0.16.1, 2026-10-02 | 1.0.0-alpha.13, last publish 2023; repo pushed 2023-08 |
| Maintainers | 1 (natethegreatt) | 1 main author (krispya, 740 of ~770 commits) | 1 | 1 (pkaminski) | abandoned |
| Downloads/month | 67k | 262k | 40k | 5k | — |
| Storage | **any shape you choose**; SoA typed arrays recommended | schema traits = SoA, but **plain JS arrays** (`store[key] = []`, `packages/core/src/storage/stores.ts`); objects go AoS via callback | plain objects | per-field ArrayBuffers; `sparse`/`packed`/`compact` per component | objects |
| Relations | `createRelation`, exclusive, auto-remove, wildcard, `IsA` prefabs, `Hierarchy`/`Cascade` topological queries | relations with stores, exclusive, autoDestroy, wildcard; ordered relations experimental | none | `ref`/`backrefs` with referential integrity | — |
| Change detection | none built in; `onAdd`/`onRemove`/`onSet` observers | `Added`/`Removed`/`Changed` modifiers, `onChange`; shallow and needs `entity.set` (direct `useStores` writes bypass it) | add/remove events only; `where` isn't reactive | reactive `changed` queries with write tracking | — |
| Workers / SAB | "thread-friendly": `asBuffer` gives SAB-backed `Uint32Array` query results; structural changes only on the owning thread | not mentioned; plain arrays can't be transferred | no | "multi-threading is not yet implemented" | — |
| Serialization | SoA/AoS (with diff mode), observer and snapshot serializers | none (`feat/snapshots` branch unmerged) | none | none | had patch-based net sync |
| Iteration order | swap-remove sparse set (`src/core/utils/SparseSet.ts:22-28`); `sort()` available | swap-remove dense index; README: "without any ordering" | reverse iteration | sparse/packed; deleted entities linger up to 2 frames | — |
| Ids | 32-bit, optional `withVersioning` | 4 bits world, 8 bits generation, 20 bits id: max 1,048,575 per world (`pack-entity.ts`) | object refs | declared capacity | — |
| Typing | TS source, but components are untyped references | best inference; React hooks; peer dependency on react | good generics | decorators or `static schema` | — |
| Size (min+gzip) | 5.7 kB | 10.7 kB | 3.7 kB | 25.7 kB | — |

Newer options, none ready: **apecs** 0.1.0 (archetype tables with typed-array columns; one release, 2026-09-07). **@typeonce/ritmo** 0.19 (created 2026-10-17; 34–67× slower than bitECS at iteration). **@esengine/ecs-framework** is aimed at Cocos. **sim-ecs** and **thyseus** are stale.

Sources: https://github.com/NateTheGreatt/bitECS (docs/Intro.md, docs/Serialization.md, docs/Multithreading.md) · https://github.com/pmndrs/koota · https://github.com/hmans/miniplex · https://lastolivegames.github.io/becsy/guide/introduction · https://lastolivegames.github.io/becsy/guide/architecture/components · https://github.com/LastOliveGames/becsy/blob/main/CHANGELOG.md · https://github.com/3mcd/javelin · https://registry.npmjs.org/{pkg} · https://bundlephobia.com

## Cost compared with hand-written typed arrays

Source: https://github.com/diffusionstudio/apecs/blob/main/bench/compare/REPORT.md (M1, Node 20, 2026-09-06; µs per operation, lower is better). The report is by the apecs author, but its hand-written baseline makes the comparison usable.

| Case | Hand-written | bitECS 0.4 | Koota 0.6.6 | Becsy |
|---|---|---|---|---|
| simple_iter (100k) | 122 | 161 | 513 | 3021 |
| entity_cycle (spawn/despawn) | **247** | 36,413 | 74,436 | 120,303 |
| add_remove (structural) | 132 | 17,329 | 26,158 | 3,623 |
| random_access | 111 | 137 | 219 | 737 |
| **Bytes per entity** (16 B payload) | **16** | 237 | 294 | 154 |

A second benchmark by a different author gives the same ranking: bitECS is 1.5–2.5× faster than Koota and 15–26× faster than Miniplex at iteration (https://github.com/typeonce-dev/ritmo/pull/77, 2026-10-24).

## Fit for Ashfolk, by data class

**Cells (409,600–590k).** Cells aren't entities. Every ECS would only wrap the existing `Float32Array` fields on `WorldState`. Adopting one changes nothing here.

**Plants (up to ~500k).** `VegetationStore` holds 7 float32 and 2 uint8 channels (`src/world/vegetation-store.ts:12-22`, constructor `:113-128`), a per-cell linked list (`#firstInCell`/`#nextInCell`, `:90-93`) and a free list. That is about 40 B per plant, ~20 MB in total. At the measured per-entity overhead:
- bitECS would use about 130 MB and Koota about 160 MB (their overhead on top of the ~40 B payload).
- Burning, felling and regrowth are spawn/despawn churn, where hand-written code is 147× (bitECS), 301× (Koota) and 487× (Becsy) faster.
- No ECS has a spatial index. bitECS keeps a `SpatialGrid` in `src/utils/threading`, but its package `exports` don't expose it. "Trees near this point by species" would still need the per-cell list.

**Agents, animals, buildings, hazards (a few thousand).** This is where an ECS could pay off. Today these are object records: `Person` (`src/simulation/society/person.ts:46`, nesting `mover` and `job` objects), `Building` (`society/buildings.ts:24`), `Animal` (`fauna/fauna.ts:55`), `Volcano` (`powers/volcanoes.ts:61`) and `Ember` (`nature/embers.ts:9`). Each kind has its own list and loops. An ECS would give uniform queries ("everything burnable near X", "everything grabbable"), relations (member of tribe, works at, carried by) and change flags. At this scale, though, a hand-rolled store gives the same at no measurable cost, without the blockers below.

## Blockers specific to Ashfolk

1. **Deterministic snapshots and lockstep.** bitECS's snapshot deserializer calls `addEntity` and remaps ids (`src/serialization/SnapshotSerializer.ts:225-261`). After a load, the ids, the free-list order and the swap-remove iteration order differ from those of an unbroken run. A replay or a lockstep resync then diverges unless you also serialize the library's private entity index. Koota has no serializer. Ashfolk already saves exactly this state: vegetation `freeSlots` and `nextInCell` (`vegetation-store.ts:61-62`) and `IdentifierSource.restore` (`src/simulation/identifiers.ts`).
2. **Frames.** Koota's stores are JS arrays, so each frame would need a copy into typed arrays before transfer. Becsy's buffers are internal. Only bitECS (with your own arrays) keeps today's zero-copy transfer.
3. **Self-describing saves.** None of the serializers keeps name tables or defaults for new fields. Ashfolk would write its own format anyway.
4. **Order is in lists people read.** Becsy orders systems by declared data dependencies, which conflicts with the explicit step list in plan.md.
5. **Code style and risk.** Every candidate is pre-1.0 with one maintainer. Koota pulls in React as a peer dependency inside the worker. Library types (`entity.get(Trait)` returning `T | undefined`, untyped bitECS components) push code toward the `as` and `!` that the house style forbids.

## What to take: a hand-rolled "thing store" (~600–900 lines, `src/world/things/` or similar)

- **Ids:** dense slots plus a generation in a `Uint32Array` (bitECS `withVersioning` / Koota `pack-entity`). Save the free list and generations verbatim so loads are bit-exact.
- **Columns:** each module declares `{ name, type: "f32" | "u8" | "i32", default }`. Columns are typed arrays grown by doubling. A save writes column names, so a missing column takes its default: self-describing, no migrations.
- **Kind properties via Type Object:** `kind: Uint16Array` points into content records (flammable, grabbable, windResistance, species…). Rules read properties, not kinds.
- **Tags:** one bitset `Uint32Array` per tag, or a `Uint32Array` mask per thing for up to 32 tags.
- **Queries:** cached match lists rebuilt on structural change. **Always iterate in ascending slot order** (a sorted dense list, or a scan of the bitset): stable across save and load, unlike swap-remove.
- **Relations:** id columns (`tribe`, `home`, `workplace`, `carriedBy`) plus a lazily rebuilt reverse index. Keep Bevy/Flecs-style `ChildOf` only if hierarchies actually appear.
- **Change tracking:** a dirty bitset per column group, cleared by `FrameBuilder`. This replaces the hand-listed frame fields (three edits per field today) with a schema walk.
- **Spatial index:** per-cell head/next `Int32Array` per store, generalising `VegetationStore`'s list. A `context.near(cell, radius, { tag, kind })` API sits on top of it, together with cell field reads (biome, fire, heat). This answers the owner's tornado example.
- **Plants stay a specialised store** with the same column, tag and spatial interfaces, so rules can't tell it apart from a generic store.

Revisit a library only if the main thread grows its own entity world (Koota's React hooks), or if bitECS reaches 1.0 with a serializer that keeps the entity index.
