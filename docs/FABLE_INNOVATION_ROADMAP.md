# Innovation roadmap — where DeckBoss goes when it's allowed to

Fable memo, 2026-07-03. Companion to `docs/FABLE_PHASE2_PLAN.md` (the
discipline document — still binding) and `docs/FABLE_FRONTEND_DESIGN.md`
(the interaction language these ideas must live inside). Verified against
the actual code before writing — `log-entry.ts`, `entry-builder.ts`,
`sync-engine.ts`, `s3-compatible.ts`, `entity-extractor.ts`,
`query-engine.ts`, `config/schema.ts` — because a vision document that
contradicts its own schema is fiction, not vision.

Mode check, stated plainly: the Phase 2 plan says the next eight weeks
are an evidence phase, and warns that an idle fleet will manufacture
architecture. This document does not loosen that. It is **shelf stock**:
designs priced now so the week-6 exit review can *choose* instead of
brainstorm, one narrowly-argued freeze exception, and exactly two pieces
of now-work — both of which are read-only or read-side. Everything else
carries an explicit gate.

---

## 0. Positions in one screen

| # | Bet | One sentence | Where it lives vs. the beta |
|---|-----|--------------|------------------------------|
| E0 | The forward-compatibility hatch | The parser's closed enums are time bombs under the project's own stale-client-at-sea assumptions; make *reading* tolerant now, while writing nothing new. | **The one freeze exception I'll argue for** (§2). Read-side only. If rejected: first item at exit review. |
| 1 | Close the correction loop | The additive-corrections model is quietly minting a perfectly-labeled, captain-owned mishearing dataset; use it to make the app learn each captain's voice — deterministically, suggest-only. | Design now; one read-only beta task now (the mishearing ledger, §3.4); build post-beta. |
| 2 | The night shift | On-device Whisper transcribes the day's audio while the phone charges on the boat overnight — offline transcription with no cloud, no key, as model-authored corrections. | Post-beta bet; H1-marginal pulls it forward as the main line. Feasibility spike is the first task, not the feature. |
| 3 | Readback — the bridge is a dialogue, not a steering wheel | cocapn's honest embryo is the maritime readback protocol: the app speaks the captain's words back, and correction becomes spoken. A five-rung ladder where actuation never enters DeckBoss. | Design-only now; rungs gate on the Phase 2 plan §4 triggers. Carries this memo's cocapn answer. |
| 4 | Witness marks (the tide join) | Read-time join against public tide/weather data — never stored, visibly derived, offline-capable because tides are the one environmental variable that's perfectly forecastable. | Post-beta build; design now; it is the cheapest strong answer to the payback problem (§1). |
| 5 | The pattern, written down | The reusable thing isn't a framework, it's a spec: the captured-fact ledger, plus the moat-inversion argument for BYOK. A document, not code. | Post-beta writing task. Honors the "substrate: not now" decision by banking the idea as prose. |

And the premise check the brief demanded (§1): the ask is right, but the
portfolio must be weighted differently than "more clever capture." The
flaw worth naming in the current trajectory is that **DeckBoss is all
deposit and almost no withdrawal** — and that, not transcription physics,
is the likeliest way H2 dies.

---

## 1. The premise check: capture is solved; the log doesn't pay rent yet

Asked directly whether the sharpest move is *not* more ideas: no — this
is the right moment to stock the shelf, precisely because the exit
review will otherwise make Phase 3 decisions under time pressure with
nothing priced. But there is a flaw in the trajectory worth naming
before stacking vision on it.

Every hard problem this project has solved is on the **deposit** side:
frictionless capture, honest offline behavior, never-lose-a-fact merge
semantics, audio as canonical ground truth. The **withdrawal** side is
one feature — Ask-Your-Log — and it isn't even shipped-confirmed for the
beta window. Now consider why paper logbooks survive decades of
competing technology: not because writing in them is easy (it isn't),
but because captains *reread them* — before a season, before a trip,
before trying a new spot. A log that is consulted justifies its own
maintenance. A log that is only fed is a chore with a nice button.

This reframes the beta's central retention hypothesis. If H2 fails, the
team will be tempted to diagnose capture friction — wrong button size,
bad transcripts — because that's where all the engineering attention
has lived. The likelier diagnosis will be: *the captain got nothing
back*. Week one, novelty carries it. Week four, "why am I doing this?"
needs an answer the product currently barely gives.

So the position that organizes this whole memo: **the most valuable
direction for DeckBoss's next act is making the log the first thing a
captain consults, not the last thing he feeds.** Bets 1, 3, and 4 are
all withdrawal-side. Bet 2 is deposit-side insurance against the one
physics risk (H1). Bet 5 is the pattern that makes all of it reusable.
Nothing in this memo extends capture's surface area, and nothing puts
steering in DeckBoss — ever, actually; see §5's ladder for why that
boundary is permanent, not deferred.

One consequence for the exit review, worth writing down now: **if H2
fails while H1 passes, do not kill the product — it hasn't tested the
payback thesis yet.** The beta tests whether capture-alone retains.
A "no" to that is a finding about capture-alone, and Bets 1/3/4 are the
experiment that runs next.

---

## 2. E0 — the forward-compatibility hatch (the freeze exception, argued)

### The problem, precisely

`log-entry.ts` already embodies the project's sharpest architectural
self-knowledge: `.passthrough()` on the wire schema, because an old
client must survive a new client's files, forever, with no central
migration point. But passthrough only protects against **unknown
fields**. Two *known* fields are closed enums in the parse path, and a
closed enum is the exact same forward-compatibility bug wearing a
different coat:

- `TranscriptionEngineSchema` — `z.enum(["webspeech", "whisper-1"])` —
  reached through `CorrectionAuthorSchema` on every correction with a
  model author. The moment any future engine writes a correction
  (Whisper-on-device, anything), that correction fails
  `LogEntrySchema.parse()` on every un-updated client.
- `CorrectionSchema.type` — `z.enum(["amend", "retract"])`. Any future
  correction type (the already-flagged "unretract," anything the ladder
  in §5 needs) does the same.

And the failure mode is the ugliest one this codebase knows, already
documented in the `author` field's own comment: a parse failure on read
doesn't just hide the new data — it **bricks amend/retract for that
entry** on the old client, because the entry can't round-trip through a
write.

Why this can't wait for the exit review: the stale-client window is not
hypothetical here — it is the *product's primary operating environment*.
A PWA at sea for three weeks does not update. Post-beta, the first
feature that writes a new engine string or correction type creates a
mixed fleet: an updated dockside phone writing files a stale at-sea
client will pull. Every week of beta data written under the closed-enum
parser extends the population of clients that will choke.

### The fix — read-side only, writes nothing new

1. Engine: accept any string on parse (`z.enum([...]).or(z.string())`
   pattern or plain `z.string()` with the preferred values documented);
   unknown engines render as their raw string in provenance UI.
2. Correction type: accept unknown types on parse; `applyCorrections()`
   **preserves them in the array and skips them in the fold**, and the
   effective entry grows a computed (never persisted) flag: "this entry
   has corrections from a newer version of DeckBoss" — surfaced as one
   quiet line in Entry Detail, per design rule 3 (nothing quietly
   appears, nothing quietly disappears — including *meaning*).
3. Invariants and tests: `invariants.ts` must treat an unknown-type
   correction as immutable like any other; property tests (P1's
   generators, conveniently) extended with an "unknown correction type
   survives round-trip byte-faithfully and never applies" property.

### Why this qualifies as the exception rather than a freeze violation

The freeze exists to protect one thing: no schema-version churn crossing
the sync boundary while testers are mid-trip. This change **alters
nothing that is written**. Every byte a beta client produces is
identical before and after. It changes only what a client *tolerates
reading* — it is the same move, in spirit and in blast radius, as the
`.passthrough()` that already ships. It is also strictly safer landed
*during* the zero-installed-base-ish window than after, for the same
reason the Phase 2 plan banked `deviceId` early: the population of
clients that must be tolerated only grows.

If the orchestrator judges even this too close to the wire — a
defensible call; it does touch `entry-parser`/`entry-builder`, which are
capture-adjacent — then it is **the first merge after the exit review,
before any feature work**, because every bet in this memo (and the
already-deferred unretract) is queued behind it.

Task brief in §8.1. Owner: kimi — this is exactly its shape: small,
correctness-critical, invariant-adjacent, needs paranoia not
imagination.

---

## 3. Bet 1 — Close the correction loop: the log learns to hear its captain

### The insight

Every product that does speech-to-text has a mishearing problem. Almost
none of them have what DeckBoss accidentally built: a **perfectly
labeled, per-speaker, per-domain correction corpus, collected as a side
effect of the trust model, stored in the user's own archive.** When a
captain amends "chub" to "chum," the corrections array now contains, by
design and forever: the original machine transcript, the human's fix,
the timestamp gap between them, and the audio ground truth one file
away. That is training data of a quality speech companies pay
annotation farms for — minted continuously, owned by the captain,
never leaving his storage.

Nobody on this team has articulated that the additive-corrections model
is not just a sync-safety mechanism — **it is a self-improvement loop
with the last wire uncut.** Cutting that wire requires no ML, no cloud,
no key:

1. **Extract pairs.** Diff transcript-before against transcript-after
   for each amend correction; align tokens (standard edit-script
   alignment); harvest (misheard → corrected) pairs into a device-local
   lexicon. "Chub → chum ×3." Never synced, never in the schema — it is
   derived state, recomputable from the archive at any time (which also
   means a restored device rebuilds it for free).
2. **Repair deterministically.** A pure module — phonetic matching
   (double metaphone) plus bounded edit distance — scores new
   transcript tokens against (a) the domain pack vocabulary already in
   `entity-extractor.ts` and (b) the captain's own pair lexicon, with
   (b) outranking (a) because three personal corrections beat any
   dictionary.
3. **Suggest, never silently apply.** A repair renders as a pre-filled
   amend in Entry Detail — "Heard 'chub' — did you mean **chum**? [Yes]" —
   one tap writes a normal correction with `author: {kind: "model",
   engine: <repairer>}` (this is why E0 gates it). Design rules 5 and 6
   hold exactly: the guess is shown as a guess, the accepted text
   becomes the captain's own word by his own tap, provenance is on the
   record forever.
4. **The zero-write freebie, worth calling out because it could even
   ship as pure read-side UI:** the same matcher, applied at *query*
   time, makes Ask-Your-Log find "chum" entries whose transcripts still
   say "chub" — recall improvement with zero corrections written, zero
   schema surface, zero risk. If the loop's write side ever proves too
   spicy, the read side alone justifies the matcher module.

### What makes it hard, honestly

- **Precision is everything.** A false repair suggestion is worse than
  a mishearing — it erodes exactly the trust the suggest-only design
  spends. The matcher needs a conservative score threshold and a rule:
  never suggest against a word that is *itself* in the domain
  vocabulary (both "chum" and "chub" are real fish; only the captain's
  personal lexicon may arbitrate between two legitimate words).
- **Pair extraction from free-text diffs is genuinely fiddly** —
  captains will rewrite whole sentences, not swap tokens. The mitigation
  is to harvest only high-confidence single-token alignments and throw
  the rest away; a lexicon built slowly from clean pairs beats one built
  fast from noise.
- **It must not become an excuse** to tolerate a bad base engine. If H1
  fails outright, this bet does not rescue Web Speech; Bet 2 does.

### Why it's worth someone's time

It compounds. Every other idea in this memo delivers a fixed quantum of
value; this one makes the core product *better every week the captain
uses it*, using only data the trust model already collects, in a way no
competitor with a conventional edit-in-place data model can replicate —
they destroyed their training data the moment the user hit save. This is
the additive model paying a dividend nobody priced when it was adopted
for sync safety.

### The now-work: the mishearing ledger (zero product changes)

The beta is about to produce the exact dataset this bet needs, through
channel 2 (shared sync folders), and the Phase 2 plan already schedules
a weekly per-tester health report. **Extend that report with a
mishearing ledger**: extract correction pairs from the shared folders,
tabulate what Web Speech gets wrong on a real deck and what captains
bother to fix. This is read-only analysis of already-consented data,
touches no product code, and does double duty: it feeds H1's judgment
zone (the 40-70% band where the checkpoint call is otherwise vibes) and
it prices this entire bet with field data before a line of it is built.
Brief in §8.2.

Freeze status: matcher + suggest UI are post-beta (suggest UI is also a
mid-beta contamination risk for H2 — it changes the correction behavior
channel 2 is measuring). The ledger is now-work. The query-side recall
freebie could ship pre-boat-1 if Ask-Your-Log does, but only bundled
with it — not worth its own deploy.

---

## 4. Bet 2 — The night shift: the phone transcribes while the boat sleeps

### The insight

P5 (the Whisper offline retry queue) is honest but still structurally
wrong for this product's stated physics: it waits for connectivity, and
connectivity is the exception, not the rule. The complete move is to
delete the network from transcription entirely: **run Whisper on the
phone.** Whisper-class models at tiny/base/small scale run today in the
browser via WASM/WebGPU (whisper.cpp WASM builds, transformers.js);
WebGPU has now reached iOS Safari (2025) as well as Chrome/Android.

The non-obvious part isn't "local Whisper" — everyone says that. It's
**when**: not live, not at capture, but *while the phone charges
overnight in the wheelhouse.* Capture stays exactly what it is (audio +
GPS + timestamp, instantly, with Web Speech opportunistically attached
when it works). Then, gated on `navigator.getBattery()` charging state
plus idle, a background pass chews through the day's untranscribed audio
and attaches results as **corrections authored by
`{kind: "model", engine: "whisper-local-<size>"}`** — which is precisely
the transcript-as-additive-event model this project already adopted in
the roundtable, now doing real work: the machine's later, better guess
never overwrites the capture facts, is fully provenanced, and folds like
any other correction. The captain goes to sleep with three silent
entries and wakes up with a full day's log. The boat has no internet;
nobody notices.

This also quietly upgrades the trust story end-to-end: today, a no-bars
recording produces "No transcript — audio saved" *forever* (Web Speech
cannot revisit stored audio). The night shift makes that copy true in
the way it always wanted to be: audio saved, and it *will* be
transcribed — by the device itself, tonight.

### What makes it hard, honestly

- **Model weight vs. H5.** tiny.en ≈ 75MB, base.en ≈ 145MB, small.en
  ≈ 480MB. Rule: weights live in the Cache API, marked re-downloadable,
  *never* counted against or competing with audio storage — a model can
  always be fetched again at the dock; a capture cannot. Download is a
  one-time on-WiFi setup step, which slightly complicates the hands-on
  onboarding script.
- **Throughput and thermals.** WASM fallback may run near 1-3× realtime
  for small models on mid-tier phones; WebGPU much better but uneven,
  especially on iOS where it is brand new. Charging-gated execution
  mostly neutralizes battery, not heat. This is why the first task is a
  **spike with numbers, not a feature**: measured x-realtime, peak
  memory, thermal behavior, and word accuracy on actual deck audio (the
  beta's shared folders will contain real diesel-and-wind recordings —
  use them, with consent already in hand).
- **PWA background execution is weak.** iOS will not run this truly in
  background; realistically it runs while the app is foregrounded on the
  charger, with a "leave DeckBoss open tonight" instruction — clunky,
  honest, and testable. If that instruction doesn't stick, this bet
  loses to P5 on human factors despite winning on physics. Say so at the
  spike stage.

### Relationship to P5 and to H1

Complementary, not competing: P5 is cheap and lands first if H1 trends
fail at week 2 (the Phase 2 plan already sanctions that). The night
shift is the *strategic* version — it removes both the network **and
the API key** from the product's transcription story, which matters
because BYOK-with-an-OpenAI-key was always the least on-brand dependency
in the stack. Kill criteria for the spike: >4 hours to process a
typical fishing day's audio on the beta cohort's median phone, or
accuracy on real deck audio no better than Web Speech's. Brief in §8.3.

Freeze status: post-beta, no exceptions sought. Requires E0 (new engine
string on corrections). If H1 fails, this becomes the product's main
line and the exit review should fund it as such.

---

## 5. Bet 3 — Readback: the bridge to cocapn is a dialogue, not a steering wheel

### The insight

Everyone including the Phase 2 plan frames the cocapn bridge as a
question of *when to start on commands*. Wrong axis. Ships already have
a voice protocol, refined over a century of getting people killed less:
**closed-loop readback.** Helm orders are spoken, repeated back by the
one executing them, and confirmed — trust is manufactured by the loop,
not by the accuracy of any single utterance. A voice system on a working
vessel earns command authority the same way a green helmsman does:
first it proves, out loud, hundreds of times, that it *heard you
right*. That reframing gives the bridge a ladder where every rung is a
better logbook on its own merits and simultaneously a measured test of
cocapn's core premise:

- **L0 (shipped):** haptic save confirmation. The device signals *that*
  it heard, not *what*.
- **L1 — Readback.** After save, the app speaks the transcript back —
  the captain's own words, short form, via `speechSynthesis` (default
  voices are on-device and offline on the platforms that matter).
  Eyes-free transcript verification at the moment of capture: a
  mishearing is caught in three seconds on deck instead of three days
  later at the dock. Settings toggle, default off; design rule 4
  survives because this is the voice channel, not the reserved haptic
  channel — but it needs its own reserved-channel rule (the app speaks
  only to read back a capture; it never speaks first, the Spot Memory
  rule generalized to audio).
- **L2 — Spoken correction.** Within the readback window, "correction:
  fifty" writes an amend through the existing correction machinery. The
  full closed loop: human speaks, machine reads back, human corrects,
  machine confirms. This is the entire grammar of vessel voice command
  minus actuation — running against a target where an error costs a
  YAML field instead of a hull.
- **L3 — Spoken answers.** Ask-Your-Log's results, spoken: "Six entries
  near here, last was June 12th, forty crab." (Count and date-span
  only — design rule 6 already forbids invented arithmetic, and it
  binds the voice too.)
- **L4 — The vessel peer.** See below.
- **Actuation — never in DeckBoss.** Not deferred: *never*. The moment
  the logbook can touch the throttle, every trust promise in the
  product ("worst case it's a note-taking app") is void. cocapn work
  happens in cocapn's repo against cocapn's safety case; DeckBoss's
  contribution is the proven dialogue loop, the field-validated audio
  pipeline, and the data.

The measurement claim, which is what makes this the honest bridge: the
Phase 2 plan's trigger #2 waits passively for command-shaped utterances.
L1/L2 create the conditions where they occur *naturally* — a captain
who has heard the machine talk back will start talking to it — without
ever soliciting them mid-beta (all rungs are post-beta, post-trigger).
Each rung's adoption is a direct, quantified reading on "do working
captains want a voice dialogue with equipment," which is the exact
question cocapn cannot afford to guess.

### L4 — the boat is the server (the inverted bridge)

The bridge is usually imagined as DeckBoss growing up toward cocapn.
The sharper move inverts it: **cocapn's first deliverable is
infrastructure for DeckBoss** — a small always-on box on the boat
(Pi-class or the vessel PC) running two things: an S3-compatible object
store (MinIO) and a Whisper server. Look at what that buys with almost
no DeckBoss code: the `S3CompatibleAdapter` already takes an arbitrary
`endpoint` — a LAN box is *nearly a supported backend today* (one
Settings unlock away). Suddenly: sync-at-sea with zero internet (phone →
boat LAN → box), a second copy of every capture within minutes of it
happening (H3's trust story, hugely strengthened), Whisper-large-quality
transcription minutes after capture instead of overnight (subsuming Bet
2 for boats that opt in), and — the strategic part — **cocapn acquires
its on-vessel compute platform with a real user and a benign first
job**, instead of being born as a steering system with no track record.
The BYOK principle extends cleanly: bring your own boat computer. The
captain owns the box, the bucket, and everything on it.

The genuine engineering puzzle (aider-pro-grade, flagged now so nobody
pretends it's trivial later): a PWA served over HTTPS cannot talk to
`http://192.168.x.x` — secure-context and mixed-content rules make LAN
TLS the real boss fight (device-installed local CA, mDNS certificates,
or a Tailscale-style overlay are the candidate shapes; each has a
captain-proof-setup problem). Whoever scopes L4 starts there.

Freeze status: all rungs design-only now; L1 is deliberately cheap
(~a day: `speechSynthesis.speak()` on the save path plus a toggle) so it
can be the first thing built when trigger conditions fire. L4 is a
scoping brief written *in cocapn-foundation* per the Phase 2 plan's own
definition of "start the conversation" — §8.4 sketches it. Nothing here
ships mid-beta; L1 would contaminate H2 and trigger #2 simultaneously,
which is exactly the recklessness the brief warned about.

---

## 6. Bet 4 — Witness marks: the tide join

### The insight

Ask a crab fisherman why Tuesday was good and he will not mention his
own log — he'll say the tide. Every captain runs an environmental
correlation engine in his head; the log's job is to feed it. DeckBoss
can annotate every entry with the conditions at that GPS + timestamp —
**without storing a single new byte in the entry**, because
environmental history is a public, immutable fact keyed by exactly the
two fields every entry already has. It's a read-time join, same
architectural species as the corrections fold: derived, recomputable,
never persisted into the record.

The clever part is the offline story, and it's the observation I'd bet
nobody has articulated: **tide is the one environmental variable that is
perfectly forecastable.** Tide predictions are harmonic arithmetic —
NOAA publishes them arbitrarily far ahead. So DeckBoss can prefetch the
season's tide tables for the captain's stations in one small dockside
fetch, and then the tide panel works *at sea, offline, forever* — the
only "live data" feature I can define that is fully compatible with
design rule 8. Weather and buoy history join opportunistically when
online (planning-time data anyway, per the Ask-Your-Log offline
doctrine: reviewing your log is a dock activity).

What it looks like: Entry Detail grows a visibly-derived witness panel —
"Ebb, -1.2ft and falling · NW 12kt · 48°F (NOAA, fetched Jul 1)" —
clearly marked as looked-up, not captured (rule 5: show the derivation).
Ask-Your-Log grows chips that captains will actually reach for: `ebb`,
`flood`, `slack`, `big tide`. The withdrawal-side payoff compounds with
Spot Memory later: "You've logged here before — 3 entries, all on ebb
tides" is the sentence that makes a captain keep feeding the log.

### Honest costs and edges

- **US-coastal bias.** NOAA CO-OPS and api.weather.gov are free,
  keyless, CORS-enabled, and cover the beta cohort's waters. Elsewhere
  needs other sources; fine — ship it as the first domain-pack-shaped
  regional module and say so.
- **Currents are not tides** in some fisheries (halibut in a pass cares
  about current, not height); v1 states what it shows and no more.
- **The app must never cross from correlation into advice.** The panel
  states conditions; it never says "fish here" or "the bite correlates
  with." Rule 6 extends: *the app surfaces facts next to facts; the
  pattern-finding organ remains the captain.* An app that gives fishing
  advice is betting its credibility on oceanography it doesn't have.
- Third-party endpoints mean an availability dependency — cache
  aggressively (environmental history never changes; cache forever),
  degrade to "no data fetched" silently-but-labeled, never block
  anything.

Freeze status: post-beta build, design now, zero schema surface by
construction. This is the exit review's best candidate for *first
feature after the freeze lifts* if H2 needs help: highest
payback-per-effort in the portfolio, GLM-shaped (concrete, measured,
frontend-heavy). Brief in §8.5.

---

## 7. Bet 5 — The pattern, written down

The BYOK/local-first architecture generalizes, and the roadmap already
correctly refused to generalize it in *code* ("substrate: not now"; the
`ext.*` rejection). The refusal was right; the lesson shouldn't be lost
with it. The reusable artifact is a **specification**, in the lineage of
the activelog-spec this project already descends from. Name the pattern —
the **captured-fact ledger** — and write down its six load-bearing
commitments, each of which DeckBoss has now stress-tested for real:

1. Capture facts (the sensor truth: audio, GPS, timestamp) are
   immutable, forever.
2. Every interpretation — machine transcription, human correction,
   future re-analysis — is an additive, attributed event.
3. The record you act on is a read-time fold; the record you *keep* is
   the event history.
4. The archive is human-readable files in storage the user owns; the
   app is a lens, replaceable without data loss.
5. Sync is union-of-events, so replicas merge instead of conflicting.
6. Observability is consent-relocated: there is no telemetry, and
   "share your folder with a human you trust" is the universal support,
   debugging, and collaboration primitive (the Phase 2 plan's channel 2,
   recognized as a *pattern* rather than a trick).

Any solo professional who works with dirty hands, no signal, and facts
that appreciate — arborists, large-animal vets, offshore wind techs,
wildland crews, surveyors, ferry engineers doing machinery rounds —
is a captured-fact-ledger user. Whether PurplePincher ever pursues any
of them is a decision the roadmap already scheduled for later; a spec
costs a week of writing and makes that future decision (or someone
else's fork — the license permits it, which is the point) start from
knowledge instead of archaeology.

And one strategic paragraph belongs in it, because it's the deepest
non-obvious thing this project has demonstrated: **BYOK inverts the data
moat.** A captain's multi-year DeckBoss archive — spots, seasons,
corrections, audio — may be the most valuable private dataset he owns;
under this architecture it is *his* asset: sellable with the boat and
permits at retirement, contributable to science on his terms,
purchasable by any future fleet-intelligence product only from *him*.
DeckBoss cannot harvest it, which is exactly why he can afford to pour
his working life into it. The moat is that there is no take — trust as
the accumulating asset, switching costs owned by the user instead of
imposed on them. Conventional product strategy calls that leaving value
on the table; for a tool whose users' livelihoods are their locations,
it is the *only* strategy that gets to a multi-year archive at all.

Freeze status: a post-beta writing task (the exit review's field
evidence makes the spec's claims empirical instead of aspirational).
No code. Explicitly not a framework, not `ext.*`, not a pivot.

---

## 8. The roadmap — what the fleet actually does, and when

### Timing map

**Now, during the beta (only these):**

- **E0** — if the orchestrator accepts §2's exception argument: kimi,
  small, before or between trips, never mid-trip (§8.1). If rejected:
  it is pre-queued as the first post-freeze merge.
- **Mishearing ledger** — extend the already-scheduled weekly folder
  health report; read-only, no product code (§8.2).
- **Shelf design docs** — this memo is most of them; the orchestrator
  may optionally have a cheap model expand §5's L1/L2 into a
  FRONTEND_DESIGN-style interaction spec while it's idle. Writing, not
  building.

**At the exit review — the decision table this memo exists for:**

| Beta outcome | Portfolio call |
|---|---|
| H1 pass, H2 pass | Payback first: Bet 4 (tide join), then Bet 1 (matcher + suggest UI, priced by the mishearing ledger). Check §4 triggers for the L1 readback rung. |
| H1 pass, H2 weak/fail | **Do not kill the product on this signal alone** (§1). Run the payback experiment: Bet 4 + Bet 1 as the retention hypothesis's second test, explicitly framed that way, with a defined second read-out. |
| H1 marginal (40-70%) | Bet 1's matcher + Bet 2's spike in parallel — repair and re-transcription attack the marginal band from both sides; the ledger data says which wins. |
| H1 fail | Bet 2 becomes the main line (spike first, P5 as the stopgap already sanctioned); deliver the negative finding to cocapn-foundation per the Phase 2 plan's negative trigger; Bets 3/4 wait on a working transcription story. |
| §4 triggers all fire | L1 readback (cheap, first), then L2; L4 scoping brief written in cocapn-foundation (§8.4). |
| Any outcome | Bet 5 spec gets written — it only needs the evidence to exist, not to be positive. |

**Never, regardless of outcome:** actuation in DeckBoss, a DeckBoss
backend, telemetry, fleet features DeckBoss operates, advice-giving
(§6's rule). These are this memo's own standing non-goals, added to the
Phase 2 plan's list rather than replacing it.

### 8.1 Task brief — E0, the forward-compatibility hatch (kimi)

> **Goal.** Make the wire parser tolerate unknown transcription-engine
> strings and unknown correction types without changing anything the
> app writes. **Scope.** `log-entry.ts`: engine accepts arbitrary
> strings (preferred values documented in a comment, not enforced at
> parse); correction `type` accepts unknown strings. `entry-builder.ts`
> `applyCorrections()`: unknown-type corrections are preserved in the
> array, skipped in the fold, and set a computed
> `hasNewerCorrections: boolean` on `EffectiveLogEntry` (computed only —
> verify it is never serialized). `invariants.ts`: unknown-type
> corrections are append-only like all others; confirm the compile-time
> drift guard still holds. One quiet Entry Detail line when the flag is
> true. **Acceptance (falsifiable).** (1) A fixture file containing a
> correction with `engine: "whisper-local-small"` and another with
> `type: "unretract"` parses, folds without applying the unknown, and
> round-trips byte-identically through serialize/parse. (2) An
> amend written by the current client against such an entry succeeds.
> (3) Zero diffs in any serializer output for current-schema entries —
> prove with a snapshot test over the existing test corpus. **Out of
> scope.** Writing any new engine string or correction type anywhere;
> any UI beyond the one line; anything in `sync/`.

### 8.2 Task brief — mishearing ledger (kimi, recurring, attaches to the weekly health report)

> **Goal.** From each consenting tester's shared sync folder, extract
> the mishearing dataset the corrections model already encodes.
> **Method.** For every amend correction that changes `transcript`:
> align before/after token-wise; harvest single-token substitutions
> with edit distance ≤ 3 or phonetic match; discard multi-token
> rewrites (log their count only). **Output.** Per tester per week, one
> table: misheard → corrected, occurrence count, whether either token
> is in the domain vocabulary, median capture-to-correction delay.
> Plus one cohort-level running table. **Acceptance.** A reviewer can
> answer from the output alone: "what are the ten words Web Speech
> most reliably gets wrong on a deck, and would a per-captain lexicon
> have repaired them?" **Constraints.** Read-only; consented folders
> only; no tester-identifying content beyond the label already used in
> the health report; no product code changes.

### 8.3 Task brief — night-shift feasibility spike (claude subagent or aider-pro; numbers, not features)

> **Goal.** Determine whether on-device Whisper is viable on the beta
> cohort's real phones. **Method.** Standalone test page (not in the
> app): whisper.cpp-WASM and transformers.js backends; tiny.en/base.en/
> small.en; run against ≥30 minutes of *real deck audio from the beta
> folders* (consent already covers wrangler-directed analysis — confirm
> with the wrangler first) plus quiet-audio controls. Measure per
> device × backend × model: x-realtime throughput, peak memory,
> thermal throttling onset, battery drain unplugged vs. plugged, and
> task-level accuracy (species/count/location correct — H1's own
> metric) vs. the Web Speech transcript for the same audio.
> **Acceptance.** A table plus a one-paragraph verdict against the kill
> criteria: >4h for a fishing day's audio on the cohort's median phone,
> or task-level accuracy ≤ Web Speech on deck audio → not viable now,
> P5 is the line. **Out of scope.** Any integration into DeckBoss; any
> schema work (E0 covers the future); UI.

### 8.4 Task brief — L4 vessel-peer scoping (claude; written in cocapn-foundation, fires only on the §4 triggers)

> **Goal.** Scope, do not build: a captain-owned on-vessel box exposing
> (a) an S3-compatible store DeckBoss can sync to over the boat LAN and
> (b) a Whisper endpoint — as cocapn's first deliverable. **Must
> answer.** (1) The secure-context problem: concrete options for a PWA
> on HTTPS reaching a LAN endpoint (local CA install, mDNS certs,
> overlay network), each with a dock-setup script a non-technical
> captain survives, and a recommendation. (2) Hardware floor and BOM
> for Whisper-small realtime. (3) What, if anything, DeckBoss must
> change beyond Settings exposing a custom endpoint on the existing
> `S3CompatibleAdapter` (verify against `s3-compatible.ts`; the answer
> should be nearly nothing — if it isn't, that's a finding). (4) The
> trust boundary in writing: the box runs zero DeckBoss-operated
> services; captain owns box, keys, bucket. **Acceptance.** A build/
> no-build recommendation with costs, honest enough to kill the idea.

### 8.5 Task brief — tide join v1 (GLM/opencode; post-exit-review)

> **Goal.** Entry Detail witness panel + Ask-Your-Log tide chips, US
> v1. **Scope.** New pure module `services/environment.ts`: NOAA CO-OPS
> tide predictions (prefetch: nearest N stations to the log's GPS
> bounding box, season-length window, stored in a device-local cache
> table — never in entries) and api.weather.gov observations
> (opportunistic, online-only, cached forever once fetched). Panel
> renders derivation visibly ("NOAA station 9447130, fetched Jul 1");
> absent data renders as one labeled line, never an error. Chips:
> `ebb`/`flood`/`slack` resolve against cached predictions at each
> entry's timestamp; join stays in the query layer — verify zero
> changes to `query-engine.ts`'s persisted inputs and zero new
> `LogEntry` fields. **Acceptance.** (1) Airplane-mode phone with a
> prefetched season shows correct tide state for any entry (spot-check
> against published NOAA tables). (2) `ebb` chip returns exactly the
> entries whose timestamps fall in falling-tide windows for their
> nearest station. (3) No network request blocks any render. (4) The
> panel never contains an imperative sentence — grep the strings.
> **Out of scope.** Advice, correlation claims, non-US sources,
> currents, Spot Memory integration (later).

---

## 9. Close

Three sentences of position, for the reader who skips to the end. The
next act is withdrawal, not capture: the log has to pay rent (tide
join, correction loop) or retention dies of politeness regardless of
how good the transcripts are. The bridge to cocapn is the readback
loop, not a steering feature — DeckBoss proves captains will *talk
with* a machine long before anyone should let a machine touch a
throttle, and the boat-LAN peer is cocapn's honest first body. And the
architecture's quietest property is its biggest: additive corrections
plus BYOK mean every captain is accumulating a labeled, self-improving,
personally-owned dataset — the product gets smarter without the company
taking anything, which is both the moat and the reason there can be
trust at all. Everything above waits its turn behind the beta, except
one read-side parser hatch and one read-only report — and if even those
wait, the shelf is stocked either way.
