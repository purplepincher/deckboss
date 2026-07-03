# Roadmap

This is the living decision record. `FABLE_BRIEFING.md` is a point-in-time
snapshot of the reasoning that led here (four-agent brainstorm, then an
independent strategic review) — read it for the *why*. This file is the
*what's actually decided*, and gets updated as decisions change; the
briefing does not.

## Decided

**Regulatory/compliance stance: explicitly disclaimed.** DeckBoss is a
personal log, not a substitute for official catch reporting — stated in
the README and in-app (Settings → About). The additive-corrections design
is kept and justified purely on sync-safety grounds (see `ARCHITECTURE.md`
and `log-entry.ts`'s doc comment), not on a compliance ambition nobody
has actually chosen to pursue. This is fully reversible: if a real
compliance use case shows up later with an actual regulator or insurer
attached, that's a new decision made on purpose, with its own legal review
— not something that arrives by default because the schema happened to
support it.

**Fleet learning: off the roadmap.** Not "decide the boundary later" —
removed as a planned phase. It cannot be built without a DeckBoss-operated
backend somewhere, which breaks the core local-first promise the shipped
product already depends on for trust. A dead future phase was already
distorting present decisions (see the compliance-stance drift above). If
fleet-shaped value is ever wanted, the only acceptable shape is a
separate, clearly-labeled tool that reads exports users chose to push to
their own storage — never anything DeckBoss itself operates — and that's
a decision to make explicitly when someone actually wants it, not a line
item to plan around now.

**Multi-trade / "substrate" ambition: not now.** Stay fishing-specific for
at least the next 6 months. There are effectively zero real fishermen
using this yet; substrate plays get earned by dominating one vertical, not
chosen in advance of any user validation. Revisit only after real field
usage exists.

**Extension architecture: split into three, only two of three approved.**
- ✅ **Now**: the write-path invariant validator (`invariants.ts`) and a
  CODEOWNERS lock on the audit-log core. Shipped this pass.
- ✅ **Opportunistic**: split fishing vocabulary out of
  `entity-extractor.ts` into a `domain-packs/fishing/` directory when
  someone's touching that code anyway. Not urgent, cheap when it happens.
- ❌ **Deferred**: the full `ext.<namespace>.*` schema extension framework
  for future sensor/ML/etc fields. This was the brainstorm's top
  architecture recommendation; the strategic review pushed back
  correctly — it's speculative generality for Phase 3 features that may
  never ship, and namespaced-extensible-schema is close to base-rate
  advice for "how do I make a schema extensible," not domain-specific
  insight. Additive changes to a YAML frontmatter format are cheap. Add
  the namespace when the first real extension actually shows up.

## The actual top priority, which wasn't on anyone's list

Every data point behind every decision above — the beta testing, the
four-agent brainstorm, this roadmap — came from AI agents, not a working
fisherman. That's the real gap. Before any Phase 2 feature work: **get the
app in front of 3-5 real commercial fishermen and watch them use it**,
specifically to find out whether Web Speech API produces usable
transcripts on a moving deck (diesel engine, wind, gloves, regional
accent, a phone in a waterproof case). If that fails, nothing else on this
roadmap matters. This is not something an agent can do — it's the one
action item that's actually on the humans running this project, not on
whoever's writing code next.

**Update: fishermen are lined up.** This triggered a second Fable review —
`FABLE_FIELD_READINESS.md` — specifically about whether the app is safe to
hand to someone whose season depends on it, not more roadmap strategy.

## Pre-launch hardening pass (post field-readiness review)

Fable's memo found the actual highest-risk gap wasn't on the readiness
brief's own list: **both transcription engines (Web Speech and Whisper)
are network-backed**, and commercial fishermen spend most of a trip
outside cell coverage — offline isn't an edge case for this product, it's
the primary operating environment. Verified against the code: this was a
real, live bug. `webspeech.ts`'s error handler treated a "network" failure
identically to benign silence, and `useRecording.ts` always attached
whatever came back — including a confident-looking empty result — as if
it were a legitimate transcript. A fisherman recording with zero bars got
a saved entry that silently looked like they'd said nothing.

Shipped this pass:
- [x] `webspeech.ts` now distinguishes a real "network" failure from
      genuine silence; `useRecording.ts` leaves `transcript` unset on a
      network failure instead of attaching an empty-but-confident result.
      Audio, GPS, and timestamp are still saved either way — only the
      transcript is affected.
- [x] Honest UI copy: "No transcript — audio saved" replaces "(no
      transcript yet)" everywhere an entry has no transcript text. The old
      copy implied it was still coming; for Web Speech (no way to
      transcribe a stored recording later, only a live mic stream) that
      usually wasn't true.
- [x] Haptic confirmation (`navigator.vibrate`) on save success/failure —
      a second, glove-proof signal alongside the "Saved" label, for
      someone who taps and pockets the phone without looking.
- [x] `navigator.storage.persist()` requested at boot, with grant status
      surfaced in Settings. iOS Safari evicts non-installed web-app
      storage after roughly a week idle; this is a landmine the readiness
      brief called "bigger than the quota question."
- [x] Local diagnostics counters (recordings started/completed/failed,
      sync attempts/failures) plus a "Something wrong? Export everything"
      support path in Settings that bundles them into the existing ZIP
      export. No telemetry, nothing leaves the device unless the user
      taps export — the no-backend promise stays intact.

Explicitly **not** done this pass, per Fable's own prioritization:
- **Audio storage quota/eviction policy** — Fable called this overweighted
  in the original brief for a 3-5 person, multi-week beta, and warned
  against the auto-prune idea specifically: automatically deleting audio
  is destructive-by-policy in a product whose defining invariant is
  "never destroy a capture." Deferred; if it ever happens, pruning may
  only touch audio already confirmed synced to the user's own storage.
- **A real Whisper offline-retry queue** (upload stored audio once
  connectivity returns) — genuinely useful and honestly the more complete
  fix, but bigger than a pre-launch pass. Good Week 2/3 candidate now that
  the immediate honesty problem (silent empty transcript) is fixed.
- **iPhone/Safari testing, the phone-lifecycle gauntlet** (call
  interruption, hours backgrounded, overnight restart, low battery), and
  **one full manual recovery drill** (clear site data → reinstall →
  restore from sync + ZIP) — all require physical devices and human
  hands. Not something to fake with headless Chromium; see human action
  items below.

## Human action items before field testers start (not code)

Per Fable's memo — these are process, not engineering, and they're gating:

1. **Device census.** One text to each tester: what phone, what browser?
   Determines whether the iPhone/Safari risk is live or moot before
   anyone hits the wall.
2. **A hands-on setup session per tester.** A project human installs the
   PWA to the home screen (not just a bookmark — this is what actually
   grants persistent storage on iOS), configures cloud sync, watches the
   first entry land in the tester's own Drive/R2/Oracle account, and
   demonstrates ZIP export. Nobody leaves the dock unsynced — the default
   state of an un-onboarded tester is local-only storage with maximum
   data-loss exposure, precisely during the window meant to build trust.
3. **Ask every tester to keep their current logging method running in
   parallel for week one** — paper, memory, whatever they already do.
   This produces ground truth for both transcript accuracy and capture
   completeness, and means a DeckBoss failure costs the tester nothing.
   Asking someone to bet real records on an unvalidated beta would be
   irresponsible; this removes that problem.
4. **One specific daily ask, nothing scripted otherwise**: at least once a
   day, record during genuinely loud operating conditions — engine
   running, wind, gloves on. That's the core hypothesis of the whole
   product getting its first real test.
5. **A five-minute daily check-in by call or text, not a form.** A
   fisherman will mention "the thing ate my note Tuesday" in
   conversation and never file that anywhere on their own.
6. **Don't coach, and don't pitch features.** First contact with the app
   naive is a nonrenewable resource — no pre-teaching vocabulary, no
   hovering, no Spot Memory or Ask-Your-Log conversations in week one.
   Watch for the moments they *don't* reach for the phone (mid-week
   abandonment, "I stopped when my hands were wet") — that's the
   highest-grade signal available, and it only shows up unobserved.

## Next 2-4 weeks

**Week 1 (this pass):**
- [x] Write-path invariant validator (`invariants.ts`) enforcing
      corrections-are-append-only on every write, regardless of code path
- [x] Boot-time IndexedDB store-integrity self-check with a loud failure
      state instead of the silent breakage that shipped once already
- [x] CODEOWNERS lock on the audit-log core
- [x] Non-compliance disclaimer, README + in-app
- [x] Re-justify additive corrections on sync-safety merits, not a
      compliance goal nobody decided to pursue
- [ ] **Human action item, not code**: start recruiting field testers.
      Docks, fishing forums, PNW commercial-fishing Facebook groups — this
      has the longest lead time of anything on this list, which is why it
      starts now, in parallel with everything else.

**Week 2:**
- Ask-Your-Log: a local keyword/date/species query layer over existing
  entries, no LLM, no API key. `query-engine.ts` already does the
  filtering — this is mostly UI. Also the best source of real signal for
  whether Phase 2's Context Packets are worth building at all.
- Domain-pack vocabulary split, opportunistically, while touching the
  extractor for Ask-Your-Log anyway.

**Weeks 3-4:**
- Spot Memory: surface past entries automatically on GPS re-entry to a
  location. The standout product idea from the brainstorm — but its real
  parameters (geofence radius, when to surface it, how not to be annoying
  mid-haul) need actual field testers to tune, which is why it's
  sequenced after outreach starts, not before.
- Continue black-box agent QA on every deploy (this already caught a real
  release blocker once — keep doing it), plus a field-conditions pass:
  throttled CPU, mid-recording offline flips, denied GPS permission,
  storage-quota pressure.

**Explicitly not doing in this window**: the `ext.*` framework, anything
LLM (Context Packets included), new storage adapters, Bluetooth mesh,
sensors/NMEA, anything with "fleet" in the name. The Bluetooth mesh
"hot bite" share idea is genuinely novel and on-brand — parked, not
killed, but it's a quarter-scale bet, not a week-scale one.

## Known landmine

Google Drive OAuth in Testing mode caps at 100 users before Google
requires app verification. Fine for a small field beta; worth knowing
about before recruiting gets close to that number.
