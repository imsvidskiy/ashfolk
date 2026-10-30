# Ashfolk

A god simulator about the first tribes on a floating island, in TypeScript with three.js and React. The
[README](README.md#architecture) has the code map, and [CONTRIBUTING.md](CONTRIBUTING.md) has the code style,
commits, pull requests and releases. This file lists what agents tend to miss.

## Commands

```sh
bun run check      # Biome lint and format; bun run fix applies fixes
bun run typecheck  # tsc --build over the engine, app and tooling projects
bun run knip       # unused files, exports and dependencies
bun run test       # unit tests in Node, browser tests in Chromium
```

- Run all four before you push. Browser tests need Chromium; [Scripts and checks](CONTRIBUTING.md#scripts-and-checks)
  shows how to point them at a system one.
- Run one area with `bunx vitest run --project unit src/generation`.
- Merging to `main` deploys ashfolk.com. Leave merges and [releases](CONTRIBUTING.md#releases) to a person
  unless they ask.

## Seeing a change

- Visible changes are checked by looking. Open a reproducible scene, such as
  `?seed=7&shape=round&quality=high&paused=1&hours=11&camera=x,z,distance,pitch,yaw`, and compare screenshots before
  and after at 1440×900, 768×1024 and 390×844. Keep the screenshots outside the repository.
- Look at a far view too. Water, terrain and vegetation switch level of detail with distance.
- `bun run shots <dev server url> <folder> [scene ...]` shoots the scenes in `tests/scenes.ts`, or `name=query`
  scenes you pass, at those three sizes. It runs system Chrome headless with `--use-angle=metal --enable-gpu`, so it
  renders on the GPU without opening a window, and prints the WebGPU adapter. Add a scene there when you fix a bug
  that only shows by eye.
- Playwright's own headless Chromium uses SwiftShader and renders in software, so colors and some WebGPU paths differ.
  Say which browser you used.
- In development the engine is on `window.ashfolk`: `session.frame` holds the tribes, weather and calendar, `camera`
  the view, and `powers` the active tool.

## Shipping a change

- `/ship <worktree> [auto|light|full]` runs the saved workflow in `.claude/workflows/ship.js` on a committed branch:
  the checks, read-only reviewers from `.claude/agents`, a verifier per finding, one fixer, the `code-style` agent,
  screenshots before and after for rendering or interface changes, and the checks again. Light mode runs only the
  bugs reviewer; auto picks full for changes over 200 lines or ones that touch the world, simulation, saves or shaders.
- It doesn't push or open the pull request. Read its report, then push and open the pull request yourself.

## Rules that are easy to miss

- The code style is in [CONTRIBUTING.md](CONTRIBUTING.md#code) and isn't repeated here. The `code-style` agent in
  `.claude/agents` reviews a change against it.
- The engine never imports React, and the simulation never imports rendering. The `noRestrictedImports` overrides in
  `biome.jsonc` enforce this. The UI reads the session through small Zustand stores and sends commands, which zod
  validates at the worker boundary.
- Generation and the simulation are deterministic for a seed. Take randomness from a `RandomSource` or `hashToUnit`,
  never `Math.random`, and keep the order of draws stable, because tests pin worlds by seed. Only rendering effects
  and the default seed may use `Math.random`.
- Water has one rule: `hasWater` and `touchesWaterCell` in `src/world`. Planting, regrowth, grass and the water shader
  must agree on it, or plants stand in rivers.
- Terrain and water share their level of detail per patch. A shader that reads a neighbor cell must account for the
  patch step, or far views break.
- The island edge is one outline per shape, in `rendering/terrain/island-outline.ts`. Terrain, water, grass and rain
  are cut by it. Plants keep clear of the coast through `hasRoomFromCoast`.
- Shaders are TSL node graphs. Keep large numbers out of float hashes: float32 loses precision past 16 million.
- The engine projects compile with `noUncheckedIndexedAccess` off for typed arrays; the app keeps it on.
- Game things (powers, resources, buildings, weather, events) use `design/game-icon.tsx` with the painted WebP icons
  in `design/icons`; commit only the final WebP, not masters. Interface controls use `lucide-react` in the text
  color.
- Panels are islands from `design/island.tsx`: solid paper, no glass or blur. Islands in one row have the same height.
- Saves store technology ids, plant species names and snapshot fields. Renaming one breaks old saves unless loading
  maps it.
- Several agents may share this checkout. Work in your own `git worktree`, stage only your own files, and remove only
  the worktrees and branches you created.
