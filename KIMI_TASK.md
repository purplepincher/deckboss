# Task: bank the narrow transcript-as-event slice

Read `docs/DESIGN_transcript_as_event.md` in full first — it's the spec
this task implements a small piece of. Also read `ARCHITECTURE.md` and
`src/core/tensor-log/invariants.ts`.

## Background

The design doc recommends NOT building the full "transcript as an
additive event" feature yet (multi-transcript history, re-transcribe UI —
those depend on an audio retention policy and a re-transcription feature
that don't exist). But it identifies one narrow, low-risk slice worth
banking now, because it closes a real gap: `transcript` is currently the
one field that *looks* corrections-governed (it's already in
`EditableFieldsSchema` — someone can already call
`buildAmendCorrection({ transcript: {...} })` and it'll fold correctly at
read time via `applyCorrections()`) but the FIRST transcript — the one
`buildEntry()` writes at capture time — is a direct field mutation, not a
correction. Every subsequent transcript change goes through the proper
mechanism; only the very first one doesn't.

## The slice

1. **Add an `author` field to `Correction`** (`src/core/types/log-entry.ts`)
   distinguishing who/what produced a correction: a human (the existing
   implicit case — amend/retract from the UI) vs. a model (a
   transcription engine). Think carefully about the right shape — at
   minimum something like `{ kind: "human" } | { kind: "model"; engine:
   string }` captures it, but look at how `TranscriptionEngineSchema` is
   already defined nearby and reuse it if it fits, rather than inventing
   a parallel enum.
2. **Have `buildEntry()` write the first transcript as a real correction**
   instead of setting `LogEntry.transcript` directly at construction —
   i.e., the raw base `LogEntry.transcript` becomes permanently `null`
   for entries created after this change (audio-only, GPS, timestamp are
   still the base facts — see the design doc's framing), and the actual
   transcript arrives via the entry's first correction, authored by
   whichever engine did the transcribing at capture time.
3. **Legacy read compatibility**: every entry created *before* this
   change already has `transcript` set directly on the base record, not
   via a correction — and per the additive-only invariant, those existing
   records can never be rewritten to move that data into a correction.
   `applyCorrections()` (or wherever the effective view gets computed —
   check `entry-builder.ts`/the store) needs to keep honoring the old
   shape: if `LogEntry.transcript` is non-null on the raw record, treat
   it as the original, permanent transcript UNLESS a correction overrides
   it later — same as today. Don't touch old records; make the *read*
   path handle both shapes correctly. Write a test using an entry shaped
   like the OLD version (transcript set directly, no matching correction)
   proving it still resolves to the right effective transcript.
4. **`invariants.ts`**: think about whether `IMMUTABLE_FIELDS` still needs
   `transcript` in it after this change. If every new entry always has
   `transcript: null` on the base record and the real value only ever
   lives in corrections, is the field still meaningfully "immutable" in
   the same sense, or does keeping it in that list become vestigial
   (still correct, since `null` should never change to something else on
   the base record either way — but think about whether there's a case
   this misses now that transcript's *real* value moved elsewhere).

## Constraints

- `src/core/types/log-entry.ts`, `src/core/tensor-log/entry-builder.ts`,
  and `src/core/tensor-log/invariants.ts` are all CODEOWNERS-protected
  (`.github/CODEOWNERS`) — the audit-log core. This is exactly the kind
  of schema-adjacent, judgment-heavy change worth being conservative
  about: don't change anything beyond what this slice requires, and if
  you find yourself wanting to also refactor something adjacent, don't —
  note it in your summary instead and leave it for a separate task.
- Check every place that currently reads `entry.transcript` directly
  instead of going through the effective-view computation (grep for
  `.transcript` across `src/`) — anything reading the raw field instead
  of the folded value needs to be found and either fixed or confirmed
  safe (e.g. `EntryDetailScreen`/`TimelineScreen` should already be
  reading the effective view via the store, not the raw entry — verify
  this is actually true rather than assuming it from the file names).
- Run `npm run typecheck && npm run test && npm run lint && npm run
  build` yourself and confirm all four pass before considering this
  done. Add tests for the new behavior, including the legacy-shape
  compatibility test described above.
- Commit on this branch (`kimi/transcript-author-correction`) with a
  clear message. Don't push.

Write a summary to `KIMI_SUMMARY.md` (untracked) covering what you
changed, what you deliberately left alone, and anything you're not fully
confident about — flag uncertainty rather than presenting a guess as
settled.
