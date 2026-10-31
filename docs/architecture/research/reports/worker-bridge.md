# Worker bridge for Ashfolk (research, Oct 2026)

## Today's bridge

- Comlink `expose`/`wrap`, four calls: `advance`, `createWorld`, `loadWorld`, `saveWorld` (`src/workers/simulation-worker-api.ts:19-24`, `src/workers/simulation-worker.ts:1-4`, `src/game/simulation-connection.ts:42-51`).
- It is a pull model with backpressure: `GameSession.update` keeps at most one `advance` in flight (`src/game/game-session.ts:138-154, 205-219`), and commands ride along with the next `advance`.
- The transfer list is written by hand in `frameBuffers` (`simulation-worker-api.ts:56-91`), though `buffersWithin` (`src/shared/buffers.ts:21`) can already walk any payload.
- Progress uses `proxy(onProgress)` (`simulation-connection.ts:57`), which opens a `MessageChannel` per call (Comlink `src/comlink.ts:213, 348`).

## 1. RPC options

| Option | State in 2026 | Fit |
|---|---|---|
| **Comlink 4.4.2** | Last npm publish 2024-11-07, last commit on main 2025-06-18, 124 open issues (GitHub API). Each call is a request with a reply keyed by a random UUID (`comlink.ts:632-649`). `transfer()` stores the list in a global `WeakMap` keyed by the object it is given (`comlink.ts:577-579`). It has no one-way events and no validation. `Remote<T>` is a typed `Proxy`. | It works, but the project is stale, and its proxy magic hides the protocol. |
| **birpc 4.2.0** (antfu, released 2026-08-19, ~0.5 KB) | Actively maintained. Supports `eventNames` for one-way calls and a `timeout` that defaults to 60 s (`src/main.ts:57, 197`). Requests are sent as `post(serialize(req))` with no transfer list (`main.ts:245`). | Typed in both directions. Transferables need a custom `post`, and the 60 s timeout must be turned off for long world generation. |
| **comctx 1.7.6** (published 2026-10-16, 123 stars) | Adapter-based, picks out transferables automatically, sends heartbeats ([dev.to](https://dev.to/molvqingtai/comctx-a-better-cross-context-communication-library-than-comlink-257l)). | Small project with a Comlink-style proxy API. Its main gain, many transports, does not apply to Ashfolk. |
| **Own typed protocol** (~150 lines) | — | It needs only about 6 message kinds, and the hot path is one message per frame. It is explicit, can be tested with a `MessageChannel` pair, and follows the style rules (no `Proxy`, no `as`). |

**Recommendation: drop Comlink and write a small project-owned protocol** under `engine/bridge/`:

- `ToWorker` is a discriminated union: `create`, `load`, `save`, `advance { realSeconds, commands }`, `dispose`. `ToMain` is: `progress`, `world`, `frame`, `saved`, `failed`. Requests carry integer ids.
- Zod validates commands only (under lockstep they also arrive from peers). Frames come from our own worker and stay unvalidated.
- One `send(message)` collects transferables with `buffersWithin`, so no hand-written list remains.
- Progress becomes plain `progress` messages.

If the owner wants a library, birpc is the only candidate, but it still needs a transfer wrapper.

## 2. Transferables vs SharedArrayBuffer

**Transferables are enough for Ashfolk.** Transferring an `ArrayBuffer` costs the same at any size, and cloned payloads up to about 10 KiB fit a 16 ms frame ([surma.dev, "Is postMessage slow?"](https://surma.dev/things/is-postmessage-slow/)). Frames are already diffs, and people and animals are packed into `Float32Array`s (`src/simulation/frame-packing.ts:52-236`). Keep the plain-object parts (chronicle, inspection, notices) small.

**What SAB would require.** The page must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` ([web.dev](https://web.dev/articles/coop-coep)), and the worker script needs COEP as well.

Consequences of turning it on:

- **Popups:** COOP severs `window.opener` and all communication with cross-origin popups. A future OAuth popup for cloud saves would break; redirect flows still work.
- **Whop:** the current link-out (`src/features/project/project-links.tsx:7`, new tab) is unaffected. Whop's embedded checkout loads an iframe and a CDN script ([docs.whop.com/payments/checkout-embed](https://docs.whop.com/payments/checkout-embed)). Under `require-corp` that iframe is blocked unless Whop sends CORP/COEP.
- **Safari:** it does not support `COEP: credentialless` (MDN BCD: Safari `false`; Chrome 96, Firefox 119; [caniuse](https://caniuse.com/mdn-http_headers_cross-origin-embedder-policy_credentialless)).
- **Document-Isolation-Policy:** it isolates without the popup and iframe costs ([Chrome blog](https://developer.chrome.com/blog/document-isolation-policy)), but it is Chromium-only: Chrome 137 desktop, Android 146. BCD lists Firefox and Safari as `false`.
- **Embeds:** an embedded game must have `allow="cross-origin-isolated"` and an isolated parent page (web.dev). itch.io has a "SharedArrayBuffer support" toggle, but forum reports say it fails in external iframes ([itch.io thread](https://itch.io/t/3288882/cant-embed-into-iframe-sharedarraybuffer)).
- **PWA:** Workbox serves `index.html` with its cached headers, so isolation starts only after the service worker updates (`skipWaiting: true`, `vite.config.ts:87`).
- **Code:** Ashfolk loads no third-party subresources, so `require-corp` itself costs little.

**Setting the headers on Cloudflare** if it is ever needed:

- `_headers` does **not** apply to responses generated by the Worker ([CF docs](https://developers.cloudflare.com/workers/static-assets/headers/); limits: 100 rules, 2,000 characters per line).
- `run_worker_first` covers `"/"` (`wrangler.jsonc:18`), so the document comes from `worker/index.ts:77`. Copy the `ASSETS.fetch` headers into a new `Headers` there, add COOP/COEP, and also add a `/*` block in `public/_headers` so `/assets/*.js`, including the worker script, carries COEP.

**Verdict:** do not enable SAB now. Keep a seam instead: a frame section's transport is an implementation detail, so a section can later switch to "shared" when `crossOriginIsolated` is true.

## 3. Double/triple-buffered snapshots with Atomics

How it would work:

- Pattern: three slots in one SAB plus an `Int32Array` control word. The simulation writes into its back slot and publishes it with `Atomics.exchange(latest, back)`. The renderer swaps its front slot with `latest` once per rAF. Neither side blocks, and torn reads are impossible.
- Reference: Mozilla's wait-free SPSC ring buffer [padenot/ringbuf.js](https://github.com/padenot/ringbuf.js) (it requires COOP/COEP).
- `Atomics.wait` cannot block the main thread. Use rAF polling or `Atomics.waitAsync` (BCD: Chrome 90, Safari 16.4, Firefox 145).

When it would pay off:

- It only beats transfers when the renderer needs **full** fields every frame (a 640²×4 B heat texture is 1.6 MB) or with several simulation workers. Lockstep wants one deterministic simulation thread.
- It needs fixed-size slots, but diffs vary in size. **Not recommended.**

## 4. OffscreenCanvas + three.js WebGPU in a worker

- **APIs are there in 2026:** `OffscreenCanvas.getContext('webgpu')` and `WorkerNavigator.gpu` are in Chrome (113 with partial platform coverage, full from 144), Firefox 141 (partial: Windows, Apple Silicon macOS 145/147, no Linux or Intel Mac) and **Safari 26** (MDN BCD; [gpuweb Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status); [WebKit Safari 26](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)).
- **three.js:** `WebGPURenderer` gained worker support in r161 ([PR #27520](https://github.com/mrdoob/three.js/pull/27520)). There is still **no official WebGPU offscreen example**, and the Inspector cannot run in a worker because it depends on the DOM ([#33251](https://github.com/mrdoob/three.js/issues/33251), closed "not planned" in March 2026). Import maps do not work in workers; Vite bundles, so that is no problem.

**Verdict:** this is feasible, but keep rendering on the main thread.

- `WorldMirror` also feeds picking, the hand tool, audio, labels and the HUD. A render worker means a third thread, with input, labels, photo and filming, and `shots` all going through a proxy.
- Fix HUD jank first with narrow Zustand selectors.
- Insurance: `src/rendering` already uses no `window`, `document` or `navigator` (grep: 0 files). Lock it in with Biome `noRestrictedGlobals` for `rendering/**`.

## 5. Frame sections declared by modules

Extend plan.md's `FrameSection` (`docs/plan.md:300-329`) into **a pair, one per side**, both living in the module folder:

```ts
// module/frame.ts (worker side, imported by the simulation registry)
interface FrameSection<Key extends string, Payload> {
  readonly key: Key;
  readonly build: () => Payload | null;
}
// module/mirror.ts (main side, imported by the mirror registry)
interface MirrorSection<Key extends string, Payload> {
  readonly key: Key;
  readonly apply: (mirror: MirrorWriter, payload: Payload) => void;
}
```

- **Shared types:** payload types go in a `module/frame-types.ts` that both sides import. The rules "the simulation never imports rendering" and "the engine never imports React" stay intact.
- **Frame type:** `Frame = { tick, stateHash, sections: Partial<{ [K in SectionKey]: PayloadOf<K> }> }`, derived from the registry with a mapped type, not declaration merging. A missing key means "unchanged".
- **Transfers:** collected with `buffersWithin(frame)`. A dev check fails when a transferred buffer belongs to a live store, as plan.md asks.
- **Guard test:** the two registries must have the same key set, and keys must be unique.
- **Apply order:** registry order (terrain, then water, then vegetation, as the mirror does today).
- **Result:** a new field is edited in one folder, not in `frame.ts`, `FrameBuilder` and `frameBuffers`.

## 6. Lockstep

- `advance` carries `{ tick, player, command }[]`; each frame returns `stateHash`.
- Networking can live **in the simulation worker**: WebSocket works in workers, and `RTCDataChannel` can be transferred to one (BCD: Chrome 130, Firefox 144, Safari 15). Peer commands then skip the main thread, so React jank cannot delay ticks.
- The pull model stays for pacing; the worker holds a tick until all peers' commands arrive.

## Summary

1. Replace Comlink with a ~150-line typed protocol in `engine/bridge`.
2. Keep transferables and diffs. No SAB or COOP/COEP: they cost Whop embeds, OAuth popups and portal embeds, and Safari lacks `credentialless`. Keep a per-section transport seam.
3. No triple buffer.
4. Keep the renderer on the main thread, and enforce DOM-free `rendering/` with Biome.
5. Paired frame and mirror sections per module, typed from the registry, with automatic transfers.
