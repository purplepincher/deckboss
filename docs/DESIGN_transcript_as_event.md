# Design: transcript as event, not fact

Status: **Phase 2+ candidate, not scheduled.** This document exists to make
Fable's round-table pitch (`docs/ROUNDTABLE_SYNTHESIS.md`) concrete enough to
build from later, and to pressure-test it honestly. It does not change any
code. See the recommendation at the end for whether it should move.

## The pitch, restated precisely

Today `LogEntry.transcript` is set once, directly, at `buildEntry()` time
(`src/core/tensor-log/entry-builder.ts:44-47`). Every other field a human can
change (`tags`, `entities`, the transcript's *text*, after the fact) goes
through `corrections` — additive, foldable, conflict-free across devices.
The transcript's *first* value is the one exception: it mutates the base
record directly, at ingest, with no path to redo it later even when a better
model exists.

Fable's proposal: stop treating transcription as a fact baked into the
record at capture time. Treat it as an *interpretation* of the record —
audio + GPS + timestamp are the only true capture-time facts — and model
every transcription attempt, human or machine, as the same kind of thing:
an additive correction, authored by whoever/whatever produced it, amendable
and retractable like any other correction.

## 1. Concrete schema sketch

### What actually changes in `log-entry.ts`

**`Correction` gains an `author` field.** This is the one genuinely new
piece of information the pitch needs that doesn't already exist somewhere
in the schema:

```ts
export const CorrectionAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human") }),
  z.object({
    kind: z.literal("model"),
    engine: TranscriptionEngineSchema, // "webspeech" | "whisper-1" | ...
    modelVersion: z.string().optional(), // e.g. a Whisper API model string,
                                          // or a future local build hash —
                                          // optional because not every
                                          // engine exposes one
  }),
]);
export type CorrectionAuthor = z.infer<typeof CorrectionAuthorSchema>;

export const CorrectionSchema = z.object({
  id: uuidV4,
  created_at: isoDateString,
  type: z.enum(["amend", "retract"]),
  author: CorrectionAuthorSchema, // NEW
  reason: z.string().optional(),
  fields: EditableFieldsSchema.optional(),
});
```

**No new `Correction.type` variant.** I considered a third type —
`"retranscribe"` — to make machine-authored transcript events visually
distinct from human edits in the array. I'm recommending against it. The
existing fold in `applyCorrections()` already treats `fields.transcript`
as "whichever correction set it last, wins" — exactly the semantics a
re-transcription needs. A `retranscribe` type would duplicate that logic
for no behavioral gain; the only thing that actually needs to distinguish
"a model re-ran transcription" from "a human fixed a mishearing" is
`author`, which the field above already carries. Introducing a new type
here without new fold behavior is the same "speculative generality" the
`ext.*` framework was correctly rejected for in `ROADMAP.md` — one field on
an existing type is proportionate to the actual behavior change; a new
variant isn't earning its keep.

**`EditableFields` is unchanged.** `transcript: TranscriptResultSchema` is
already there, and `TranscriptResult` already carries `engine` and
`confidence` — the pitch's "confidence" ask is already satisfied by the
existing shape. `author` on the *correction* (not the transcript object)
is the right place for "who produced this," because tags and entities can
also, in principle, be model-authored later (e.g. a future auto-retagger),
and `author` describes the correction event, not the transcript value
specifically.

**`LogEntry.transcript` does not disappear from the schema, but stops being
written directly by new code.** Concretely:

- `logEntryShape.transcript` stays `TranscriptResultSchema.nullable()` in
  the Zod shape — removing it would break the passthrough/backward-compat
  story `log-entry.ts`'s doc comment already describes, and every entry
  already on disk (including everything synced to a user's Drive/R2/Oracle
  folder as human-readable Markdown) has it in frontmatter. Removing a
  field from the schema is not an additive change.
- `newEntrySkeleton()` keeps initializing `transcript: null` — nothing
  changes there, it's already the "no opinion yet" state.
- `buildEntry()` changes: instead of `entry.transcript = params.transcript`
  (entry-builder.ts:45), the first transcription result — Web Speech's live
  guess, or Whisper's synchronous result — gets appended as the entry's
  first `Correction` (`type: "amend"`, `author: { kind: "model", engine }`,
  `fields: { transcript }`), the same call already used for later
  corrections (`buildAmendCorrection`, extended to accept `author`). The
  base record's `transcript` field stays `null` forever for entries built
  this way. This is the actual mechanism, not the read-time trick below —
  the read-time trick in §2 exists purely to make *old* entries behave
  correctly without rewriting them.
- `SCHEMA_VERSION` (`src/core/types/common.ts`) bumps, e.g. `"1.0"` →
  `"2.0"`, so `local-db.ts`'s existing version-gated fast-path guard
  (`isCurrentLogEntry()`) — which already exists purely as a perf
  optimization, not because anyone anticipated this — naturally routes
  old-shape entries through full Zod validation instead of the fast path.
  No new mechanism needed here; this is an existing seam that happens to
  fit.

**A worked example.** A Whisper re-run six months after capture would
append:

```ts
{
  id: "c-...",
  created_at: "2027-01-15T14:02:00Z",
  type: "amend",
  author: { kind: "model", engine: "whisper-1", modelVersion: "whisper-1" },
  reason: "re-transcribed with Whisper (Web Speech had no signal at capture)",
  fields: {
    transcript: { text: "forty king at the north hole, tide's slack",
                   confidence: 0.94, language: "en", engine: "whisper-1" },
  },
}
```

A human fixing a mishearing looks structurally identical except
`author: { kind: "human" }` and no `engine`/`modelVersion` — same fold,
same array, same UI code path, which is the whole point of unifying the
two mechanisms.

### One finding worth flagging on its own

`invariants.ts`'s `assertWriteIsAdditive()` does **not** currently protect
`transcript` from being overwritten in place — `IMMUTABLE_FIELDS` is `id,
timestamp, gps, audio, source, thread_id, version`, and the corrections-array
check only guards `corrections`, not the base record's `transcript`/
`entities`/`tags`. So today, nothing mechanically stops a bug from directly
mutating `entry.transcript` on write — it's protected by convention
(`entry-builder.ts` being "the only place LogEntry gets constructed") but
not by the invariant checker that exists specifically to catch convention
violations. This confirms Fable's diagnosis more literally than the
round-table pitch stated it: transcript isn't just "the one place the
additive-corrections *invariant* doesn't reach conceptually" — it's the one
mutable-looking field the *invariant checker* doesn't reach either. If this
design ships, `buildEntry()` never setting `transcript` directly closes that
gap as a side effect, independent of the rest of the pitch.

## 2. Migration path

Every entry recorded under Phase 1 has `transcript` set directly on the base
record, never via a correction. The constraint: no rewriting old records
(violates the additive-only invariant this whole codebase is built around,
and `CODEOWNERS` locks the audit-log core specifically to make that hard to
do by accident).

**Answer: yes, there's a clean way, and it's a read-time-only synthesis,
gated on `version`.**

Add a function alongside `applyCorrections()` in `entry-builder.ts` —
call it `deriveCorrections(entry: LogEntry): Correction[]` — that returns
the entry's real `corrections` array, *prepended* with a synthesized
"implicit zeroth correction" when (and only when) the entry predates the
new schema version:

```ts
function deriveCorrections(entry: LogEntry): Correction[] {
  const isLegacyShape = entry.version < "2.0"; // simple string/semver compare
  if (!isLegacyShape || entry.transcript === null) {
    return entry.corrections;
  }
  const implicit: Correction = {
    id: `implicit:${entry.id}:transcript`, // deterministic, never collides
                                             // with a real uuidV4
    created_at: entry.timestamp,            // capture time, not "now"
    type: "amend",
    author: { kind: "model", engine: entry.transcript.engine },
    fields: { transcript: entry.transcript },
  };
  return [implicit, ...entry.corrections];
}
```

`applyCorrections()` folds over `deriveCorrections(entry)` instead of
`entry.corrections` directly. Because the implicit correction is always
prepended (oldest), any real correction that came after it — a human
tag edit, a genuine Whisper re-run recorded the new way — still wins the
fold exactly as it does today. Nothing about the fold's "later wins" logic
changes; the only change is what it folds over.

Properties this needs, and has:

- **Deterministic.** The synthesized `id` is derived from `entry.id`, not
  randomly generated, so calling `deriveCorrections()` twice on the same
  entry produces byte-identical output — required for the memoized
  effective-entry cache in `state/store.ts` (`correctionsSig()`) to keep
  working; that cache's signature is `${length}:${lastId}`, and a stable
  synthetic id keeps it stable across reloads.
- **Never written back.** `deriveCorrections()` is a pure read-time
  function; nothing calls `putEntry()` with its output. `invariants.ts`
  never sees the synthetic correction, because it never reaches a write
  path — it doesn't need to satisfy `assertWriteIsAdditive()`, it isn't a
  write.
- **Self-limiting.** New entries (`version: "2.0"`) never hit this path —
  `buildEntry()` writes the real correction at construction time (§1), so
  `entry.transcript` is `null` and the `isLegacyShape` check short-circuits.
  This is a shrinking problem: every entry created after the cutover needs
  no synthesis at all. Only the Phase 1 beta's actual existing entries
  (a handful of testers, some number of weeks) ever need it, and it costs
  nothing to leave the fallback in permanently — it's a five-line function,
  not an ongoing migration process.
- **No `version` field surgery required, because none is needed.** The
  existing entries stay exactly as they are on disk (IndexedDB and every
  synced Markdown file in a user's Drive/R2/Oracle folder). Nothing about
  this design touches storage; it only changes what code does with what's
  already there.

## 3. UI implications

`EntryDetailScreen.tsx` currently renders one line:
`effective.transcript?.text || "No transcript — audio saved..."`. Under
this design, `effective.transcript` (from `applyCorrections()`) is
unchanged in shape and still resolves to a single "current" transcript via
latest-wins — **the primary display does not need to change**, for the same
reason tags don't show their edit history inline today. That symmetry is
one of the design's actual selling points: the UI's main rendering logic
for "the current transcript" and "the current tag list" become the literal
same code path (fold to latest, render latest), which they arguably always
should have been.

What *does* need to change, because it's new information that didn't exist
before:

- **A provenance line under the transcript**, sourced from whichever
  correction most recently set `fields.transcript` in the (derived) array —
  e.g. "Transcribed by Whisper (94% confidence) · Jan 15, 2027" vs.
  "Transcribed live by Web Speech (61% confidence) · Jul 2, 2026" vs. no
  line at all for a human-authored correction shown as the *original*
  capture (there isn't one — humans only ever amend an existing
  transcript, they don't originate one from silence). This needs one new
  read-only accessor, not a schema change:
  `latestTranscriptCorrection(entry): Correction | null`, trivially derived
  from `deriveCorrections(entry)`.
- **A transcript history view, gated behind a disclosure, not shown by
  default.** This is the part that's genuinely new relative to how tags
  work — tags rarely have three competing values worth comparing, but
  "Web Speech's live guess" vs. "Whisper's later re-run" are legitimately
  both worth being able to see, especially to sanity-check that a
  retranscription actually improved things rather than just being
  different. Add `transcriptHistory(entry): Array<{ correction: Correction;
  transcript: TranscriptResult }>`, filtered from `deriveCorrections(entry)`
  to just the ones with `fields.transcript` set, in chronological order.
  Render it as a collapsed "2 earlier transcripts" disclosure under the
  main text, not inline — a fisherman skimming a timeline of 800 entries
  should never be forced to look at transcription history they didn't ask
  for.
- **Retract semantics get a genuine new use.** Today `Retract` on an entry
  means "this whole entry was a mistake." Under this model, retracting
  *just* a transcript correction (not the whole entry) becomes meaningful
  for the first time — "Whisper hallucinated on this one, revert to Web
  Speech's version" is a real action a user might want, and it's already
  mechanically expressible (append a correction whose `fields.transcript`
  restores the earlier value) without inventing anything new in the fold.
  Whether to expose a per-correction "revert to this version" button is a
  UI-design decision for whoever builds this, not something this doc needs
  to settle — flagging it because the schema already supports it either
  way, which is worth knowing before designing the screen.

`query-engine.ts` and `entry-serializer.ts` need **no changes** — both
already consume `EffectiveLogEntry`/`LogEntry` shapes that are unchanged;
full-text search still searches the one folded-to-latest transcript, which
is the correct behavior (searching "all transcript versions ever attempted"
would surface stale, superseded text as false-positive matches).

## 4. What this actually buys — a concrete scenario

**The scenario the round-table pitch gestures at, made specific:**

A captain records entries all season using the Phase 1 default, Web Speech.
Half their trips are outside cell coverage (per `ROADMAP.md`, this is the
*primary* operating environment, not an edge case), so Web Speech —
network-backed on most browsers — silently produces no transcript for those
entries (the exact bug `webspeech.ts`/`useRecording.ts` were hardened
against this pass: no transcript, but audio + GPS + timestamp are still
saved). Six months later, the captain configures a Whisper API key in
Settings, because the season's over and they finally have time to set it up
and are willing to pay per-minute for it.

**Under today's schema:** nothing happens. There is no code path that
re-runs transcription against an existing entry's stored audio — Whisper
only ever gets called inside `useRecording.ts`'s `stop()`, at the moment of
a *new* recording. The captain's forty-some untranscribed entries from the
uncovered trips stay untranscribed forever, even though the audio that
would let Whisper transcribe them has been sitting in IndexedDB (and
synced to their own cloud storage) the whole time. The transcript field is
a write-once fact; there's no "try again" affordance to build, because the
data model doesn't have a place to put a second attempt without special-
casing "well, actually, overwrite the old one this one time."

**Under this design:** a "Re-transcribe with Whisper" action on any entry
with `transcript === null` (or even one with a low-confidence Web Speech
transcript the captain doesn't trust) becomes a well-defined operation:
read the stored audio blob, call `transcribeWithWhisper()` (already exists,
unchanged), append the result as a model-authored correction via the same
`amendEntry()` store action `EntryDetailScreen` already calls for tags.
Nothing about sync, conflict resolution, or the write-path invariant needs
new logic — it's exactly the same shape as every other correction, which
is the actual point of the unification: **the schema already had a general
mechanism for "attach a new interpretation of this entry later without
losing the old one"; this design just stops make transcription special-cased
out of using it.**

Two honest caveats that sharpen rather than undercut the scenario:

1. **This specific payoff only exists for Blob-capable engines.** Web
   Speech has no way to transcribe a stored recording — it only ever
   listens to a live mic stream (`webspeech.ts`'s own doc comment says so).
   So "retry with a different engine" is real for Web Speech → Whisper, but
   there's no symmetric "retry with Web Speech" path, and if a captain
   never configures Whisper, this design buys them nothing beyond the
   human-correction unification. Given `ROADMAP.md`'s decision to keep Web
   Speech as the *default* specifically because it requires no API key,
   the population of users who ever benefit from the re-transcription
   scenario is exactly the subset who've opted into Whisper — which,
   per the same roadmap doc, is deliberately not the default path.
2. **The re-transcription feature itself — "read stored audio, call an
   engine, append a correction" — doesn't exist today and isn't part of
   this schema change.** This document specs the *data model* that would
   make it a small, well-typed feature to build later; it does not itself
   ship a "Re-transcribe" button. That's a real, separate, smaller Phase 3
   feature that becomes easy *after* this lands, not a consequence of the
   schema change alone.

## 5. Costs and open questions

Fable's original costing named two things honestly: heavier audio storage,
and more sensitive data (deck audio captures crew, not just the speaker).
Going deeper on both, plus a third that the round-table pitch didn't raise:

**Does this change audio retention policy? Not directly — but it raises the
stakes on a decision `ROADMAP.md` has already twice deferred.** Audio was
always retained under the existing additive-corrections model ("never
destroy a capture" is already the stated invariant, and
`ROADMAP.md`'s Week 1 pass explicitly rejected auto-pruning even for
already-synced audio as "destructive-by-policy"). This design doesn't
introduce audio retention as a new idea. What it does is make the
*product's stated reason* for keeping audio forever depend on it working —
"transcripts are derived, audio is canonical" is a stronger, more
load-bearing claim than "we keep audio because deleting captures is against
our principles." Concretely: under this design, an entry whose audio has
been evicted (browser storage-pressure eviction, a future manual "clear
old audio" feature, iOS Safari's non-installed-PWA eviction the readiness
memo already flagged) is now an entry whose *transcript's justification*
is also gone — the transcript on screen is presented as "one interpretation
among possible others," but there's no longer any way to get a different
one, silently. That's a regression in honesty relative to Phase 1, where a
transcript being wrong was at least visibly and permanently the only
transcript that would ever exist. **This design doesn't need a new
retention policy to be internally consistent, but it does need the
audio-quota/eviction question `ROADMAP.md` explicitly deferred to be
resolved before the pitch's central promise ("audio can always be
reinterpreted by a better model later") is actually true for any given
entry** — right now that promise is contingent on browser storage
behavior nobody has designed around yet, not on anything this schema
change controls.

**Does this make the crew-privacy problem worse? Marginally, not
structurally.** Deck audio already captures whoever's in mic range, not
just the person recording — that's true today, unrelated to this design.
What changes is emphasis: today, audio is a *backup* to a transcript that
already exists; if a user thinks about privacy at all, the transcript (text
they can read and reason about) is the artifact that feels like "the log,"
and audio is incidental. Under this design, audio is explicitly positioned
as *the* canonical record and transcripts as disposable derivatives of it —
which is more honest about what's actually being kept, but also makes it
harder to tell a crew member "don't worry, only my own words get logged,"
since the sentence "the audio is the real record" is now literally true
of the product's own design language, not just an implementation detail.
This is a messaging/consent question more than a technical one, but this
design does shift where the honest messaging needs to land.

**Does this make the schema more complex, working against the round-table's
own "elegant, widely understood" goal?** Partially, and it's worth being
honest about where. The `author` field is one field, additive, and — per
§1 — actually *simplifies* one thing (transcript stops being a special
mutable-in-place exception to the corrections model, which was itself
flagged as an inconsistency). But the *read path* gets one genuinely new
piece of conceptual surface area: every consumer of "what's the current
transcript" now needs to know about `deriveCorrections()`'s legacy-shape
synthesis, not just `applyCorrections()`. That's a real, permanent (if
small) addition to the mental model every future contributor carries —
"folding corrections" used to mean "fold the array that's actually on the
object"; it now means "fold the array that's on the object, except for one
synthetic entry that only shows up for entries older than schema version
2.0, which you have to know to look for." Aider's round-table critique of
`log-entry.ts`'s existing `.passthrough()`-for-parsing /
strict-for-types split (`docs/ROUNDTABLE_SYNTHESIS.md`) was exactly this
shape of concern — not wrong, but not a clean win either. This is the same
trade again, one layer up.

**Open question this document could not resolve:** should an entry whose
source audio has been evicted display differently from one whose audio is
still present — i.e., does `EffectiveLogEntry` need an
`audioAvailable: boolean` (or similar) so the UI can distinguish "this
transcript could be re-derived differently later" from "this transcript is,
in practice, permanent, because the only evidence that could ever revise it
is gone"? That's a real design question this document surfaces but doesn't
answer, because it depends entirely on the still-undecided audio-retention
policy — there's no way to spec the UI honestly without knowing whether
audio eviction is even possible in the product's future, and that decision
belongs to whoever eventually resolves the Week 1 pass's deferred item, not
to this document.

## 6. Recommendation

**Split the pitch. Bank the small, mechanical piece; don't schedule the
full feature yet.**

The narrow change — adding `author` to `Correction`, having `buildEntry()`
write the first transcript as a real correction instead of a direct field
assignment, and the version-gated `deriveCorrections()` for backward
compatibility — is cheap, additive, low-risk, and fixes a real, confirmed
gap: transcript is today the one field that looks corrections-governed but
isn't actually protected by `invariants.ts`. That slice is worth doing
whenever someone is next touching `entry-builder.ts`/`log-entry.ts` for
unrelated reasons (the `amendEntry`/`retractEntry` store-action cleanup
already flagged in `ROADMAP.md` would be a natural moment), independent of
whether the rest of this document ever ships.

The full pitch — multi-transcript history in the UI, a re-transcription
feature, retracting individual corrections — is not worth scheduling yet,
for a reason the round-table's one-paragraph version didn't surface: **the
scenario that makes it valuable (§4) depends on two things that don't exist
yet and aren't part of this schema change** — a "re-run transcription
against stored audio" feature (currently: zero lines of code, and only
meaningful for Whisper, which is the non-default, opt-in engine), and an
actual decision on audio retention/eviction (currently: explicitly
deferred, twice, in `ROADMAP.md`, with auto-pruning already rejected but
no positive policy adopted either). Building the schema flexibility now,
before either of those exists, risks becoming exactly the thing Fable's own
costing warned about — "we can re-derive it later" as license to not fix
transcription quality now — except aimed at the schema instead of the
model: shipping structure for a capability nobody has built and a guarantee
(audio survives indefinitely) nobody has actually made.

Concretely: revisit this after two things happen, not on a calendar. First,
real field usage (the fishermen `ROADMAP.md`'s "actual top priority"
section is waiting on) shows whether untranscribed-entries-from-dead-zones
is a problem real captains hit and care about re-solving later, as opposed
to a scenario that reads well in a design document. Second, the
audio-retention question gets an explicit decision — even a conservative
one ("audio is never auto-deleted, full stop, no quota story") is enough to
make this design's central promise actually true; what isn't enough is
leaving it deferred while a schema change implicitly leans on it being
resolved a particular way.
