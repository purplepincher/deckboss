# Educational-clarity pass — README.md

Rewrite goal: a reader with no background in offline-first apps, CRDTs, or
PWAs should be able to follow the whole document and understand not just
what DeckBoss does but why it's built the way it is — taught in place, not
simplified away.

## Changes made

- **PWA defined at first use** — replaced "offline-capable" with a concrete
  description (install to home screen, works with no signal, queues and
  syncs later) right where the term first appears.
- **CRDT motivated before it's named** — added a concrete two-phones,
  no-signal scenario (a captain and a deckhand both editing the same entry
  offline) to make the last-write-wins data-loss problem tangible before
  naming the state-based CRDT pattern that avoids it.
- **HashRouter defined in place** — explained what the `#` in a URL does
  and why it lets a static host serve every screen without server-side
  routing config, before using the term to justify the `BASE_PATH` setup.

## What did not change

Every original claim, number, link, and caution statement is unchanged.
No new features or capabilities were invented. The maritime voice and
specificity are preserved. Only `README.md` was touched — no source,
config, or other doc files.

---

## Deeper architecture notes (2026-07-08 expansion)

The sections below explain non-obvious design decisions at more depth than
the README allows. Each was verified against source code and passing tests.

### 1. Why uploads are verified by reading them back

The README says sync "uploads that are verified by reading them back
rather than trusted on a successful write." This is not a belt-and-
suspenders nicety — it's a hard-won lesson from the worst bug class in
this codebase.

**The problem:** a cloud storage adapter's `put()` method returning
without throwing is *not* proof that the file landed correctly. Network
timeouts, partial uploads, silent server-side rejection, and race
conditions can all produce a "successful" write that left nothing — or a
truncated blob — on the remote. Early versions of DeckBoss trusted the
write-success signal, which meant audio blobs could silently vanish: the
app believed they were archived, the user deleted the local copy, and the
recording was gone.

**The solution** (`sync-engine.ts:verifyRemoteBlob`): after writing an
audio blob, the sync engine reads it back from the remote and compares
the byte count. Only then is the blob marked "verified" in IndexedDB
(`markAudioVerified`). Unverified audio is never considered safe to
clean up locally. A periodic `reconcileAudio()` pass re-enqueues any
local audio blob that is neither verified nor currently queued for
upload — so even a sync cycle that crashed mid-flight is self-healing.

**The broader principle:** the sync layer is the single most failure-prone
component in an offline-first app. Any invariant that depends on "the
write succeeded" should depend on *verified* success, not *reported*
success. This is why `allAudioVerifiedAt()` exists as a separate query
from "does the local blob exist" — they answer different questions.

### 2. The adapter-cache bug: why cloud sync silently never worked

This is the single most important cautionary tale in the codebase, and
it's documented in the source comment at the top of `storage/registry.ts`.

**What happened:** `buildAdapter(config)` originally constructed a *fresh*
adapter instance on every call. Each adapter holds in-memory
authentication state (S3's `verified` flag, Google Drive's `accessToken`).
Because a new instance was created per call, `authenticate()` set state
on an object that was immediately thrown away — the *next* call saw a
brand-new, never-authenticated instance. Sync silently no-op'd for every
network backend, permanently, the moment the user clicked "Connect."

The same statelessness meant the ZIP export's push-entries step and its
own write-diagnostics step were writing into two different
`LocalZipAdapter` instances, so the exported `.zip` never contained the
log entries — only `diagnostics.json`.

**The fix:** one module-level cache, keyed by the config fields that
determine adapter identity (backend ID + credentials). The same instance
now serves every call until the user changes backend or credentials.
`clearAdapterCache()` is called explicitly on disconnect.

**Why this matters for contributors:** any new code that constructs an
adapter directly (instead of going through `buildAdapter`) reintroduces
the bug. The ARCHITECTURE.md invariant "sync-engine.ts is the only caller
of StorageAdapter methods" exists precisely to prevent this.

### 3. The additive-correction CRDT, explained concretely

The README names the pattern — "a state-based CRDT: a grow-only set of
corrections merged by union" — but doesn't show *why* union is always
safe. Here is the concrete reasoning.

A `LogEntry` stores an array of `Correction` objects, each with a unique
UUID. When two devices edit the same entry offline, each produces a
*different* `Correction` with a *different* UUID. The merge operation
(`conflict-resolver.ts:mergeEntries`) is simply:

```typescript
const merged = dedupeCorrections([...local.corrections, ...remote.corrections]);
```

`dedupeCorrections` keeps the first occurrence of each correction ID and
sorts by timestamp (with a deterministic UUID tiebreaker). Because
corrections are additive overlays (they carry partial field updates, not
full-state replacements), applying them in timestamp order always
produces the same effective entry regardless of merge order. This is the
convergence property — the thing that makes the merge *commutative* and
*associative*, which the property-based tests in
`conflict-resolver.property.test.ts` prove holds across randomized
inputs, not just hand-written cases.

**What this does NOT mean:** it does not mean two devices can't produce
"contradictory" corrections (e.g., one sets the species to "chinook" and
another sets it to "coho"). Both corrections are kept; the last one by
timestamp wins for the effective field value. But neither is *lost* —
the full history is preserved on disk, and a human can always review the
correction chain.

### 4. The domain-pack architecture for entity extraction

Entity extraction (`entity-extractor.ts`) is deliberately split into two
layers:

- **Generic extraction machinery** (`entity-extractor.ts`) — regex
  building, span/overlap logic, number-word parsing. This knows nothing
  about fishing.
- **Domain vocabulary** (`domain-packs/fishing/vocabulary.ts`) — word
  lists for species, gear, weather, and relative locations. This is the
  only fishing-specific file.

The boundary exists so a different trade (logging, farming, diving) can
slot in a new vocabulary file behind the same extraction engine without
touching span/overlap/regex logic. The `EntityType` enum in
`log-entry.ts` is a closed vocabulary of *types* (gear, quantity,
species, weather, depth, measurement, etc.) that stays stable even as
the *values* (the actual words matched) change per domain pack.

This is the same separation principle as the storage-adapter boundary:
domain knowledge lives in exactly one place, and everything downstream
consumes a stable interface.
