# Worker bridge and frames

The simulation runs in a worker. The main thread sends it messages, and the worker answers with frames: the state that
changed since the last frame. The main thread applies each frame to its mirror, `WorldMirror`, a copy of the world (a
`WorldReader`) that rendering, audio and the interface read. This file covers the message protocol that replaces
Comlink, and the frame and mirror sections that modules contribute. K1 in [Phase K](migration.md#phase-k-kernel)
builds it.

## Messages

Comlink goes. `core/protocol/messages.ts` defines generic message shapes, and `assembly/protocol.ts` instantiates them
with the assembled command union and frame keys. Each side has one `send` that collects transferables, the buffers
that `postMessage` moves instead of copying:

```ts
export type ToWorker<Command> =
  | { readonly id: number; readonly kind: "create"; readonly request: WorldRequest }
  | { readonly base: WorldBase | null; readonly id: number; readonly kind: "load"; readonly save: SaveEnvelope }
  | { readonly id: number; readonly kind: "save" }
  | { readonly commands: readonly Command[]; readonly kind: "advance"; readonly realMilliseconds: number }
  | { readonly id: number; readonly kind: "inspect"; readonly target: InspectionTarget }
  | { readonly kind: "dispose" };

export type ToMain<Sections> =
  | { readonly id: number; readonly kind: "progress"; readonly share: number }
  | { readonly id: number; readonly kind: "world"; readonly payload: WorldReply }
  | { readonly id: number; readonly kind: "saved"; readonly payload: SaveEnvelope }
  | { readonly id: number; readonly kind: "inspected"; readonly payload: Inspection }
  | { readonly frame: Frame<Sections>; readonly kind: "frame" }
  | { readonly id: number; readonly kind: "failed"; readonly reason: MessageDescriptor };
```

- **Pull model**, as today: an `advance` carries the commands and the real time since the last one, the worker answers
  with a frame, and one `advance` is in flight at a time. The worker's `TickSource` stamps the commands (see
  [Replays and lockstep](determinism.md#replays-and-lockstep)).
- **Validation:** `zod/mini` checks commands only, because under lockstep they arrive from peers. Frames are trusted.
- **No SharedArrayBuffer.** The COOP and COEP headers it needs would block the planned Whop sign-in popup and any
  embedded checkout, and Safari lacks `credentialless`. Transport stays internal to each section, so one can switch
  later.
- **Rendering stays on the main thread.** `engine/render` uses no DOM globals, and this is enforced, so a worker
  renderer stays possible.

## Frame sections

`core/protocol/frame.ts` and `engine/mirror/mirror-section.ts`:

```ts
export interface Frame<Sections> {
  readonly sections: Partial<Sections>;
  readonly step: number;
  readonly tick: number;
}

export interface FramePart<Payload> {
  readonly payload: Payload;
  readonly transfer: readonly ArrayBuffer[];
}

export interface MirrorSection {
  readonly apply: (mirror: MirrorWriter, raw: unknown) => WorldChanges;
  readonly key: string;
}
```

`Sections` is mapped from the assembled frame keys, and a missing key means unchanged. The payload type lives in the
module's `shared/`. `defineFrameSection` and `defineMirrorSection` erase it the same way
[save sections](saves.md#save-sections) do.

### Building and applying frames

- **One frame per advance** (up to 40 ticks) stays as today. What changes is that sections accumulate dirty state
  across ticks and clear it when built. Building a frame never mutates state that is saved or hashed.
- **Section kinds:** `rows` (cell-state pages), `regions` (height and water), `patch` (vegetation and dirty thing
  slots), `packed` (people, animals, transients, features).
- **Fire** goes as ignited and extinguished deltas into a mirror bitset, not as the whole burning set every frame.
- **Transfers** come from each section's `transfer` list. `buffersWithin` stays as a test oracle, and a development
  check fails when a transferred buffer belongs to a live store.
- **Change kinds.** `apply` returns the change kinds. They replace the hand-kept `hasLandChanged` list, the frame
  fields that today's `WorldMirror` (`src/game/world-mirror.ts`) counts as land. The `hasLandChanged()` function in
  `src/simulation/saved-world.ts` is a different check: it compares the generation fingerprint for the land-changed
  dialog.

### Readers and lasting effects

- Each mirror section exposes a typed subscribable reader. Interface stores subscribe to readers, and the engine never
  imports zustand.
- Lasting effects (tornadoes, embers, meteors) are transient things with frame rows, so a reload or a late joiner sees
  them. Only instant effects stay events (see [Events](kernel.md#events)).
