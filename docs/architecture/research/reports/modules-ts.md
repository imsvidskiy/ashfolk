# Typed modules and enforced boundaries for Ashfolk (web research, Oct 2026)

## Verdict

- **Stay one package.** Don't add Bun workspaces, Nx or Turborepo now.
- **A module is one folder:** a UI-safe manifest `module.ts`, plus `simulation/`, `engine/` and `interface/` sides.
- **Registration is explicit and typed:** `as const` lists, plus records over a mapped id type, so `tsc` fails when an
  entry is missing. Use no global declaration merging and no globs.
- **Boundaries have three tiers:**
  1. Composite tsconfig projects per layer: a hard check on resolved paths.
  2. Biome: bans on bare packages and GritQL bans on non-deterministic calls, shown in the editor.
  3. dependency-cruiser in CI: isolation between sibling modules, transitive reachability from the worker, and cycles.

## Prior art: what to take

- **Bevy 0.20.1:** a `Plugin` has `build`, `ready`, `finish` and `cleanup`, and a group "builds the contained Plugins
  in the order specified" ([docs.rs](https://docs.rs/bevy/latest/bevy/app/trait.Plugin.html)). Take one
  `create(context)` per module per thread, returning systems, handlers and save and frame sections, in an explicit
  order. Leave out implicit dependencies between plugins.
- **VS Code contribution points:** "a set of JSON declarations… in the `contributes` field". The UI renders from the
  manifest and the code activates later
  ([docs](https://code.visualstudio.com/api/references/contribution-points)). Take `module.ts` as static data (ids,
  power definitions, icon names, i18n keys) that the HUD and the worker read without loading any side.
- **Rollup and Vite hook kinds:** `first` runs "until a hook returns a value other than null", `sequential` runs in
  plugin order, and hooks may set `order: "pre" | "post"` and a `filter`
  ([Rollup](https://rollupjs.org/plugin-development/), [Vite](https://vite.dev/guide/api-plugin)). Take typed kinds
  for module contributions:
  - `first` for pick and grab resolution. This replaces the 5-file grabbable chain (`grab-target.ts`,
    `grab-handlers.ts`, `entity-picker.ts`, `hand-motion.ts`, views).
  - `sequential` for systems.
  - A declarative `filter`, such as `{ kinds: ["tree"] }`.
  - Order comes from pre/post buckets plus list order, with no topological sort.

## TypeScript mechanics

- **`as const satisfies`** keeps literal ids and still checks the shape. It is already in use:
  `src/content/powers.ts:401`.
- **A mapped record over an id union gives exhaustiveness.** `src/simulation/powers/power-registry.ts:28` has
  `type PowerHandlers = { readonly [Id in PowerId]: PowerHandler<Id> }`, and a missing handler is a compile error.
  Generalize this to every per-side registry, and to properties and fields: `FIELDS` gives `FieldId`, and queries
  are typed by key.
- **`const` type parameters** (TS 5.0, [notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters))
  for `defineModule`, `defineThingKind` and `defineProperty`, so callers never write `as const`.
- **`NoInfer`** (TS 5.4, [notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html#the-noinfer-utility-type))
  stops a handler argument from widening the inferred `Id`.
- **Declaration merging** (`interface Registry {}` augmented per module, like TanStack Router's `Register`,
  [docs](https://tanstack.com/router/latest/docs/framework/react/guide/type-safety)): reject it for internal
  registries.
  - The interface is open, so a missing entry is never detected.
  - An augmentation exists only when its file is in the program, so split tsconfig projects can see different
    registries.
  - It has no runtime value, so a list is still needed
    ([handbook](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)).
  - Keep it for third-party types only, as in `src/content/parameters.ts:66` (`declare module "zod"`).
- **Branded ids** (`ThingId`, `CellIndex`, `ModuleId`): the style rules forbid `as`, so build them with zod `.brand()`
  at the worker boundary or with a type predicate. Zod notes branding is "a static-only construct"
  ([zod](https://zod.dev/api?id=branded-types)). Keep raw numbers inside typed-array kernels.
- **Explicit lists beat `import.meta.glob`.**
  - Globs are lazy chunks by default, and Vite doesn't document key order
    ([Vite](https://vite.dev/guide/features#glob-import)). Order tied to file names risks the lockstep hash.
  - Knip skips export analysis for glob targets, and each thread would need its own glob.
  - Merge cost at 30–100 PRs a day is small. ultracite turns on `useSortedKeys`
    (`node_modules/ultracite/config/biome/core/biome.jsonc:86`), so only adjacent keys conflict. A conflict in the
    step-order list is semantic and *should* stop the merge.

```ts
// src/modules/modules.ts — the only list; manifests are UI-safe
export const MODULES = [tornadoModule, volcanoModule] as const;
export type ModuleId = (typeof MODULES)[number]["id"];

// src/simulation/core/simulation-modules.ts — missing or extra key fails tsc
export const SIMULATION_MODULES = {
  tornado: tornadoSimulation,
  volcano: volcanoSimulation,
} as const satisfies { readonly [Id in ModuleId]: SimulationModule<Id> | null };
```

A new module touches its own folder plus four sorted one-line entries: `MODULES`, then the simulation, engine and
interface records. Each entry is checked by `tsc`.

## Boundary tools: facts

| Tool | Resolves paths | Rules across siblings | Transitive | Status | Role |
| --- | --- | --- | --- | --- | --- |
| Composite tsconfig projects | yes | through `references` | no | TS 7.0 stable on Jul 8 2026; repo has `typescript ^7.0.2` | hard gate |
| Biome `noRestrictedImports` | no, it matches specifier text | no captures | no | 2.6.3 in the repo | bare packages |
| Biome GritQL plugins | no | no | no | diagnostics plus rewrites | determinism bans |
| dependency-cruiser | yes | `$1` group matching | `reachable` | 18.7.0 | CI graph rules |

- **tsconfig.**
  - With `composite`, "all implementation files must be matched by an include pattern… `tsc` will inform you". Imports
    from a referenced project load its output `.d.ts`, so compiler options don't leak between projects
    ([handbook](https://www.typescriptlang.org/docs/handbook/project-references.html)).
  - The references graph becomes the layer table. Circular references are rejected (TS6202).
  - TS 7 adds `--builders` for parallel project builds under `--build`. The flag is experimental
    ([7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/),
    [RC](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/)).
  - TS 7.0 has no JS API ("We expect TypeScript 7.1 to ship with a new… API"). Tools built on it need the
    `@typescript/typescript6` alias. Knip 6.43 uses `oxc-parser`, so it is unaffected.
  - Today only the engine project is composite (`tsconfig.engine.json:5`), and the app project isn't.
- **Biome.**
  - `noRestrictedImports` takes gitignore-style `patterns` with negation and no captures
    ([rule](https://biomejs.dev/linter/rules/no-restricted-imports/)). It suits `three`, `react`, `zustand` and
    `comlink`, as the current overrides do (`biome.jsonc:32-92`).
  - `noPrivateImports` lets a `@package` export reach "the same folder, or one of its subfolders", and has a
    `defaultVisibility` option ([rule](https://biomejs.dev/linter/rules/no-private-imports/)). It needs JSDoc tags,
    which clash with the no-comments style. ultracite turns it off (core `:312`).
  - `noImportCycles` is "computationally expensive" ([rule](https://biomejs.dev/linter/rules/no-import-cycles/)), and
    ultracite turns it off (core `:600`).
  - GritQL plugins report diagnostics, rewrite with `=>` and take `includes`. They lack "the semantic model, file kind"
    ([plugins](https://biomejs.dev/linter/plugins/)).
- **dependency-cruiser.**
  - It supports group matching (`no-inter-ubc`: `pathNot: "^src/business-components/$1/.+"`), `reachable` and
    `type-only` ([rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)).
  - In 18.7.0 the swc parser handles "all ts\* variants". 18.3.1 fixed swc under Bun. Support for TS 7.1 or later is
    only in 18.8.0-beta-1 ([releases](https://github.com/sverweij/dependency-cruiser/releases)). So use
    `parser: "swc"` now, which needs no TS API.
- **Skip these.**
  - **Sheriff** uses barrel `index.ts` files and needs the TS peer ([repo](https://github.com/softarc-consulting/sheriff)),
    which clashes with ultracite's `noBarrelFile: "error"` (core `biome.jsonc:345`) and with TS 7.0.
  - **Nx** has an ESLint or Oxlint rule, or Enterprise Conformance, and no Biome option
    ([nx](https://nx.dev/docs/features/enforce-module-boundaries)).
  - **`turbo boundaries`** is experimental and works per package
    ([turbo](https://turborepo.dev/docs/reference/boundaries)). Ashfolk is one Vite app.
- **Bun workspaces** offer `workspace:*` and catalogs ([bun](https://bun.com/docs/pm/workspaces)). The isolated
  linker is the default for new workspace lockfiles and blocks phantom dependencies
  ([isolated](https://bun.com/docs/pm/isolated-installs)). Just-in-time packages that export `.ts` can't use `paths`
  ([turbo](https://turborepo.dev/docs/core-concepts/internal-packages)).
  - The decisive cost: a module folder can't span the worker and main packages. Packages per module would add a
    `package.json` and a `bun.lock` edit for every power, which invites merge conflicts.
  - Revisit when a second deployable needs shared code, such as a lockstep relay that shares the command schemas.
    Then extract `packages/protocol`.

## Recommendation

1. **Composite projects by layer, all referenced from `tsconfig.json`:**
   - `core`: shared, content, world, mirror and `src/modules/*/module.ts`.
   - `simulation`: elements, generation, simulation, workers and `src/modules/*/simulation`. References `core`.
   - `engine`: models, rendering, audio, game and `src/modules/*/engine`. References `core`.
     The first three keep `noUncheckedIndexedAccess` off.
   - `interface`: stores, design, features, pages, app and `src/modules/*/interface`. Keeps
     `noUncheckedIndexedAccess` on and references `core` and `engine`.

   With this layout, a simulation file that imports `rendering/` fails `tsc`. Run `tsc --build --builders 4`.
2. **The module contract:** a manifest plus `SimulationModule`, `EngineModule` and `InterfaceModule` factories,
   contributing through typed hook kinds and registered over the mapped `ModuleId`.
3. **dependency-cruiser in CI** (`bun run boundaries`), with these rules:
   - No imports between sibling modules: from `^src/modules/([^/]+)/` to `^src/modules/[^/]+/`, with
     `pathNot` `^src/modules/$1/`.
   - The worker never reaches `three`, `react` or `zustand`: from `src/workers/simulation-worker.ts`, with
     `reachable: true`.
   - `no-circular`, with `dependencyTypesNot: ["type-only"]`.
4. **A GritQL determinism plugin**, with `includes` set to simulation, generation, world, shared and content, which
   have 399 `Math.(sin|cos|…|random)(` calls today. It measures the lockstep migration and blocks regressions.
   Untested sketch:

```grit
`Math.$name($args)` where {
  $name <: or { `random`, `sin`, `cos`, `tan`, `atan2`, `exp`, `log`, `pow`, `hypot` },
  register_diagnostic(span = $name, message = "Deterministic code uses shared exact math and seeded random.")
}
```

5. **Keep** the Biome bare-package bans and knip. Add nothing else: no Nx, Turborepo, Sheriff or ESLint.
