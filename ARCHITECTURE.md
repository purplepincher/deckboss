# DeckBoss architecture

Four schema files define every seam in the app. Nothing else should need to
know a shape that isn't declared in one of these:

- `src/core/types/log-entry.ts` — `LogEntry`, `EffectiveLogEntry`, `Correction`
- `src/core/storage/interface.ts` — `StorageAdapter`, `Manifest`, `FileMetadata`
- `src/core/sync/types.ts` — `SyncJob`, `SyncJobPayload`
- `src/config/schema.ts` — `AppConfig` (local-only, never synced)

## Module graph

```
                        ┌────────────────────┐
                        │   UI screens/hooks   │
                        │  (React, task #7)    │
                        └─────────┬────────────┘
                                  │ reads EffectiveLogEntry[]
                                  │ calls buildEntry(), queryEntries()
                                  ▼
   ┌──────────────┐      ┌──────────────────────┐      ┌──────────────────┐
   │ recorder.ts   │─Blob─▶  entry-builder.ts     │◀─text─│ whisper.ts /      │
   │ geolocation.ts│─GPS──▶  (core/tensor-log)     │        │ webspeech (task 8)│
   └──────────────┘      └──────────┬────────────┘      └──────────────────┘
                                     │ LogEntry
                                     │ (entity-extractor.ts runs here)
                          ┌──────────▼────────────┐
                          │ entry-serializer.ts    │──Markdown string──┐
                          │ entry-parser.ts        │◀───────────────────┘
                          └──────────┬────────────┘
                                     │ LogEntry ⇄ Markdown
                          ┌──────────▼────────────┐
                          │ IndexedDB local store  │  (task #6)
                          │ entries / audio / cfg  │
                          └──────────┬────────────┘
                                     │
                          ┌──────────▼────────────┐        ┌───────────────────┐
                          │ query-engine.ts        │        │ sync-engine.ts     │
                          │ (search/filter, local) │        │ + conflict-resolver│
                          └────────────────────────┘        │ + queue.ts         │
                                                             └─────────┬──────────┘
                                                                       │ StorageAdapter
                                                     ┌─────────────────┼─────────────────┐
                                                     ▼                 ▼                 ▼
                                          google-drive.ts   cloudflare-r2.ts     local-zip.ts
```

## Why this shape

- **entry-builder.ts is the only place `LogEntry` gets constructed.** It's the
  single point where audio + GPS + transcript + entities get folded into one
  object matching `LogEntrySchema`. Nothing downstream re-derives entry
  fields — they read what's already on the object.
- **entry-serializer/entry-parser are the only code that knows Markdown.**
  Everything else — IndexedDB, query-engine, StorageAdapter, UI — works with
  `LogEntry`/`EffectiveLogEntry` objects. Markdown is a wire format at the
  edges, not the in-memory representation.
- **`corrections` never gets read raw outside entry-builder.ts's
  `applyCorrections()`.** UI, query-engine, and adapters all consume
  `EffectiveLogEntry` — the folded view — so the additive-correction
  invariant (see log-entry.ts's doc comment) can't be accidentally bypassed
  by code that forgot corrections exist.
- **sync-engine.ts is the only caller of StorageAdapter methods.** UI code
  never imports `adapters/*` directly — it enqueues a `SyncJob` and reads
  status via `useSync`. This is what makes offline-first not a special case:
  there's exactly one code path, and it just doesn't run until
  `useOfflineStatus` says the network is up.
- **AppConfig is the one schema that must never cross a StorageAdapter
  boundary.** Every other schema is meant to be written to the user's own
  cloud storage in human-readable form; this one holds credentials and stays
  in IndexedDB only.

## Deliberate divergences from the Phase 1 dev guide

1. **Additive corrections, not in-place edit/delete.** See the doc comment
   at the top of `src/core/types/log-entry.ts`. The real justification is
   point 3 below: because edits are additive, two devices editing the same
   entry never conflict, only merge — this is what makes offline sync
   trivially safe instead of needing last-write-wins or manual merge UI.
   (An earlier version of this doc justified it by "keeps Phase 4's
   regulatory-compliance goal viable" — that's backwards: a design choice
   shouldn't be justified by a future business goal nobody has actually
   decided to pursue. See the README's disclaimer — this project isn't
   claiming to be evidence-grade for licensing or compliance, and the
   corrections model would be worth keeping even if it never is.)
2. **Web Speech API is the default transcription engine, Whisper is opt-in.**
   See `defaultAppConfig()` in `src/config/schema.ts`. The guide's stated
   default (Whisper-first) requires an OpenAI key before a beta tester's
   first recording; flipping the default removes that friction.
3. **Conflict resolution merges corrections rather than picking a winner.**
   Because edits are additive, two devices editing the same entry produce
   two `Correction` objects, not two conflicting field values — the union of
   both is always safe to keep. Last-write-wins only applies to which
   *files exist at all* (a genuine two-device create race on the same id,
   which UUIDs make vanishingly rare).
