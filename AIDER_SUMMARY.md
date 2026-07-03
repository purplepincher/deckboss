# Audit of IMMUTABLE_FIELDS class of bug

## Findings

### 1. Completeness after parallel fix

The `IMMUTABLE_FIELDS` list (after the parallel addition of `transcript`, `entities`, `tags`) will contain every field of `LogEntry` except `corrections`. Cross‑check against `logEntryShape` in `log-entry.ts`:

- `id` ✓
- `timestamp` ✓
- `gps` ✓
- `audio` ✓
- `transcript` ✓ (added elsewhere)
- `entities` ✓ (added elsewhere)
- `tags` ✓ (added elsewhere)
- `source` ✓
- `thread_id` ✓
- `version` ✓
- `corrections` (handled separately)

No other fields exist. **Coverage will be complete.**

### 2. Type‑level self‑enforcement (recommendation)

The current approach requires manually updating the array whenever `LogEntry` gains a new field. This can be made a compile‑time invariant with a small addition to `invariants.ts`:

```typescript
// After the IMMUTABLE_FIELDS declaration, add:
type _NonCorrectionKeys = Exclude<keyof LogEntry, "corrections">;
type _MissingImmutableKeys = Exclude<_NonCorrectionKeys, typeof IMMUTABLE_FIELDS[number]>;
const _assertImmutableCoverage: _MissingImmutableKeys extends never ? true : false = true;
```

If someone adds a new field to `LogEntry` but forgets to include it in `IMMUTABLE_FIELDS`, `_MissingImmutableKeys` will be a non‑`never` type, causing the assignment `true` to a variable of type `false` to fail to compile.

**This guard can be applied after the parallel fix lands**, when `IMMUTABLE_FIELDS` already contains all current non‑correction fields. Until then it would produce a false positive because `transcript`/`entities`/`tags` are missing.

A fallback comment‑based checklist (e.g. `// When adding a field to LogEntry, add it to IMMUTABLE_FIELDS unless it is corrections.`) is already implicit in the doc comment of `assertWriteIsAdditive`. The type‑level guard is the stronger option.

### 3. Write‑path funnel analysis

Every code path that constructs or modifies a `LogEntry` eventually calls `putEntry()` in `local-db.ts`, which is the sole write entry point and therefore the only place `assertWriteIsAdditive()` runs:

- **`entry-builder.ts`**: `buildEntry()` returns a new `LogEntry` but does not write. The caller (UI or recording hook) calls `putEntry()`.
- **`conflict-resolver.ts`**: `mergeEntries()` returns a merged `LogEntry`; the caller (`pullRemoteEntries` in sync‑engine) calls `putEntry()`.
- **`sync-engine.ts`**: `pullRemoteEntries()` writes merged entries via `putEntry()`. `handleJob()` reads entries but writes only to the remote adapter, not to IndexedDB. `pushAllLocalEntries()` uses `enqueueEntryForSync` and `drainQueue`, which also funnel through `putEntry()` indirectly (the enqueue doesn't write entries).
- No other module accesses IndexedDB entry store directly.

**No stray write paths exist.** The invariant enforcement is correctly placed.

## Suggested next steps

1. Merge the parallel addition of `transcript`, `entities`, `tags` to `IMMUTABLE_FIELDS`.
2. Add the type‑level guard shown above to `invariants.ts` so future fields cannot be forgotten.
3. Consider adding a similar compile‑time check for the corrections‑append‑only logic (not covered here, but could use a similar pattern on the `Correction` type).
