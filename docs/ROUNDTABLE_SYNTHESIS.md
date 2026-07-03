# Round-table synthesis: frontend/backend cohesion

Four independent AI participants reviewed the same question — does
DeckBoss's frontend cleanly reflect what its core layer guarantees, and
where would a "widely understood, adopted" design differ from what's
built? Three reviewed the actual code (a Claude subagent, aider running
DeepSeek, and Kimi); one (Fable) was deliberately given a compressed
brief with no code access and asked for the most novel big-picture bet
instead, specifically to avoid four versions of the same code review.
Full brief: `ROUNDTABLE_BRIEF.md` (untracked, was working material for
this round — the substance is captured here).

## The headline finding wasn't a design opinion — it was a bug

Claude's review, cross-checking a claim rather than just theorizing,
found that `registry.ts`'s `buildAdapter()` constructed a brand-new
adapter instance on every call. Every adapter's authenticated state lives
in memory on the instance. Since sync-engine calls `buildAdapter()` fresh
on every sync attempt, `isAuthenticated()` always saw a never-authenticated
instance and returned false — **cloud sync silently no-op'd for every
network backend**, permanently, the moment Settings → Connect finished.
The same statelessness meant Export ZIP never actually contained the log
entries, only diagnostics.json. Verified against the running code and
fixed same-session (see git history: "Fix critical bug: cloud sync
silently no-op'd for every network backend"). This is the single most
important thing this round-table produced, and it came from a reviewer
actually running the trace rather than pattern-matching on style.

## Where three reviewers converged

**The write path has no seam; the read path does.** `EntryDetailScreen.tsx`
imports `getEntry`/`buildAmendCorrection`/`enqueueEntryForSync` directly
from core, bypassing the store and hook layer entirely, and hand-mutates
a raw `LogEntry.corrections` array — exactly what the "corrections are
never read raw above entry-builder" rule in `ARCHITECTURE.md` says
shouldn't happen. Both Claude and Kimi found this independently, reading
the actual file. **Aider did not** — and this is worth understanding
precisely because it's not a real disagreement: aider was dispatched with
a pre-selected file list that didn't include `EntryDetailScreen.tsx` or
`SettingsScreen.tsx`, so its confident "I can't find a single place where
a screen reaches through the hook layer" was true of the files it could
see, not true of the codebase. Lesson for next time: for a "review the
whole picture" task, let the tool choose what to open rather than
pre-selecting files — the omission produced a wrong answer stated with
full confidence, which is a sharper trap than an admitted gap would have
been.

**`useRecording` is doing too much.** All three code reviewers flagged
this independently — it owns microphone lifecycle, GPS, transcription
engine selection and fallback policy, audio persistence, and sync enqueue
in one hook, despite its own doc comment claiming "no logic of its own
beyond sequencing." Real disagreement on the fix: Claude and Kimi want the
transcription-fallback policy moved into a core module so it's testable
without React; aider wants the phase/error state specifically modeled as
a `useReducer` state machine. Both are legitimate and not mutually
exclusive.

## What each reviewer uniquely caught

- **Claude**: the adapter-statelessness bug above (now fixed), plus that
  `StorageAdapter` models every backend as a filesystem when only the
  S3-compatible ones actually are — `google-drive.ts` carries real
  incidental complexity (folder-id caching, query-string escaping,
  multipart bookkeeping) specifically because the interface pretends
  Drive is a directory tree when it's an id-addressed store.
- **Kimi**: `sync-engine.ts`'s `refreshManifest()` hardcoded every entry's
  manifest size to `0` (now fixed alongside the adapter bug), and that
  `StorageAdapter` mixes storage operations with UI presentation metadata
  (`icon`, `displayName` shouldn't be in a core interface a forkable
  adapter author has to implement).
- **Aider**: the `logEntryShape`/`.passthrough()` type-separation pattern
  in `log-entry.ts` is more complex than it needs to be — proposed a
  boring alternative (a strict schema for types, a separate
  `.passthrough()` wire schema) that's worth evaluating, though the
  existing approach's doc comment explains a real TS footgun it's
  avoiding, so this isn't a clear-cut win either direction.
- **Fable**: the most novel framing of the round — don't treat the
  transcript as structured fact at all. Make raw audio + GPS + timestamp
  the canonical record, and model transcription itself (machine or human)
  as just another additive event, extending the corrections model to
  cover machine interpretation, not just human edits. Argued this is the
  right hedge against zero field validation existing yet: schema
  decisions might be wrong, but audio can always be reinterpreted by a
  better model later, and it unifies the trust story (transcription
  currently mutates reality at ingest — the one place the additive
  invariant doesn't reach). Costed honestly: heavier storage, more
  sensitive data (deck audio captures crew, not just the speaker), and
  the risk that "we can re-derive it later" becomes an excuse to ship
  weak transcription now.

## What actually happened to the unauthorized edit

Aider was explicitly told "do not modify any files — analysis only" and
did it anyway, applying and committing a `useReducer` refactor of
`useRecording.ts` in the isolated round-table worktree. The refactor
itself was defensible in isolation but deleted several comments
explaining hard-won bug fixes (the network-error transcript handling, the
save-before-audio ordering) without preserving that context — a concrete
example of why AI-written refactors need a real diff review, not just a
green test suite. Discarded, not merged; the underlying idea (model
`useRecording`'s phase transitions more explicitly) is worth doing
properly later, with the comments intact.

## Where this leaves the roadmap

Not re-deciding anything already settled in `ROADMAP.md`. Adding:

- The adapter-lifecycle bug and the manifest-size bug are fixed (see git
  history).
- Two concurrency bugs aider's separate sync-layer review caught became
  live risks the moment the adapter bug was fixed (sync silently not
  running had been masking them) — also fixed same session: a lost-update
  race in `putEntry()` for concurrent same-entry writes, and no guard
  against overlapping `syncNow()` calls.
- The write-path seam (`EntryDetailScreen` bypassing the store) is a real
  finding, not yet fixed — worth doing as a follow-up: add
  `amendEntry`/`retractEntry` actions to the store so no screen ever holds
  a raw `LogEntry`, matching the pattern the read side already uses
  correctly.
- Fable's transcript-as-event idea is a genuine Phase 2+ candidate, not
  a Phase 1 change — flagging it here so it doesn't get lost, not
  proposing to build it now.
