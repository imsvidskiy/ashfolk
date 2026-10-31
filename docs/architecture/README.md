# Architecture research

Everything behind [plan.md](../plan.md), as the research run produced it. The run read `main` at v0.10.0.

## How the plan was made

| Step | Agents | Output |
| --- | --- | --- |
| Brief | — | [brief.md](brief.md): the owner's ask, constraints and facts about the code |
| Research | 7 code readers, 7 web researchers | [research/](research/) |
| Propose | 3 architects, one stance each | [proposals/](proposals/) |
| Critique | 5 critics per proposal | [critiques/](critiques/) |
| Synthesize | 1 chief architect | [plan-draft.md](plan-draft.md) |
| Validate | 4 validators: facts, red team, completeness, owner | [validation.md](validation.md) |
| Revise | 1 editor | [plan.md](../plan.md) |

## Scores

Each critic scored one proposal from 1 to 10 through one lens.

| Proposal | Determinism | Performance | Extensibility | Migration | Simplicity | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| [Data-oriented evolution](proposals/evolve.md) | 6 | 6 | 5 | 4 | 5 | 5.2 |
| [ECS-first](proposals/ecs.md) | 6 | 6 | 5 | 4 | 4 | 5.0 |
| [Hard boundaries](proposals/packages.md) | 5 | 5 | 5 | 5 | 4 | 4.8 |

The plan builds on data-oriented evolution and grafts the best parts of the other two.

## Research reports

| Report | Question |
| --- | --- |
| [coupling](research/coupling.md) | How simulation systems call each other |
| [things](research/things.md) | Every kind of thing, where it lives and its implicit properties |
| [queries](research/queries.md) | Every "what is around me" lookup in the code |
| [boundaries](research/boundaries.md) | The real import graph between folders |
| [registration](research/registration.md) | What adding a power, kind, species, building, panel or cue touches |
| [determinism-saves](research/determinism-saves.md) | Random streams, inexact math, saves |
| [engine-ui-structure](research/engine-ui-structure.md) | Extension points on the main thread |
| [ecs](research/ecs.md) | TypeScript ECS libraries in 2026 |
| [games](research/games.md) | How RimWorld, Factorio, ONI, Noita and others model properties |
| [modules-ts](research/modules-ts.md) | Typed module systems and boundary tooling |
| [spatial-queries](research/spatial-queries.md) | Spatial query designs and indexes |
| [determinism](research/determinism.md) | Cross-engine math, hashing, replays, save formats |
| [worker-bridge](research/worker-bridge.md) | Comlink, messages, SharedArrayBuffer, OffscreenCanvas |
| [packages](research/packages.md) | What to drop, add and keep |

## Benches and probes

The numbers in the plan come from these scripts. They ran against a scratch copy of the v0.10.0 source, and their
imports point at that copy, so they don't run from the repository as they are.

| Folder | What |
| --- | --- |
| [bench/](bench/) | Reaction kernels, exact math, hashing, ECS costs; `bun.json` and `node.json` hold results |
| [bench/critic-perf/run/](bench/critic-perf/run/) | Generation, tick, advance and save compression on the real simulation |
| [critic-perf/](critic-perf/) | Field access, mover buckets, `exp` ports, fire distance and exposure clears |
| [critic-migration/](critic-migration/) | Generation and fingerprint time; import violations against the proposed package graph |
| [research/bench-scripts/](research/bench-scripts/) | Spatial index comparison |
| [validator/](validator/) | Import scanning and the worker closure |
| [editor-check/](editor-check/) | The plan's TypeScript sketches, typechecked |
| [tools/](tools/) | The import graph analysis behind the boundaries report |

Left out: downloaded packages, third-party and decompiled sources, the source copy, CPU profiles, and the generated
import graph that `tools/graph.py` rebuilds.
