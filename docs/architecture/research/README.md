# Research

How the [architecture plan](../../plan.md) was made. A research run of many agents read `main` at v0.10.0, proposed
three designs, attacked each with critics and checked the result with validators. These are the run's records, kept
as written. The run measured the plan's numbers with benches and probes and typechecked its TypeScript sketches, all in
a scratch folder against a copy of the source. That folder wasn't kept, so the records' paths into it don't resolve.

The owner decided the plan's open questions afterwards, and where the records disagree with
[Decisions and risks](../decisions.md#owner-decisions) (a legacy reader, typed message tables, mods, lockstep later, a
fast-tracked S3), the decisions win.

## How the plan was made

| Step | Agents | Output |
| --- | --- | --- |
| Brief | — | [brief.md](brief.md): the owner's ask, constraints and facts about the code |
| Research | 7 code readers, 7 web researchers | [reports/](reports/) |
| Propose | 3 architects, one stance each | [proposals/](proposals/) |
| Critique | 5 critics per proposal | [critiques/](critiques/) |
| Synthesize | 1 chief architect | A draft plan, not kept |
| Validate | 4 validators: facts, red team, completeness, owner | [validation.md](validation.md) |
| Revise | 1 editor | The plan, now [plan.md](../../plan.md) and the [architecture files](../../plan.md#architecture-files) |

## Scores

Each critic scored one proposal from 1 to 10 through one lens.

| Proposal | Determinism | Performance | Extensibility | Migration | Simplicity | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| [Data-oriented evolution](proposals/evolve.md) | 6 | 6 | 5 | 4 | 5 | 5.2 |
| [ECS-first](proposals/ecs.md) | 6 | 6 | 5 | 4 | 4 | 5.0 |
| [Hard boundaries (workspace packages)](proposals/packages.md) | 5 | 5 | 5 | 5 | 4 | 4.8 |

The plan builds on data-oriented evolution and grafts the best parts of the other two;
[Why this design](../goals.md#why-this-design) lists what it takes from each.

## Research reports

| Report | Question |
| --- | --- |
| [coupling](reports/coupling.md) | How simulation systems call each other |
| [things](reports/things.md) | Every kind of thing, where it lives and its implicit properties |
| [queries](reports/queries.md) | Every "what is around me" lookup in the code |
| [boundaries](reports/boundaries.md) | The real import graph between folders |
| [registration](reports/registration.md) | What adding a power, kind, species, building, panel or cue touches |
| [determinism-saves](reports/determinism-saves.md) | Random streams, inexact math, saves |
| [engine-ui-structure](reports/engine-ui-structure.md) | Extension points on the main thread |
| [ecs](reports/ecs.md) | TypeScript ECS libraries in 2026 |
| [games](reports/games.md) | How RimWorld, Factorio, ONI, Noita and others model properties |
| [modules-ts](reports/modules-ts.md) | Typed module systems and boundary tooling |
| [spatial-queries](reports/spatial-queries.md) | Spatial query designs and indexes |
| [determinism](reports/determinism.md) | Cross-engine math, hashing, replays, save formats |
| [worker-bridge](reports/worker-bridge.md) | Comlink, messages, SharedArrayBuffer, OffscreenCanvas |
| [packages](reports/packages.md) | What to drop, add and keep |

## External sources

- [ECMA-262: properties of the Math object](https://tc39.es/ecma262/#sec-function-properties-of-the-math-object)
- [Floating point determinism, Glenn Fiedler](https://gafferongames.com/post/floating_point_determinism/)
- [Factorio Friday Facts #55, desyncs](https://factorio.com/blog/post/fff-55)
- [1500 archers on a 28.8: networking in Age of Empires](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)
- [Hash prospector (lowbias32)](https://github.com/skeeto/hash-prospector)
- [pure-rand](https://github.com/dubzzz/pure-rand)
- [Factorio: data lifecycle](https://lua-api.factorio.com/latest/auxiliary/data-lifecycle.html)
- [Factorio: migrations](https://lua-api.factorio.com/latest/auxiliary/migrations.html)
- [Factorio: LuaSurface queries](https://lua-api.factorio.com/latest/classes/LuaSurface.html)
- [RimWorld: ThingComp](https://www.rimworldwiki.com/wiki/Modding_Tutorials/ThingComp)
- [RimWorld: stats](https://rimworldwiki.com/wiki/Stat)
- [Minecraft: tags](https://minecraft.wiki/w/Tag_(Java_Edition))
- [Noita: reactions](https://noita.wiki.gg/wiki/Documentation:_Reaction)
- [The Powder Toy: WATR element](https://github.com/The-Powder-Toy/The-Powder-Toy/blob/master/src/simulation/elements/WATR.cpp)
- [Dwarf Fortress: syndromes](https://dwarffortresswiki.org/index.php/v0.34:Syndrome)
- [Game Programming Patterns: spatial partition](https://gameprogrammingpatterns.com/spatial-partition.html)
- [Game Programming Patterns: Type Object](https://gameprogrammingpatterns.com/type-object.html)
- [bitECS](https://github.com/NateTheGreatt/bitECS), [Koota](https://github.com/pmndrs/koota), [apecs benchmark report](https://github.com/diffusionstudio/apecs/blob/main/bench/compare/REPORT.md)
- [Bevy: Plugin](https://docs.rs/bevy/latest/bevy/app/trait.Plugin.html)
- [TypeScript: project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [TypeScript: `preProcessFile`](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Biome: plugins](https://biomejs.dev/linter/plugins/), [noRestrictedImports](https://biomejs.dev/linter/rules/no-restricted-imports/)
- [Bun: Transpiler](https://bun.com/docs/api/transpiler)
- [Zod Mini](https://zod.dev/packages/mini), [Zod codecs](https://zod.dev/codecs)
- [fast-check: model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)
- [Vitest: browser instances](https://vitest.dev/config/browser/instances)
- [GitHub: managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Is postMessage slow?, surma.dev](https://surma.dev/things/is-postmessage-slow/)
- [COOP and COEP, web.dev](https://web.dev/articles/coop-coep)
- [Cloudflare Durable Objects: WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [MDN: CompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream)
- [MDN: Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [MDN: Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)
- [Lingui CLI](https://lingui.dev/ref/cli), [Lingui configuration](https://lingui.dev/ref/conf)
