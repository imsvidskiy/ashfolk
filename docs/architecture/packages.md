# Packages

Which packages the plan removes, switches, adds, keeps and turns down, and why. The rule from the
[goals](goals.md#goals): drop what earns nothing and add only what removes work.

## Changes

Lingui arrives in I2; Comlink goes in K1, full `zod` in I3, react-markdown and remark-gfm in I4, and `ts-morph` after
M7 ([Phases](migration.md#phases)).

| Action | Package | Reason |
| --- | --- | --- |
| Remove | `comlink` | Last release 2024-11; its last fix never shipped. Lockstep needs messages, not a proxy. Saves 3.9 kB in each of two chunks. |
| Remove | `react-markdown`, `remark-gfm` | 100 of 122 runtime packages and a 50 kB gzip chunk that every player precaches, for one page. |
| Switch | `zod` → `zod/mini` | Same package; about 19 kB gzip less per chunk, 37 kB in all. Keeps `looseObject`, `codec`, `toJSONSchema`. |
| Add | Lingui 6: `@lingui/core`, `@lingui/react`; dev: `@lingui/cli`, `@lingui/vite-plugin`, `@lingui/babel-plugin-lingui-macro` | Translation, Russian first ([decision 3](decisions.md#owner-decisions)): extraction, PO catalogs, ICU plurals and a CI check for missing lines. About 10 kB gzip at runtime; the only new runtime dependency. [Strings](main-thread.md#strings) describes how the game uses it. |
| Add (dev) | `fast-check` | Save round trips, `save, load, run N = run N`, catalog reordering, the water rule, version skew. Depends only on `pure-rand`. |
| Add (dev, temporary) | `ts-morph` | Re-runnable moves; bundles its own TS 6, so TS 7 is fine. Removed when the moves end. |
| Later | `msgpackr` or `cbor-x` | Cloud saves, resync and replay export. Not before. |
| Optional | `idb` | If the save database grows beyond today's 304 lines of wrappers. |

## Kept

| Package | Reason |
| --- | --- |
| `pure-rand`, `simplex-noise` (exact already), `three`, `react`, `zustand`, Base UI, `tailwind-merge`, `clsx`, `lucide-react`, `vite-plugin-pwa`, `@fontsource-variable/nunito`, Babel and the React Compiler | Each still earns its place. Babel also runs the Lingui macro. |
| `@tailwindcss/typography` (dev) | Its `prose` classes still style the privacy page after I4; drop it if that page moves to plain styles. |

## Not added

| Package | Reason |
| --- | --- |
| ECS libraries | 10–18× the memory per entity, 150–490× slower spawn, and snapshot loaders that remap ids. |
| kdbush, flatbush, rbush, spatial hashes | A grid aligned to the cells is faster to rebuild and query, and deterministic. |
| dependency-cruiser and `@swc/core` | All imports are relative, so a short Bun script over `ts.preProcessFile` resolves the graph; 18 dependencies and a native binary buy nothing more. |
| Bun workspaces, Nx, Turborepo, Sheriff | A module spans threads; packages would split it and add a lockfile edit per power. |
| i18next, Paraglide | Lingui covers translation ([decision 3](decisions.md#owner-decisions)). i18next is 17.2 kB gzip with runtime string keys. Paraglide loses its typing for ids that come from the worker and saves. |
| Event buses, DI, RxJS, XState, immer, a router, wasm hashers, `fflate`, `valibot`, `@stdlib/*`, fixed point | No need found. |
