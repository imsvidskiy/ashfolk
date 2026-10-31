# Saves

A save in format 2, which S2 ships, is an envelope of named sections. Each section writes its state in a logical form,
not the memory layout. The format describes itself from its first release: catalog references go through name tables,
renames through `formerNames`, and new keys are additive with defaults. So reordering or renaming a catalog never
breaks a save, and saves keep loading across content changes without per-version migrations
([decision 2](decisions.md#owner-decisions)). This file covers save sections, the envelope and its name tables, the
logical schema, older saves and version skew between builds, the world base that stores the island on the device, and
the fixtures. [Phase S](migration.md#phase-s-saves) builds it.

## Save sections

`simulation/kernel/save-section.ts`:

```ts
export interface SaveSection {
  readonly isEssential: boolean;
  readonly key: string;
  readonly requires: readonly string[];
  readonly reset: () => void;
  readonly restore: (raw: unknown, names: NameReader) => RestoreOutcome;
  readonly write: (names: NameWriter) => unknown;
}

export function defineSaveSection<Saved>(spec: SaveSectionSpec<Saved>): SaveSection;
```

`restore` runs `spec.schema.safeParse(raw)` and hands the parsed value to the typed `spec.read`, so the narrowing comes
from zod/mini and needs no cast.

- Every field, store, built-in system and module that holds state contributes sections, each writing its
  [logical form](#the-logical-schema).
- A section that fails its schema resets, together with the sections that `require` it. An essential section
  (terrain, society, vegetation) refuses to load instead. In a lockstep resync any failure is fatal.

## The envelope and name tables

- **Envelope:** `{ format: 2, base: { id, hash }, names, sections }`. `base` points at the
  [world base](#the-world-base), `names` holds the name tables, and `sections` holds the save sections by key.
- **Index-coded catalogs** are saved as numeric indices, so they get name tables: grounds, biomes, plant species,
  plant states, crops, eras and monument damage. Columns and fields declare catalog references through `catalogRef(...)`
  codecs, and the name tables are collected from the codecs used, so a missing table is a type error.
- **Name-coded catalogs** are saved as names already: animal kinds, buildings, weapons, resources, technologies and
  weather. Each gets `formerNames` and a policy for unknown names. Power ids are not saved.
- **Unknown names:** each catalog declares `fallback(name)` or `drop`. Renames are `formerNames`, never dropped. A row
  with an unknown name in a slot- or cell-addressed store (a module plant, a module building) loads as an inert
  placeholder. It keeps its slot, serial, occupancy and generation and carries its original name in a side table. It
  is excluded from every query, from rendering and from simulation, and it is written back unchanged.

## The logical schema

- **Designed once.** The logical schema is designed before any memory refactor: things as records keyed by kind name
  with serials; health as a share; fields by name; lava as per-volcano cell runs in their saved order, plus the
  tongues (after R4, a cell listed by two volcanoes goes to the later one); jobs and transients as records. Later steps
  change memory and section code, never what is on disk.
- **Shape changes are additive.** A new key has a default. A key never changes meaning: a new meaning gets a new key,
  and the reader keeps reading the old key as a fallback forever.
- **Schemas** are `zod/mini` `looseObject` with per-field defaults, and the loader keeps the parsed output (today
  `z.custom` in `saved-world.ts` throws it away). The worlds listing record and the journal get their own versioned
  schemas. The journal folds into the chronicle section as `{ id, values }`, and an unknown category falls back per
  entry instead of dropping the whole journal.
- **State that today's saves drop** is saved: jobs, paths through `pathRef`, `claimedPlants`, tornadoes, meteors,
  arrows, grabs, tasks in steps, water settling counted in steps, derived-layer pending lists. `snapshot()` never
  returns `null`.

## Older and newer builds

Saves from before format 2 (today's `SAVE_VERSION = 1` snapshots) are refused with a notice while the game is in beta
([decision 1](decisions.md#owner-decisions)). The notice reads "This world is from an older beta and can't be opened",
and the player can delete the save.

Every merge deploys, and the PWA's `skipWaiting` and `clientsClaim` keep old tabs running old code, so version skew
between builds is routine:

- A build never autosaves over a save of an unknown or newer format, and shows a "newer build" notice. This is S0, the
  first step.
- Unknown sections are kept verbatim and written back.
- A save that loaded with losses is never autosaved over; the game writes a copy and marks it.

## The world base

The world base is the whole island as generated, stored once per world. S3 ships it, after S2.

- **`WorldBase`.** When a world is created, its 12 terrain layers, water features, springs with their evaluated pond
  outline radii, crossings, monuments and deposits are stored once, losslessly (row delta, byte-plane shuffle, gzip
  through `CompressionStream`: 5.7 MB against 16 MB raw for seed 7 at 640²). Its header holds name tables for its
  index planes. A save references its base through the envelope's `base` field. Loading reads the base instead of
  regenerating, which saves 3.5–9 s, and the runtime reads pond radii instead of recomputing them from the seed.
- **Where it lives.** On the device, in its own IndexedDB database, `ashfolk-bases`, so the saves database never needs
  a version bump. Cloud saves and shared worlds, later and after sign-in through Whop, upload the same base and
  sections to Cloudflare R2 per account ([decision 9](decisions.md#owner-decisions)).
- **Base and save ordering.** No transaction spans two databases, so the first save of a world waits for its base
  commit, or embeds the base when it is missing. Orphan collection deletes only bases unreferenced for seven days and
  not open in a live session, under a `navigator.locks` lock shared across tabs. On load the stored bytes are checked
  against `hash`. On a mismatch or a missing base, the game regenerates, checks the generation fingerprint and says so.
- **Saves written before S3.** A format-2 save written before S3 has no base yet; it attaches one at its next load when
  the generation fingerprint matches.
- **Generator changes** don't wait for `WorldBase` ([decision 8](decisions.md#owner-decisions)). A world with a base
  keeps its land whatever the generator does; a save without one shows today's land-changed dialog, which is fine in
  beta.

## Fixtures

Every save shape from format 2 on has a fixture, starting in S2. The author runs `bun run fixtures` when the save
schema hash changes, and CI fails when it changed without a new fixture. Every fixture loads; one without a base
regenerates its island. The `save, load, run N = run N` property runs through the real envelope and serializer and
compares [section digests](determinism.md#hashing).
