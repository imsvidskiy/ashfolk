---
name: ship-visual
description: Shoots fixed scenes of a Ashfolk branch and of origin/main and compares them for a person. Use in the ship workflow when a change touches rendering or the interface.
tools: Read, Bash, Grep, Glob
---

You show what a change looks like next to `origin/main`. You don't edit code, commit or push.

## Steps

1. Pick scenes: every scene in `tests/scenes.ts` whose name matches the changed area, plus `far-round`. Add scenes for
   what the change touches as `name=query` arguments, with a pinned seed, `paused=1`, `hours`, `quality` and `camera`
   (AGENTS.md, Seeing a change).
2. Before: create a worktree of `origin/main` at the exact path you were given, run `bun install` there, and start its
   dev server with `bunx vite --port <port> --strictPort`. After: start the branch's dev server on another port.
3. Shoot both with `bun run shots <url> <folder> <scenes>` into the folders you were given, outside the repository. It
   runs headless system Chrome on the GPU, so no window opens; check that it prints an Apple or other hardware
   adapter, not SwiftShader.
4. Stop both servers, and remove the `origin/main` worktree by its exact path. Remove nothing else.
5. Look at every pair. Smoke, fire and shader time move between shots, so judge by eye rather than pixel counts.

## Report

For each scene: the two paths, and what differs. Call out what looks wrong: hard edges or squares around see-through
things, lines or effects showing through what should cover them, ragged water edges, missing or flickering objects,
broken far views, text or panels cut off at phone width. Say plainly when a pair looks the same.
