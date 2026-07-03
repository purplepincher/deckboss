# cocapn-foundation-mirror

This directory is a **point-in-time mirror** of selected safety and schema
documents from the [`cocapn-foundation`](https://github.com/SuperInstance/cocapn-foundation)
repo. It is **reference material**, not part of DeckBoss's own design.

## Why this exists

DeckBoss's root [`README.md`](../../README.md) and the doc comment at the top of
[`src/core/types/log-entry.ts`](../../src/core/types/log-entry.ts) cite
`cocapn-foundation`'s `SAFETY.md` and `activelog-spec`: the additive-corrections
("No editing. Ever.") principle that DeckBoss's sync model leans on is quoted
from there, and the longer-horizon autopilot/steering research is explicitly
pointed at as work DeckBoss keeps **out of scope** (see `ROADMAP.md`'s "Fleet
learning: off the roadmap" entry).

That citation is load-bearing for DeckBoss's own data-integrity story, but the
source repo describes itself as "a handoff bundle from Claude Design... these are
prototypes, not production code" — i.e. it does not guarantee permanence. A repo
that disclaims its own stability is a fragile foundation for a citation this
project depends on, so the cited documents are mirrored here so the citation
resolves to something this repo controls.

## What this is NOT

This is **not** design work DeckBoss has adopted, and **not** a commitment to
build any of it. Everything here describes voice-commanded steering, autopilot
actuation, and edge hardware (ESP32 "Helm units") — i.e. exactly the
autopilot/steering capability that DeckBoss deliberately does **not** pursue.
DeckBoss is a voice-first **fishing logbook**; it has no actuation surface and
takes no position on the safety model below beyond borrowing the append-only-log
design principle for its own (non-actuation, sync-safety) reasons. These files
are kept accessible only because the citation already exists in DeckBoss's own
docs.

Nothing in this directory should be read as a DeckBoss feature, a DeckBoss
roadmap item, or a DeckBoss safety claim.

## What's mirrored

Copied **verbatim** from `cocapn-foundation` (no edits, no commentary folded in):

- [`SAFETY.md`](./SAFETY.md) — the five-layer defense model for voice-commanded
  steering: (1) electrical (parallel, momentary, de-energized-safe), (2) firmware
  watchdog + command TTL, (3) authenticated replay-proof single-master protocol,
  (4) voice command-class escalation (C0–C3), (5) sea-trial checklist.
- [`activelog-spec/README.md`](./activelog-spec/README.md) — the ActiveLog
  append-only event-log format: envelope fields, merge-by-union rule, corrections
  as events, media anchoring by time. (The source README also references
  `examples/troll-day.jsonl`, which is **not** mirrored here — only the schema
  and the README are.)
- [`activelog-spec/schema/event.schema.json`](./activelog-spec/schema/event.schema.json)
  — the JSON Schema (draft 2020-12) for the ActiveLog v1 event envelope.

The sibling `ARCHITECTURE.md` from the same source was read for context but is
**not** mirrored — it covers the full five-layer Cocapn stack (edge → brain →
log → sync → intelligence), most of which is unrelated to the narrow citation
DeckBoss actually makes.

## Provenance

- **Source repo:** `https://github.com/SuperInstance/cocapn-foundation`
- **Source commit:** `2aaa34fa72b9b32f37dc62662867cc23c9d7aedf`
  ("Add Cocapn Foundation design export", 2026-07-02)
- **Mirrored:** 2026-07-03
- **Paths in source:** `project/foundation/SAFETY.md`,
  `project/foundation/repos/activelog-spec/README.md`,
  `project/foundation/repos/activelog-spec/schema/event.schema.json`

If `cocapn-foundation` moves or rewrites these documents, the citation in
DeckBoss still resolves to the version below. If you want the upstream's
current state, consult the source repo and commit above.
