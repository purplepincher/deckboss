# DeckBoss interaction design — Fable memo

2026-07-03. Companion to `docs/FABLE_PHASE2_PLAN.md`. Verified against
the actual frontend surface (`BigRecordButton.tsx`, `useRecording.ts`,
`RecordScreen.tsx`, `SearchBar.tsx`, `TimelineScreen.tsx`,
`EntryDetailScreen.tsx`, `useTensorLog.ts`, `query-engine.ts`,
`entity-extractor.ts`, `webspeech.ts`, `log-entry.ts`, `haptics.ts`,
`index.css`, `App.tsx`) before writing, not designed in the abstract.

Priority order given attention accordingly: the hold-to-cancel fix gets
the most depth — it is the only live accidental-data-loss path shipping
into a beta whose central hypotheses (H2, H3) are trust and retention.
Ask-Your-Log gets the second-most, since it's the one feature sanctioned
to ship. Spot Memory gets a complete but deliberately compact interaction
model, since it's explicitly deferred until field data can tune it.

---

## 1. Kill hold-to-cancel. Cancel-while-recording should not exist.

### The position

A timed hold is the wrong pattern for this context — not badly tuned,
wrong in kind. Three independent reasons:

1. **Water defeats it physically.** Capacitive screens with water on
   them produce phantom and *stuck* touches. A droplet or a wet glove pad
   can hold `pointerdown` indefinitely. The current gesture converts a
   known hardware failure mode of wet phones directly into silent data
   destruction. No progress indicator or confirmation dialog fixes that;
   the gesture itself is built on the one input primitive (sustained
   precise contact) this environment cannot supply reliably.
2. **It's undiscoverable and unrememberable.** It exists only as a
   caption ("hold 2s to cancel"). An older captain who has never read
   documentation will either never find it, or — worse — find it by
   accident and never know what happened. `useRecording.cancel()`
   discards the blob, the transcript, and the GPS fix with zero trace.
3. **The need it serves is not urgent, but the harm it risks is
   irreversible.** On deck, the urgent verbs are *start* and *stop*. "I
   said the wrong thing" is never time-critical — and this codebase
   already has a first-class answer to it: corrections and retraction,
   the "nothing quietly disappears" machinery. Cancel-during-capture is
   the *only* destructive-forever action in an otherwise append-only
   product. That's not an inconsistency to patch; it's an anomaly to
   delete.

So: **while recording, there is exactly one gesture — tap stops and
saves. Always.** Cancellation moves to *after* the save, where it
becomes a retraction: reversible-in-principle, visible, and consistent
with everything else in the product.

### The replacement, concretely

**A. `BigRecordButton` loses all pointer-timing logic.** Delete
`onPointerDown`/`onPointerUp`/`onPointerLeave`, both refs, and the
synthesized-click suppression (it exists only to paper over the
long-press). The component becomes: tap → `onStart` when idle, `onStop`
when recording. The `onCancel` prop goes away. The instruction line
becomes just "Tap to stop." This is a net *deletion* of ~30 lines
including two comments explaining bugs the gesture itself caused.

**B. A post-save Discard affordance, in a fixed bottom slot.** After a
save, `RecordScreen` shows a bar anchored directly above the bottom nav
(not near the button — a fast re-record tap must not be able to hit it):

```
┌──────────────────────────────────────┐
│            ( ●  Tap to record )      │   ← button back to idle, unchanged
│  Recent logs                         │
│  ┌────────────────────────────────┐  │
│  │ 2:14 PM · "forty crab, port…"  │  │   ← the new entry, on top as today
│  └────────────────────────────────┘  │
├──────────────────────────────────────┤
│  Saved 0:42          [ Discard ]     │   ← the slot; ~56px tall; 10s lifetime
├──────────────────────────────────────┤
│   Record        Log        Settings  │
└──────────────────────────────────────┘
```

- Appears when phase reaches `saved`; persists **10 seconds**, then
  fades. Long enough for "wait, no"; short enough never to become
  furniture.
- `[ Discard ]` is a single full-height (≥48px) button, `--warn`-colored
  text on `--card-bg` (not red — red is the record identity color and
  stays reserved for it).
- Tapping Discard calls the **existing** `retractEntry(id, "discarded
  right after recording")` store action — the same path as Entry
  Detail's Retract. No confirm dialog: the action is already the safe
  one. The bar swaps to: *"Discarded — recoverable under 'Show
  retracted' in Log"* for 4s, then fades. Haptic feedback is not fired
  for this — haptics stay reserved for capture outcomes (design
  principle 4 below).
- The entry to discard is derived **from the store, not from the capture
  hook**: when phase transitions to `saved`, take `recent[0]` from the
  `useTensorLog({limit:3})` call RecordScreen already makes, guarded by
  `source === "voice"` and `timestamp` within the last 60s. This means
  the entire feature touches zero lines of `useRecording.ts`.

**C. What about a recording started by accident?** It saves a junk
entry. That's the correct outcome: a junk entry costs kilobytes and one
Discard tap; a lost entry costs a fact about the ocean that will never
exist again. The asymmetry is total, and the max-duration cap already
bounds the junk case.

**D. Rejected alternatives, for the record.** *Slide-to-cancel*
(iMessage-style): a drag is even less wet-glove-reliable than a hold. *A
second Cancel button during recording*: puts a destructive target
adjacent to the most-used target in the app, invites mis-taps at exactly
the moment hands are worst. *Hold-with-progress-ring*: fixes
discoverability of the current gesture while keeping its physics
problem; polishing the wrong pattern.

**E. Undo-the-discard** would want an "unretract" correction type —
that's a wire-schema addition, explicitly deferred (§5); the Discard
flow's landing message points at the existing recovery path ("Show
retracted") instead.

**This should ship before boat 1.** It is a capture-*screen* change, so
per the Phase 2 plan's rules it cannot ship after boat 1 without an
incident forcing it — which would be exactly backwards from letting the
data-loss gesture ride through the beta unfixed.

---

## 2. Ask-Your-Log: not a chatbot — a logbook that flips open to the right page

### The position

Do **not** build a conversation UI. A chat transcript is a promise of
understanding, and a keyword/date/species filter cannot keep that
promise; the first "sorry, no matches" in a chat bubble reads as a
stupid assistant, where the same result in a filter UI reads as an empty
page — true and unembarrassing. The honest metaphor for a non-LLM query
layer: *you say what you're looking for, the logbook opens to those
pages, and it shows you exactly how it heard you.*

Concretely: **Ask-Your-Log is the Log screen's search, grown a voice
mode.** No new nav destination, no new route. Results are `LogCard`s —
the existing component, already linking each result to its detail
screen and audio playback. Every "answer" terminates, one tap deep, in
the fisherman's own recorded voice.

### The interface

**Input: one field, two ways to fill it.** The existing search input
stays; a large mic button (56×56px, round, `--accent-dim` fill —
visually a small sibling of the record button, deliberately) sits to its
right.

```
┌──────────────────────────────────────┐
│ ┌──────────────────────────┐ ┌────┐  │
│ │ chinook last week        │ │ 🎤 │  │   ← same box whether typed or spoken
│ └──────────────────────────┘ └────┘  │
│  Heard: (species: chinook ×) (last   │   ← the parse, as removable chips
│         week ×)                      │
│  6 entries · Jun 25 – Jul 1          │   ← summary line, count + span only
│  ┌────────────────────────────────┐  │
│  │ Jul 1, 6:12 AM · "two nice     │  │
│  │ chinook off the port rail…"    │  │   ← existing LogCards
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

- Tap mic → button pulses (reuse the record button's pulse animation at
  small scale), label "Listening…". A fresh `WebSpeechTranscriber`
  instance — used as-is, `start()`/`stop()` — captures the utterance.
  Auto-stop after ~1.5s of silence via a short timer, or tap the mic
  again. The transcript **fills the same search box** as typing would —
  one field, one downstream code path, one mental model. (The current
  transcriber has no interim-results callback; v1 therefore shows
  "Listening…" then fills the box on stop. Live word-by-word display
  would need an additive `onInterim` hook on a capture-path file —
  deferred, see §5.)
- The box's contents — typed or spoken — run through a **deterministic
  parser** (new pure module, `ask-parser.ts`, transcript string →
  `QueryParams`):
  - Date terms → `startDate`/`endDate`: "today", "yesterday", "this
    week", "last week", "last month", month names, "June 12th".
  - Place terms → `near` at current GPS: "here", "near here", "around
    here", "this spot". Radius is a settings-tunable, default 2km (the
    same knob Spot Memory will eventually tune — one knob, shared, on
    purpose).
  - Vocabulary hits against `entity-extractor.ts`'s **existing**
    SPECIES/GEAR/WEATHER lists → an entity-type filter plus the word as
    a text term (verified: `query-engine.ts` filters entities by type
    only, the transcript substring does the value-matching — no core
    change needed).
  - Leading filler stripped ("show me", "when did I", "find", "any",
    "how many").
  - Everything left → the free-text substring filter.
- **Every consumed token becomes a removable chip** ("Heard: …") — the
  honesty mechanism: the machine shows its interpretation as physical,
  deletable objects instead of pretending to comprehension. Mishear
  "chum" as "chub"? The wrong chip is visible and one tap kills it
  (each chip ≥44px hit area). The existing date/entity `<select>`s fold
  into this chip row; "Show retracted" stays a toggle.

**Answers are entries, never arithmetic.** No "you caught 212 crab this
month" — summing extracted `quantity` entities from regex extraction is
a guess, and one wrong total destroys more trust than fifty correct
lists build. The summary line states only what's verifiably true: entry
count and date span. The fisherman draws the conclusion, from his own
words.

**Failure is a page, not an apology.** Zero matches never yields a bare
empty state. The screen shows: (1) what was searched — the chips,
unchanged, still removable; (2) **one-tap looseners** naming exactly
what each does — `[ Any time ]`, `[ Anywhere ]`, `[ Include retracted ]`;
(3) a **nearest-miss probe** — silently re-run the query minus the text
term, and if that has hits, say so ("Nothing mentions 'halibut' last
week — 6 entries last week without it") with `[ Show those ]`.
Deterministic, cheap, converts every dead end into a door.

**Offline honesty.** Web Speech is cloud-backed on the browsers that
matter — the mic path *will* fail at sea. When offline (the
`useOfflineStatus` hook exists), the mic button renders disabled with
"Voice search needs signal — type instead." Typed search works
everywhere, always. Asking your log is a planning act, not a mid-haul
act, and that's fine to say plainly rather than let the flagship feature
mysteriously fail on a boat.

**Why this shape is right for the beta:** per the Phase 2 plan §4,
Ask-Your-Log's field reception is the bridge *evidence* for whether
fishermen want to command by voice. A chips-and-list UI measures that
cleanly — whether testers use mic or keyboard, whether they speak in
command shapes. A chat UI would contaminate that signal by soliciting
command-shaped utterances.

---

## 3. Spot Memory: one quiet slot, and the app never speaks first

Parameters (fence radius, dwell time, cooldowns) stay open variables —
that's what the beta is for. The interaction *shape* is fixed now, and
fixing it structurally is what makes the feature annoyance-proof
regardless of how the numbers land.

**The shape: a single ambient card in the same bottom slot as the
Discard bar.** One reserved slot, shared by all ambient content
app-wide, strictly prioritized: capture feedback (Saved/Discard) beats
Spot Memory. One card maximum, ever — a new spot replaces the old card;
nothing stacks, nothing accumulates.

```
├──────────────────────────────────────┤
│ ⚓ You've logged here before          │
│    3 entries · last Jun 12 ·         │   ← one card, fades in ~400ms,
│    "forty crab, port rail…"      [×] │      fixed slot, nothing else moves
├──────────────────────────────────────┤
│   Record        Log        Settings  │
```

**Structural anti-annoyance rules** — hold regardless of tuned
parameters:

1. **The app never calls out.** No push notifications (never even
   request the permission), no sound, no vibration. Spot Memory exists
   only when the user is already looking: on app-open or screen-focus
   inside the fence. It answers a glance; it never demands one.
2. **Structurally incapable of interrupting capture.** Renders only when
   `phase === "idle"` and never within N seconds after a save (the
   Discard bar owns the slot then).
3. **Zero-cost to ignore.** Fixed slot, no layout shift (the record
   button's position is sacred), expires on its own when the boat leaves
   the fence.
4. **Tap = an Ask.** Opens the Log screen pre-filtered with a `near:
   here` chip — Spot Memory is just an automatic Ask-Your-Log query,
   reusing that infrastructure wholesale.
5. **Dismissal and learning, transparent and local.** `[×]` (≥44px)
   mutes that spot for the rest of the visit. Per-spot counters,
   device-local: ~5 visits with zero taps → demote to a one-line link;
   ×-dismissed on two consecutive visits → stop showing that spot
   entirely. Settings gets `Spot Memory: On / Quiet / Off` and a reset
   action. No decay functions — a fisherman should be able to predict
   what it will do.
6. **A "spot" is emergent, not stored.** Computed at read time by
   proximity-clustering existing GPS'd entries. No saved-spots schema,
   nothing new crossing the sync boundary. Mute-counters live in
   device-local UI state only.

Per the Phase 2 plan §2.5, this does not ship during the beta and
testers are not coached on it — this section is the design on the
shelf; the shared-folder GPS clustering data sets the radius/dwell
defaults when it's actually built.

---

## 4. The design language — nine rules with pass/fail teeth

Derived from the three designs above, not invented abstractly. Each
rule states its test, so a future contributor can use it to say no.

1. **Tap is the only trusted primitive.** No swipe, drag, long-press,
   double-tap, or multi-touch for anything consequential. *Test: can
   every consequential action be performed with one single discrete tap
   from a wet-gloved thumb? If a feature needs a gesture, the feature is
   wrong, not the rule.*
2. **Capture is sacred.** Nothing may move, resize, cover, delay, or
   overload the record button; every new surface must be suppressed
   while `phase !== "idle"`. *Test: does the diff touch the button's
   geometry, position, or tap semantics? Reject.*
3. **Nothing quietly disappears — and nothing quietly appears.**
   Destruction is always retraction; proactive content is confined to
   one ambient slot, one item, never modal. *Test: name the recovery
   path for anything removed, and the single slot for anything
   volunteered. Can't? Reject.*
4. **Haptics are a reserved channel.** Vibration means exactly "capture
   saved" or "capture failed" — no other feature may vibrate, ever.
   *Test: does the diff call `navigator.vibrate` outside `haptics.ts`'s
   two functions? Reject.*
5. **Show the guess, make it tappable.** Every machine interpretation is
   displayed as the interpretation it is, correctable by tap, with audio
   as ground truth one tap away. *Test: for any derived datum shown,
   where does the user see how it was derived, and how do they fix it?*
6. **Answers are the user's own words, never the app's conclusions.**
   Results are entries; the app counts and date-spans, never sums or
   infers. *Test: is any displayed number computed from extracted values
   rather than counted from entries? Reject until extraction has
   field-proven accuracy.*
7. **Sunlight and darkness are one UI.** Dark background stays; text
   contrast targets ≥6.5:1; no information rides on color alone. *Test:
   measured ratio, not eyeballed; does the screen still work in
   grayscale?*
8. **Offline is the default condition, not an edge case.** Every feature
   declares its zero-bars behavior at design time; degraded modes say so
   in words on screen, never fail silently. *Test: the spec has an "at
   sea, no signal" paragraph. Missing? The design isn't done.*
9. **Explainable in one breath at the dock.** If a feature can't be
   described in one spoken sentence during a setup session — "tap, talk,
   tap; tap Discard if you didn't mean it" — it doesn't ship. *Test:
   write the sentence. If it needs a second one, cut scope until it
   doesn't.*

---

## 5. Honest scope check

| Item | Touches capture/sync paths? | Verdict |
|---|---|---|
| Hold-to-cancel removal + Discard bar | `BigRecordButton`/`RecordScreen` are the capture *screen*, but Discard uses the existing `retractEntry` store path — zero edits in `core/`. Deriving the just-saved entry from the store instead of the hook means **`useRecording.ts` is not edited at all**. | In bounds, but because it changes the capture screen it must land **before boat 1**. |
| Ask-Your-Log | New pure module (`ask-parser.ts`), UI changes to SearchBar/Timeline, read-only use of `queryEntries` (verified sufficient as-is), read-only geolocation, existing `WebSpeechTranscriber` API with no edits. | In bounds. Matches the plan's "mostly UI" claim — verified, not assumed. |
| Live interim transcript in the search box | Needs an additive `onInterim` callback on `webspeech.ts`, a capture-path file. | **Deferred, explicitly.** V1 ships "Listening… → box fills on stop." |
| Spot Memory | Design only this phase. When built: read-time clustering, one UI card, device-local mute counters. No `LogEntry` fields, nothing crossing a `StorageAdapter`. | In bounds by construction; build post-beta with tuned parameters. |
| Undo-the-Discard (un-retract) | Needs a new correction type — a wire-schema change, forbidden by the freeze. | **Deferred and flagged**, not designed around silently. |

One more flag: Discard *writes* (a correction) and *enqueues sync* —
through code paths that ship today, changed by zero lines. If the beta's
freeze is read as "no new writers of any kind," Discard, like the
Retract button it mirrors, predates boat 1 or waits. One more reason
item 1 goes first.

**Priority order:** (1) hold-to-cancel replacement — pre-boat-1,
alongside P0; (2) Ask-Your-Log — ship before boat 1 or not during the
beta at all, per the plan's own rule; (3) design language into
`CONTRIBUTING.md` or a dedicated doc when someone asks for it; (4) Spot
Memory stays on the shelf until the exit review, where the shared-folder
GPS data prices its parameters.
