# Phase 2 plan — field validation, with a bounded engineering side-channel

Fable memo, 2026-07-03. Companion to `FABLE_PHASE2_PROMPT.md` (the brief
this answers), `docs/RESEARCH_multi_device.md`, and
`docs/RESEARCH_sync_resilience.md`. This is the plan a team member —
human or AI — should be able to pick up cold. Decisions adopted from it
belong in `ROADMAP.md`; this document, like the briefs before it, stays
a point-in-time record.

---

## 0. Verdicts in one screen

| # | Question | Verdict |
|---|----------|---------|
| 1 | Field validation over more architecture? | **Yes — with one structural exception**: bank the additive schema fields *before* testers generate real data, then declare a wire-schema freeze for the duration of the beta. Schema is the one place where "wait for evidence" is backwards in a BYOK product. |
| 2 | What does a beta with no telemetry look like? | The tester's own sync folder **is** the telemetry — consented, user-owned, readable by a human the tester chooses to share it with. Three channels: human check-ins, shared sync folders, week-one paper-log ground truth. Details in §2. |
| 3 | What to bank in parallel? | Six items, strictly ordered, one of them gated on beta data (P0–P5 in §3). Property-based testing is the anchor. Everything else on the wishlist is an explicit non-goal. |
| 4 | Bridge to `cocapn-foundation`? | **Premature to schedule anything.** The honest embryo already on the roadmap is Ask-Your-Log (voice becomes bidirectional, still logbook). Concrete gating trigger defined in §4 — including a *negative* trigger cocapn needs to hear about if it fires. |
| 5 | Is the multi-agent process out of runway? | Generic "audit X for bugs" rounds are past the knee. Real signal remains in three specific shapes: harness-building, field-incident forensics, and exactly one more directed audit (the restore drill). §5. |
| 6 | Execution order | §6 — first/second/third, with suggested owners per `docs/MULTI_AGENT_WORKFLOW.md` roster strengths. |

The premise check the brief asked for: the "next phase" framing is
right, but the next phase is not a build phase. It is an **evidence
phase with a strictly bounded engineering side-channel.** The biggest
risk to this plan is not technical — it's that a demonstrably productive
multi-agent team with idle capacity will manufacture architecture to
stay busy. The bounded track in §3 exists partly to give that engine
something real to do that cannot destabilize the thing being field
tested.

---

## 1. Verdict on the convergent recommendation

Both research passes said: field validation next, not more
architecture. **I agree, and not by deference.** The independent
reasoning:

1. **The open structural questions are empirical, not analytical.**
   Whether multi-person logging matters, whether the clock-skew
   ordering corner ever bites, whether anyone approaches storage quota,
   whether Web Speech survives a diesel engine — none of these can be
   settled by more code reading. The marginal analytical yield of
   another architecture round is near zero *on these questions
   specifically*; every additional design decision made now is made
   against imagined users.

2. **The cost asymmetry favors waiting — everywhere except one place.**
   Multi-person conflict fairness (vector clocks, per-field CRDTs, a
   conflict-review UI) is a quarter-scale change whose cost is roughly
   constant whether it's built now or after the beta. Building it now
   buys nothing except the risk of building the wrong shape. Same for
   eviction machinery, error-classification, and every other deferred
   item: they don't get materially more expensive by waiting eight
   weeks.

3. **The one exception — the structural bet worth making before field
   data exists — is schema banking plus a schema freeze.** Here the
   cost asymmetry runs the other way, and it's worth stating precisely
   why, because it's a consequence of BYOK that's easy to
   underappreciate:

   DeckBoss has **no central migration point**. The canonical archive
   is Markdown+YAML in storage the user owns. Once real testers have
   real data, every schema change becomes a *lazy, forever-supported,
   client-side migration* executed opportunistically on user devices
   against files the project can never touch directly — and old files
   never go away, so old shapes must parse forever. The codebase
   already knows this: `log-entry.ts` documents that `author` must stay
   optional *forever* because pre-existing correction files can never
   be migrated. That constraint currently binds one field. Every week
   of real usage adds data that extends it to whatever the schema
   happens to be that week.

   So the cheap move is: **land every additive field already known to
   be wanted, now, while the installed base is zero-ish — then freeze
   the wire schema for the whole beta.** Concretely that's one field
   (`deviceId`, P0 in §3; `author` already landed). The freeze matters
   as much as the banking: no schema-version churn crossing the sync
   boundary while testers are mid-trip, a rule `ROADMAP.md` already
   gestured at for the `author` slice and which should now be explicit
   policy with an end date (beta exit review, §2.6).

   This is not "more architecture before evidence." It's closing the
   door on a class of future cost that only exists *because* evidence
   is about to start accumulating.

Everything else both research docs deferred, stays deferred, for their
stated reasons — which I checked and find sound. In particular: the
multi-device doc's claim that the manifest race was the one live bug
worth fixing regardless (it's fixed — `refreshManifest()` now
union-merges, verified in `sync-engine.ts`), and the sync doc's claim
that the merge model's eventual-convergence guarantee is real but
conditional (the proof sketch holds; the clock-skew counterexample is a
human-intent problem, not a corruption problem, and is exactly the kind
of thing only field data can prioritize).

---

## 2. The field-validation plan

Constraints, stated so the plan visibly respects them: no backend, no
telemetry, no accounts, testers offline for days-to-weeks, a live app
at a public URL, and human action items already decided in `ROADMAP.md`
(device census, hands-on setup session, week-one parallel paper log,
daily loud-conditions ask, daily 5-minute check-in, don't coach). This
section does not repeat those; it builds the operational structure
around them.

### 2.1 Shape

- **3–5 boats, 6–8 weeks.** Stagger starts by a week or two if
  recruiting allows — a bug found on boat 1's first trip gets fixed
  before boats 4–5 onboard.
- **One named human owns the beta** (the "wrangler"): runs setup
  sessions, does check-ins and debriefs, collects artifacts, triages
  incidents to the agent team. The multi-agent fleet supports this
  person; it cannot replace them. Every feedback channel below
  terminates at the wrangler.
- **Go/no-go gate before boat 1**: the P0 schema work is merged and
  deployed, the device census is answered (the iPhone/Safari question
  is live or moot — this changes the risk profile more than any code),
  and the restore drill (§5, A1) has passed once on a real phone.

### 2.2 The feedback loop — three channels

**Channel 1: the human channel (already decided, one addition).**
Daily 5-minute check-in by call/text; plus a **structured per-trip
debrief within 48 hours of landing** — 30 minutes, same question list
every time so answers are comparable across testers and weeks:

1. Walk me through the last time you recorded. What happened right
   before and right after?
2. Was there a moment you wanted to record and didn't? What stopped
   you? (This is the highest-grade signal in the whole beta —
   `ROADMAP.md`'s "the moments they don't reach for the phone.")
3. Read me one entry from the app and tell me what you actually said.
   (Live transcript-fidelity spot check.)
4. Did the app ever surprise you — anything missing, anything there
   you didn't expect?
5. What does the storage meter in Settings say right now? (Feeds H5.)
6. Did anyone else on the boat touch it, or want to? (Feeds H4 —
   observational only; do not pitch the idea.)

**Channel 2: the artifact channel — the sync folder is the telemetry.**
This is the key structural move the brief's "no telemetry" framing
invites you to miss: BYOK doesn't prevent observability, it *relocates
consent*. Each tester is asked — plainly, opt-in, revocable, at the
setup session — to share **read access to their DeckBoss sync folder**
with the wrangler (a normal Drive folder share to the wrangler's
account; a read-only key for R2/OCI). The synced Markdown then gives
the project, without any DeckBoss backend and without touching the
phone:

- **Capture cadence**: entries per day-at-sea, time-of-day clustering.
- **Transcript health**: rate of "No transcript — audio saved" entries
  (offline recordings and Web Speech failures are visible in the data
  shape), transcript length distribution.
- **Correction behavior**: how often testers amend, what fields, how
  long after capture — this is the real-world answer to whether the
  corrections model matches how fishermen actually work.
- **Sync latency**: cloud-object modification times vs. entry
  timestamps ≈ the offline-window/queue-health distribution — the
  exact field data the retry-queue and eviction designs are starving
  for.
- **Audio archival health**: which entries have their audio blob in
  `.deckboss/attachments/` vs. Markdown-only — the verified-upload
  pipeline's real-world success rate.

A recurring agent task (weekly, per tester folder — good kimi work,
see §6) reads the shared folder and produces a one-page health report
against these measures. The tester's data never enters any system the
project runs; an agent reads it in place, with credentials the tester
granted a human they've met. If a tester declines to share, they stay
in the beta on channels 1 and 3 only — say so at the setup session so
declining is comfortable.

**Channel 3: ground truth (already decided, one addition).** The
week-one parallel paper log becomes a scored artifact: at the first
debrief, the wrangler lines up paper against app and scores each real
event on two axes — *captured at all?* and *task-level correct?*
(species/count/location right after entity extraction — not word-level
transcript accuracy, which doesn't matter if the extracted facts are
right). That produces H1's actual number instead of an impression.

**The incident protocol.** Any suspected data loss or wrongness, ever:
tester taps Settings → "Something wrong? Export everything" (already
shipped: diagnostics counters + full ZIP) and gets it to the wrangler
however is easiest — same day if possible. The wrangler opens a
forensic task for the agent team within 48h with the ZIP, the shared
sync folder, and the tester's account of what happened. Field
incidents are the highest-value bug reports this project will ever
receive; they get fleet priority over everything in §3.

### 2.3 The hypotheses, ranked, with pass/fail lines

Write these numbers down now so week-6 judgment isn't vibes:

- **H1 — Deck transcription viability** (the kill-or-continue
  question): under genuinely loud conditions, ≥70% of entries yield a
  transcript whose task-level facts are right without the tester
  re-dictating. Below ~40%, Web Speech is not the product's
  transcription story and P5 (Whisper offline retry queue) is pulled
  forward as the main line. Between: judgment call at the checkpoint.
- **H2 — The capture ritual sticks**: ≥3 of 5 testers still recording
  voluntarily (unprompted by check-ins) in week 4. This is the product
  hypothesis; H1 is merely its prerequisite.
- **H3 — Sync/restore trust survives a real trip**: after each trip's
  first sync window, the shared-folder audit shows 100% of entries and
  ≥95% of audio blobs archived without wrangler intervention. Anything
  less is an incident, not a statistic.
- **H4 — Multi-device/multi-person demand** (observe only): does any
  tester spontaneously use two devices, hand the phone to a deckhand,
  or ask for either? This is the gating evidence
  `RESEARCH_multi_device.md` §5 is waiting on. Do not prompt for it.
- **H5 — Storage pressure trajectory**: storage-meter readings from
  each debrief, extrapolated to a season. This either validates
  deferring the eviction machinery or schedules it with real numbers.

### 2.4 Checkpoints

- **Week 2**: first debriefs and paper-log scoring are in. Decide: (a)
  is H1 trending pass/fail/ambiguous — and if fail-ish, pull P5
  forward; (b) any incident pattern that gates onboarding boats 4–5;
  (c) is the shared-folder channel actually working, or does the
  weekly health report need retooling.
- **Week 6 (exit review)**: score H1–H5 against the lines above, then
  reopen — with data — exactly the questions this plan defers:
  multi-device slices 2–3 (gated on H4), eviction machinery (gated on
  H5), error-classification priority (gated on the sync-latency
  distribution from channel 2), and the cocapn trigger (§4). The exit
  review's output is the next `ROADMAP.md` revision.

### 2.5 Explicitly not in the beta

No feature pitches to testers, no Spot Memory coaching, no
multi-device setup "to see if they like it," no schema changes, no
deploys that touch capture/sync paths without an incident forcing
them. Ask-Your-Log and Spot Memory ship only if already live before
boat 1 starts; otherwise they wait — mid-beta feature drops
contaminate the retention signal (H2).

---

## 3. The parallel bank — bounded engineering track

Ordered. P0 gates the beta; P1–P3 are test-infrastructure-only (safe
to land mid-beta because they can't touch shipped behavior); P4–P5 are
product code and land only at defined points. Anything not on this
list is out of scope for the phase — notably: eviction machinery,
multi-person slices 2–3, vector clocks/CRDT rework, `ext.*`
framework, new storage adapters, anything with "fleet," "mesh," or
"NMEA" in it.

- **P0 — `deviceId` + schema freeze** *(before boat 1; product code;
  small)*. Generate a UUID once per browser profile, persist in
  `AppConfig` (local-only, per `RESEARCH_multi_device.md` §1's
  minimal-identity design), stamp it on new corrections as
  metadata-only — no merge-semantics change. Skip `personLabel` (it's
  attribution UI for a demand H4 hasn't demonstrated). Then declare
  the wire-schema freeze: no changes to anything that crosses a
  `StorageAdapter` boundary until the week-6 exit review.
- **P1 — Property-based testing infrastructure** *(anchor task;
  test-only; fast-check + Vitest, per `RESEARCH_sync_resilience.md`
  §3)*. The four properties as specified there: merge
  commutativity/associativity/idempotence; deterministic
  `dedupeCorrections` ordering; effective-view convergence across
  random replica interleavings within a clock-skew window; queue
  no-silent-drops under injected transient/permanent failures. Accept
  the research doc's spec as the task brief's core — it's already
  falsifiable, which is exactly what `MULTI_AGENT_WORKFLOW.md` says
  good briefs need.
- **P2 — Two-device concurrent-sync integration test** *(test-only;
  small)*. Simulate two devices syncing into one `LocalZipAdapter`
  store with interleaved `syncNow()` phases; assert no entry ever
  disappears from the manifest. This is the regression proof for the
  manifest union-merge fix, which currently has no dedicated
  concurrent-scenario coverage.
- **P3 — Ingestion-boundary fuzzing** *(test-only; medium)*. The
  canonical archive lives in folders users own and other software
  touches: Drive apps, text editors, CRLF conversion, encoding
  mangling, partial writes, a curious captain "fixing" YAML by hand.
  Fuzz the Markdown+YAML parse→merge→serialize round-trip: random
  valid entries survive round-trips byte-faithfully; corrupted/
  truncated/hand-edited files are rejected or quarantined loudly,
  never half-parsed into the log and never able to crash a sync pull.
  This has *field probability*, not just theoretical interest — it
  will happen during the beta.
- **P4 — Transient-vs-permanent sync-error classification**
  *(product code; medium; land only at a checkpoint, not mid-trip)*.
  The real fix behind the maxRetries 5→20 stopgap, as specced in
  `RESEARCH_sync_resilience.md` §2: adapter-thrown error classes,
  never-expiring retry budget for network/server-transient, capped
  budget + surfaced error for 401/403/404/413. Schedule against the
  week-2 checkpoint; the shared-folder sync-latency data will say how
  urgent it is.
- **P5 — Whisper offline retry queue** *(product code; the one
  feature-sized item; gated on H1)*. Upload stored audio for
  transcription once connectivity returns — `ROADMAP.md` already
  called it the honest complete fix for offline-first transcription.
  If H1 trends fail at week 2, this is no longer a nice-to-have, it's
  the product's transcription story: pull it forward and treat its
  deploy as the one sanctioned mid-beta feature change (it fills empty
  transcripts; it doesn't alter capture). If H1 passes, build it after
  the exit review.

---

## 4. The bridge question

**Is there an honest next step toward `cocapn-foundation` in this
phase? No — naming one now would be premature, and here's the
reasoning rather than just the reflex.** The cocapn vision's central
premise is that voice is a viable command surface on a working boat.
DeckBoss's beta is, among other things, the *first empirical test of
that premise* (H1). Committing to steering-shaped work before H1
resolves means betting the bigger vision's foundation on an untested
assumption while the test is literally already running. Wait for the
test.

The honest embryo that's already in scope: **Ask-Your-Log** (roadmap
Week 2 — local keyword/date/species query, no LLM). It quietly makes
voice bidirectional — the fisherman stops only talking *at* the app
and starts getting answers *from* it — while staying entirely inside
"logbook." Nothing about it needs to be justified as a cocapn bridge,
and it shouldn't be built differently because of cocapn. But its field
reception is bridge *evidence*.

**The gating trigger — start the cocapn conversation for real when all
three hold:**

1. **H1 passed**: transcription works on a real deck across ≥3 boats,
   ≥1 full trip each. (The physics prerequisite for any voice-command
   anything.)
2. **The interaction model shows up unprompted**: ≥2 independent
   testers observed issuing command-like or query-like utterances at
   the app — asking it things, telling it to do things beyond logging —
   in check-in notes or shared-folder transcripts, without coaching.
   (Evidence people *want* to command by voice, not just dictate.)
3. **Retention is real**: H2 passed and at least some testers keep
   using DeckBoss after the beta ends, unprompted. (A bridge from a
   product nobody stuck with leads nowhere.)

"Start the conversation" means: a scoping brief written in
`cocapn-foundation`, informed by the field data — not code, not a
DeckBoss feature.

**The negative trigger, which matters just as much**: if H1 *fails* —
voice capture doesn't survive a working deck even for short dictation —
that finding must be delivered to `cocapn-foundation` explicitly,
because it damages that repo's core premise far more than it damages
DeckBoss (which can degrade to audio-plus-later-transcription via P5;
a voice-command steering system cannot). Either way, the beta's
transcript-viability data is the first real asset DeckBoss hands the
larger vision.

---

## 5. The team and the process

**Honest read: generic bug-audit rounds are past the knee on this
codebase.** The evidence is in this session's own trajectory: early
rounds found catastrophic, shallow bugs (sync never ran at all); recent
bugs were found almost exclusively as *side effects of directed work* —
verifying a Fable memo against code (the missing-blob silent-success
bug), doing research (the manifest race), building a fix (the
`LocalZipAdapter.listFiles` gap). The surface is small (~4 sync files,
one storage layer, one fold), four differently-trained models have
swept it repeatedly, and the write-path is now mechanically guarded by
`invariants.ts` plus a compile-time drift guard. Another "audit the
sync layer" round would mostly produce confident noise — and noise
from a trusted process is worse than nothing, because it gets
investigated.

**But the process isn't done; its target should change.** Three shapes
still carry real signal:

1. **Harness-building over hunting** (P1–P3). Every major sync bug was
   a concurrency/interleaving bug hand-written tests never hit — so
   stop asking models to *find* the next one and have them *build the
   machines that find them*: property-based tests, the two-device
   harness, the ingestion fuzzer. This converts audit capacity from
   opinion-generation into counterexample-generation, and it keeps
   paying after the fleet moves on.
2. **Field-incident forensics** (§2.2). The beta will produce
   failure reports of a class no agent would think to test for —
   grounded in real devices, real Safari, real 8%-battery phones. A
   diagnostics ZIP plus a shared sync folder plus "it ate my note
   Tuesday" is a *perfect* multi-agent target: parallel independent
   hypotheses from differently-trained models, orchestrator verifies.
   Hold fleet capacity in reserve for these; they outrank everything
   in §3 when they arrive.
3. **One last directed audit — the sharpest remaining angle: the
   restore drill (A1).** The one promise never exercised end-to-end:
   *the archive is the canonical copy*. Fresh browser profile → point
   at existing populated cloud storage → pull everything → assert the
   effective log (entries, corrections fold, audio re-fetch,
   verified-state rebuild) is byte-for-byte what the original device
   had. The entire audio-retention policy leans on this working; the
   sync layer is the component with the worst track record in the
   codebase; and every prior audit examined the write path — nobody
   has adversarially examined *read-side recovery from a cold start*.
   Run it as an agent round against `LocalZipAdapter` + a real R2
   bucket, and once by human hands on a real phone (this doubles as
   the roadmap's still-open manual recovery drill, and it gates boat 1
   per §2.1).

Also worth keeping, cheap: black-box QA on every deploy (it has caught
a release blocker before), and the "prompt architect" pattern (a
cheaper model workshops the next Fable brief) — that pattern produced
this document's predecessor and should produce the exit-review brief.

---

## 6. Execution order — what to do first, second, third

Owner suggestions follow the demonstrated strengths in
`docs/MULTI_AGENT_WORKFLOW.md`; the orchestrator reassigns freely.
Standard rules apply to every task: own worktree, falsifiable brief,
no scratch files committed, independent verification, no merges to
capture/sync paths after boat 1 without incident justification.

**Now, before boat 1 (order matters):**

1. **P0 — `deviceId` + declare schema freeze.** Product code,
   CODEOWNERS-adjacent → kimi, with the freeze declaration recorded in
   `ROADMAP.md` by the orchestrator. Small; do it first because
   everything after it wants the schema frozen.
2. **A1 — Restore drill** (§5). Two parts in parallel: agent round
   (Claude subagent or aider-pro; adversarial, read-side, "prove
   recovery is lossy or prove it isn't" — a falsifiable ask) and the
   human phone drill. **Gates boat 1** together with the device
   census.
3. **Wrangler prep** (human): device census, setup-session materials,
   the §2.2 debrief question list, consent language for sync-folder
   sharing, incident-protocol one-pager for testers ("if something
   looks wrong: Settings → Export everything, send it to me").

**During the beta (the bounded track):**

4. **P1 — Property-based testing.** aider on deepseek-pro (its
   concurrency-analysis strength; the research spec §3 is already
   brief-shaped), kimi verifying the properties actually encode the
   invariants rather than restating the implementation.
5. **P2 — Two-device sync harness.** Natural follow-on in the same
   test area; either aider or a Claude subagent.
6. **Weekly per-tester folder health report** (§2.2). Recurring kimi
   task; output is one page per tester against the channel-2 measures.
   This is the fleet's main *recurring* job for the whole beta.
7. **P3 — Ingestion fuzzing.** After P1 lands (it reuses the
   generators). GLM/opencode or aider.
8. **Incident forensics, as they arrive** — preempts 4–7.

**At week 2 (checkpoint):** decide P5 (Whisper retry queue) pull-forward
based on H1 trend; schedule P4 based on observed sync-latency data;
go/no-go boats 4–5.

**At week 6 (exit review):** score H1–H5 against §2.3's written lines;
reopen multi-device slice 2, eviction, P4/P5 sequencing, and the §4
cocapn trigger — each against its named gate, with field data on the
table. Have a cheap model workshop the exit-review brief (the prompt-
architect pattern). The review's output becomes the next `ROADMAP.md`
revision and the actual Phase 3 decision.

**Standing non-goals for the whole phase** (repeated from §3 because
this is the list that keeps an idle fleet honest): eviction machinery,
multi-person slices 2–3, causal ordering/CRDT rework, `ext.*`,
new adapters, fleet/mesh/NMEA/steering anything.
