# Summary: transcript-as-event narrow slice

## What changed

### `src/core/types/log-entry.ts`
- Added `CorrectionAuthorSchema` (human vs. model, with model reusing the existing `TranscriptionEngineSchema`) and exported `CorrectionAuthor`.
- Added a required `author` field to `CorrectionSchema`/`Correction`.

### `src/core/tensor-log/entry-builder.ts`
- `buildAmendCorrection` and `buildRetractCorrection` now accept an optional `author` argument and default to `{ kind: "human" }`, so every existing caller keeps compiling and produces valid corrections.
- `buildEntry()` no longer assigns `entry.transcript = params.transcript`. Instead, when a transcript is provided it:
  - Still extracts entities directly onto the base record (unchanged behavior — entities were already derived at capture time).
  - Appends the transcript as the entry's first correction, authored by `{ kind: "model", engine: <transcript.engine> }`.
  - Leaves `entry.transcript` permanently `null` for newly created entries.

### `src/core/tensor-log/entry-serializer.ts`
- Fixed the one raw `entry.transcript` read in the codebase: `serializeEntry()` now computes the effective transcript via `applyCorrections(entry)` for the Markdown body, so new entries with a null base transcript still render readable text. The YAML frontmatter continues to serialize the raw `LogEntry` unchanged.

### `tests/unit/tensor-log.test.ts`
- Added tests for:
  - New-shape entry round-trip (base transcript null, transcript lives in first correction).
  - `buildEntry()` storing the first transcript as a model-authored correction.
  - `buildAmendCorrection`/`buildRetractCorrection` defaulting to human author and accepting an explicit author.
  - Legacy entries with `transcript` set directly still resolving to that transcript.
  - Later corrections overriding a legacy entry's directly-stored transcript.
  - Serializer body rendering the effective transcript when the base transcript is null.
- Renamed the original round-trip test to clarify it exercises the legacy shape.

## What was deliberately left alone

- `SCHEMA_VERSION` was **not** bumped to `"2.0"`. The design doc proposes that bump as part of the full feature so the fast-path guard routes old records through full Zod validation; this narrow slice does not need it, and bumping would be a larger change than requested.
- No `deriveCorrections()` helper was added. The task's legacy-read requirement is satisfied by `applyCorrections()` already honoring a non-null base `transcript` as the starting value. Adding a synthesized implicit zeroth correction is a clean idea from the full design doc but is not required for the slice.
- `transcript` remains in `IMMUTABLE_FIELDS` in `src/core/tensor-log/invariants.ts`. For new entries the base value is `null` and must stay `null`; for legacy entries the base value is the original transcript and must never be rewritten. Keeping it in the list protects both cases, so removing it would weaken the invariant rather than clarify it.
- `entities` and `tags` were not moved into corrections at `buildEntry()` time. The task is scoped to transcript only; moving entities would be a separate, larger design decision.
- No UI changes beyond the serializer fix. `EntryDetailScreen`, `LogCard`, and `query-engine` already consume `EffectiveLogEntry` via the store, so they continue to work without modification.

## Uncertainties / things worth flagging

- **Old corrections on disk without `author`:** `author` is required in the schema. Any correction created before this change and still stored locally will fail `LogEntrySchema.parse()` on read. In the current beta test fixtures all corrections are created through `buildAmendCorrection`/`buildRetractCorrection`, so the builders now inject the default author and tests pass. I do not know whether any real user data in the wild contains corrections without `author`; if so, those records would need a one-time read-repair or `author` would need to be made optional with a default. I kept it required because the design doc shows it required and the slice's intent is to make authorship explicit going forward.
- **No model version:** `CorrectionAuthor` for models only carries `engine`, not an optional `modelVersion`. `TranscriptResult` does not currently include a model version, so nothing could populate it honestly. Adding `modelVersion` later is a backward-compatible schema extension if needed.
- **Serializer import direction:** `entry-serializer.ts` now imports `applyCorrections` from `entry-builder.ts`. This is a sibling-to-sibling import inside `core/tensor-log` and is the minimal fix; architecturally, one could argue the serializer should receive `EffectiveLogEntry`, but changing its public signature would ripple into sync/storage code and is beyond this slice.
- **No `SCHEMA_VERSION` bump:** New entries still write `version: "1.0"`. This is intentional for the narrow slice, but it means `isCurrentLogEntry()` cannot distinguish new-shape entries from old-shape entries by version alone. Since the read path handles both shapes transparently, that distinction is not needed yet.

## Verification

Ran the full required check suite:

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

All four passed:
- TypeScript: no errors
- Vitest: 81 tests passed
- ESLint: clean
- Vite production build: succeeded
