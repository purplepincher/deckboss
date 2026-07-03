# Sync resilience at real field scale

Research pass by aider (deepseek-v4-pro), recovered and written up after
its own file-write step failed to land the document (a known recurring
issue with this tool's one-shot mode — see
`docs/MULTI_AGENT_WORKFLOW.md`). The analysis itself is aider's; this is
a faithful transcription from its raw response, not a rewrite.

## Why this research

This session found and fixed, roughly in order: a bug where sync
silently never ran at all (adapter statelessness); a lost-update race on
concurrent writes to the same entry; a missing guard on overlapping
`syncNow()` calls; a silent-success bug when a sync job's blob was
missing; a missing verification step that made "upload succeeded" mean
nothing; a non-deterministic merge order under clock-skew/tie
conditions; a duplicate-enqueue race in the reconciliation pass. Every
one of these was found reactively, one at a time — usually because a
different fix made a previously-unreachable path reachable. This
research asks what it would take to stop finding these one at a time.

## 1. Formal characterization of the current sync model

**Correction-event model.** DeckBoss stores log entries as a base
capture plus an append-only list of `Correction` events (`amend`,
`retract`, ...). The effective entry the UI sees is derived by applying
all corrections in order. Two replicas holding the same entry id are
merged by taking the **union of their correction sets** and
deterministically sorting them (`mergeEntries` in
`conflict-resolver.ts`). A correction is uniquely identified by `id`
(UUID), so the union is a simple set-union with deduplication — no
semantic merge is needed.

### Is this a CRDT?

A **state-based grow-only set of distinct corrections** qualifies as a
**G-Set CRDT**, where the join operation is set union. Adding a
correction is a monotonic state expansion, meeting the standard G-Set
definition.

However, *convergence of the effective entry* requires more than the
G-Set convergence guarantee. Two replicas holding the same set *S* of
corrections may still diverge in their effective view unless they apply
*S* in the same total order. The code enforces a deterministic order:

```
order(c) = (c.created_at, c.id)  // lexicographic sort
```

For a given finite set *S*, this yields a totally-ordered sequence
identical on any replica (timestamps are immutable strings, ids are
immutable). Therefore, after eventual propagation, every replica
calculates the same effective entry:

> **Convergence property (effective entry).** Assume every replica
> eventually receives exactly the same set of corrections *S*. If every
> replica applies corrections in the fixed total order defined by
> `(created_at, id)`, then all replicas produce the same effective
> `LogEntry` view.

**Proof sketch.** The order is a linear extension of the partial order
induced by the sort key. The set of implementable orders is a singleton
for a given *S* (it is a total order). Deterministic application of the
same sequence produces the same result. ∎

This is a **deterministic map over a CRDT state**, not a purely
commutative CRDT. DeckBoss's convergence guarantee is therefore
**conditional on the determinism of the sort order**, which depends on
exactly two things:

1. **No duplicate correction ids.** Guaranteed by UUIDv4.
2. **No clock-skew-driven out-of-order timestamps that change the sort
   across replicas.** Even if timestamps are skewed, the same set of
   opaque `created_at` strings travels with the corrections, so the sort
   order is identical on all replicas *after they have the full set*.
   There is no attempt to enforce causal order; two replicas may
   initially order the same corrections differently (different arrival
   order), but once both hold the full set they stabilize to the same
   order. The system achieves **eventual convergence**, not causal
   consistency.

**Counterexample for causal consistency.** If two corrections C1, C2
edit the same field and C1 was logically ordered before C2 by a human,
but C2's `created_at` is earlier because of clock skew, the global order
applies C2 before C1. The *effective view* all replicas converge to is
internally consistent but may not be the one the human intended. This is
a **derived-view divergence**, not corruption; whether it matters
depends on whether the field's semantics tolerate out-of-order edits.
DeckBoss's assumption is that the risk is acceptable at current scale —
if it ever becomes problematic, causal ordering (vector clocks) could be
introduced.

**Conclusion.** The current model is a **provably convergent
state-based design** under the stated assumptions. It is not a pure
commutative-replicated data type at the effective-entry level, but the
system as a whole satisfies the safety property offline-first sync
needs.

## 2. Field-scale stress: queue semantics for weeks-offline scenarios

DeckBoss is designed for marine use, where a device may stay offline for
weeks, accumulating dozens or hundreds of pending sync jobs. `queue.ts`'s
back-off/max-retries policy treats every failure identically: a job
failing because the network is unreachable is indistinguishable from one
failing because of a permanent error (401, 403, path not found, quota
exceeded). Once `maxRetries` (then 5) is exhausted, the job becomes
permanently failed and is never retried again unless a human manually
taps "retry all" in Settings.

In a weeks-offline scenario: fresh jobs created while offline never
accrue retries (the queue processor only runs when `syncNow()` is
called, guarded against running with no active authenticated adapter).
When the first online check arrives, all accumulated jobs become
eligible immediately and are attempted serially. Any transient error
consumes one attempt and starts the back-off timer. With a max of 5
retries, a job hitting a network error on every attempt would
permanently fail 25-50 seconds after the first attempt and be ignored
from then on — audio created during the trip would be lost.

### Classification of transient vs. permanent failures

The highest-leverage change, short of a full rewrite, is to **separate
transient from permanent failures** and use different retry budgets:

| Failure class | Example | Should it ever expire? | Then-current behavior |
|---|---|---|---|
| Network transient | DNS timeout, TCP reset, satellite | No (retry until success) | Expired after 5 retries |
| Server transient | 503, throttling | No | Expired after 5 retries |
| Permanent | 401, 403, 404, 413 | Yes — needs user intervention | No distinction; treated same as transient |

Implementing this fully (distinct error types thrown by the adapter
layer, classification in `handleJob`, an "expires-never" retry budget
for transient failures) is a mid-size task. As a **minimal,
immediately-safe improvement**, this research recommends increasing the
default `maxRetries` from 5 to 20 for all job types, with a note that a
future pass should introduce proper classification. The backoff ceiling
(5 minutes) means 20 retries takes at most ~17 hours across the
exponential schedule — still acceptable given the typical weeks-long
field window. **This specific change has been implemented** (see
`sync-engine.ts`, commit alongside this document).

Why not infinite retries immediately: without a human-acknowledged error
list, infinite retries risk silently hammering a server that's rejecting
requests for a real policy reason (e.g. token expiration). The
classification pass should ensure permanent failures stay capped while
transient ones can retry indefinitely at a low average request rate.

## 3. Property-based testing strategy

The bugs found this session collectively point at a deeper pattern: the
merge and queue logic is small enough to be amenable to *exhaustive
generative testing*, and the existing unit-test suite doesn't explore
concurrent interleavings or edge-case orderings — every hand-written
test exercises one specific scenario someone already thought to check
for.

**Properties worth verifying for `conflict-resolver.ts`:**

1. **Idempotence of `mergeEntries`**:
   `forall e1, e2: mergeEntries(e1, e2) === mergeEntries(e2, e1)` (commutativity)
   `forall e1, e2, e3: mergeEntries(mergeEntries(e1, e2), e3) === mergeEntries(e1, mergeEntries(e2, e3))` (associativity)
2. **Deterministic order in `dedupeCorrections`**: two randomly-generated
   lists of `Correction` objects with the same set of ids produce
   identical (element-wise) resulting arrays.
3. **Convergence of the effective view for any interleaving of merges**:
   generate a base `LogEntry`, generate a list of `Correction` events
   with random `created_at` within a controlled clock-skew window,
   distribute across N simulated replicas (possibly different arrival
   order per replica), repeatedly merge pairs until one global state
   remains, assert the effective entry is invariant regardless of merge
   schedule.
4. **No regressions on queue replay**: randomly schedule
   enqueue/`processQueue`/`handleJob` steps with a simulated adapter
   injecting transient/permanent failures, verify the final count of
   successfully-completed jobs matches expectation and no job is
   silently dropped.

**Generator sketch**: a `LogEntry` generator constructing a base entry
with random id/timestamp/source/audio filename; a `Correction` generator
picking a random type, random `created_at` (bounded range), random
transcript string, and a fresh UUID; for queue tests, a clock
abstraction plus a fake `StorageAdapter` recording all writes and able to
simulate transient vs. permanent errors on demand. `fast-check` (already
Vitest-compatible) is the natural framework.

## 4. Prioritized recommendation

**The highest-leverage next piece of sync-layer hardening is introducing
property-based testing of the core merge function and the queue
processor**, instrumented as described in §3.

Rationale: every major sync bug found this session was a system-level
concurrency bug that unit tests over hand-picked ordered sequences never
hit. The merge logic is small (<50 lines) and the queue processor is
effectively stateless apart from job records — both are ideal candidates
for property-based testing. Adding this infrastructure now prevents the
next "someone changes backoff/retries/merge order, a new
impossible-until-now code path appears and isn't discovered until a
field tester loses data" cycle. Cost is modest: roughly 200-300 lines of
generators and property definitions plus a small dependency.

Structural changes (moving to a true operation-based CRDT with causal
ordering) are strictly lower-leverage at this stage — they'd touch every
layer (storage, serialization, UI) and require migrating existing user
data, a cost that should be deferred until field evidence shows the
current model's ordering semantics cause real-world problems beyond the
theoretical clock-skew corner case.

Secondary recommendation (the quick win already implemented): raising
`maxRetries` from 5 to 20 for all job types. Low risk, changes no
protocol invariants, directly addresses the most probable field-scale
data-loss scenario (exhausting retries before a trip ends). Not a
substitute for permanent-vs-transient classification, but buys time
until that work is done.

## 5. Implemented alongside this document

- `src/core/sync/sync-engine.ts` — `maxRetries` raised from 5 to 20 for
  both `upload_entry` and `upload_audio` jobs.

## 6. Future work (not in this pass)

- Permanent-vs-transient error classification with separate retry
  budgets.
- Causal ordering via vector clocks, if field evidence ever shows
  edit-order conflicts causing real-world data divergence.
- A full property-based test suite for `conflict-resolver.ts` and
  `queue.ts`, per §3.
- A "replay from archive" mechanism for audio evicted locally but still
  present in the user's cloud storage, per the Fable-recommended
  retention policy (see `ROADMAP.md`).
