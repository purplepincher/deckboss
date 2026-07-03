# Strategic briefing for Fable — DeckBoss / PurplePincher

You're being handed a live, shipped product and a fresh round of structured
brainstorming. This document exists so you can start reasoning at the
highest level immediately, without needing the whole build history
re-explained. Read it in full before forming an opinion — then form your own
opinion. You are not here to summarize this document back to us; you're
here to think harder about it than we have so far, and to disagree with it
where you should.

## What this is

**DeckBoss** is a voice-first digital fishing logbook PWA for commercial
fishermen. Tap one big button, speak, and it auto-captures GPS + timestamp,
transcribes the speech, extracts structured entities (species, gear, depth,
quantities), and stores everything as local Markdown+YAML files the user
syncs to *their own* cloud storage (Google Drive / Cloudflare R2 / Oracle
Object Storage / a plain .zip export). No backend server, no account, no
login for the core flow. Works fully offline on a boat with no signal.

Live: **https://purplepincher.github.io/deckboss/**
Repo: **https://github.com/purplepincher/deckboss**

It's the shipping-first branch of a larger, older vision — a sibling
repo, **https://github.com/SuperInstance/cocapn-foundation**, holds the
original, much more ambitious "Cocapn" design brief: voice-commanded
autopilot steering, a fleet-wide event-sourced log spec (`activelog-spec`),
ESP32 firmware, a five-layer safety architecture for anything that touches
a boat's actual controls. DeckBoss deliberately does **not** touch any of
that yet. It exists to prove the simplest possible version of "the
intelligence moves with the captain" actually works and ships, before any
of the harder, riskier autopilot work resumes. Worth reading that repo's
`SAFETY.md` and `ARCHITECTURE.md` for the longer-horizon thinking, but
DeckBoss's own roadmap should stay Phase-1-honest, not quietly inherit that
project's ambition.

## Non-negotiable design principles (already load-bearing, not up for a rewrite)

- **Local-first, user-owns-data.** The device is the primary store; cloud
  storage is a sync target the user configures with their own credentials,
  never a DeckBoss-operated server.
- **Corrections are additive, never destructive.** Editing or "deleting" a
  log entry appends an `amend`/`retract` event; the original capture is
  never overwritten. (This exists because these logs may eventually serve
  as informal work records / regulatory evidence — see the open question
  on that below, it is *not* a settled matter.)
- **BYOK everywhere an external service is involved** (Whisper API, any
  future LLM feature, any cloud storage backend). No DeckBoss-run server
  ever sees a user's key or their data.
- **"Just so."** The stated goal from the humans running this project is a
  system that stays small enough to be trustworthy and auditable while
  still being genuinely extensible and collaboratively built. Every
  proposal below should be judged against whether it protects or erodes
  that balance.

## Current state (Phase 1, shipped)

Built and live: recording with GPS+timestamp, Web Speech transcription by
default (Whisper as an opt-in upgrade, deliberately not the default — a
beta fisherman shouldn't need an OpenAI account before their first note
works), keyword/regex entity extraction, Markdown+YAML storage, IndexedDB
local persistence, an offline sync queue, four storage adapters, a React UI
(Record / Timeline / Entry Detail / Settings), a GitHub Pages deploy
pipeline with CI (typecheck + unit tests + build on every push).

It was beta-tested by three independent agents driving the live site with
Playwright (not reading the source — genuine black-box QA). They found a
real release-blocking bug (four IndexedDB object stores sharing one
database name, so three of four silently never got created — this broke
entry persistence, produced a false "sync failed" banner, and left the
Timeline stuck loading forever), a UI interaction bug (long-press-to-cancel
would immediately start a new recording on release), and a real
accessibility bug (pinch-zoom was disabled site-wide, and the "dominant"
record button was a fixed 220px regardless of screen size, so it wasn't
dominant at all on a tablet). All three were fixed and re-verified by a
fourth independent agent against the redeployed live site. Point of this
paragraph: the QA process here is "have an agent actually use the deployed
product like a stranger would," not "read the diff and assume it's fine" —
keep using that method, it already found real bugs unit tests didn't.

## The roadmap as originally sketched (context, not gospel)

- **Phase 2** ("the crab trap"): an LLM "Context Packet" generator (format a
  date range of entries into a prompt), paste a chatbot reply back in as a
  linked entry, simple trend cards, more storage backends.
- **Phase 3** ("the senses"): engine gauge/NMEA sensor ingestion, camera
  sync, voice-driven species tagging for ML training data, on-device
  Whisper to drop the API dependency.
- **Phase 4** ("the fleet"): cross-boat species-ID model improvements,
  aggregate fleet insight, a fleet dashboard, auto-generated regulatory
  catch reports.

## The brainstorm that just happened

Four agents were run in parallel, each with a different mandate and no
visibility into the others' output, specifically to get real divergence
instead of four versions of the same idea. Full outputs are in this
conversation's history if you need the raw detail; here's what actually
matters from them.

**Product ideas worth building soon** (cheap, use data already captured,
no new architecture): *Spot Memory* — surface past entries automatically
when GPS re-enters a location ("last time here: Oct 3, snapper on the
ledge, outgoing tide"). *Ask-Your-Log* — a local keyword/date/species query
layer over the existing files, no LLM, no API key, a cheap bridge before
Phase 2's Context Packets. Also flagged as strategically interesting but
much bigger bets: a Bluetooth mesh "hot bite" share between nearby boats
with no signal (on-brand with the no-backend philosophy, genuinely novel),
and the idea that the real product might be the *substrate* — voice +
GPS + timestamp → structured local record — which several other trades
(crabbing, farming, contracting, SAR) keep badly today and could adopt if
the fishing-specific vocabulary were swappable.

**Architecture proposal that matters most**: keep the core `LogEntry`
schema small and push all new capability into namespaced, versioned
extension fields (`ext.sensors.*`, `ext.ml.*`, etc.) rather than growing
the top-level schema — with a structural validator sitting in front of
every write that rejects anything violating the additive-corrections
invariant, regardless of which code path produced it. Storage adapters,
entity extractors, transcription engines, and eventual context-packet
templates all fit the same "pure function, narrow interface, no direct
storage access" seam that `StorageAdapter` already proved works.

**Collaboration proposal that matters most**: split fishing-specific
vocabulary (species, gear terms) into a `domain-packs/fishing/` directory
*now*, even though it's the only domain pack that exists, because
retrofitting this later is much harder than shipping it clean. This is the
same idea as the architecture proposal above, arrived at independently from
a completely different angle (community contribution, not schema design) —
that convergence is a signal, not a coincidence. Also: a non-technical
contribution path matters as much as a coding one (most working fishermen
who'd want to shape this can't or won't open a PR), and the audit-log core
specifically deserves disproportionate protection (CODEOWNERS lock + an
explicit "no code path may mutate a committed entry" test suite) while
everything else gets normal, lighter review.

**Red-team's findings, which genuinely conflict with parts of the above
and should not be waved away**:
- The most likely collapse point in the whole roadmap is Phase 2's
  sensor/camera/ML work — that's a different engineering discipline
  (computer vision, hardware abstraction, device fragmentation) wearing
  the same UI, not a natural extension of a voice notes app.
- "Multi-trade" is a modeling trap as much as an opportunity: fishing
  catch data has a natural schema; generalizing the entity model to serve
  farming or SAR logs too risks turning the audit-friendly event schema
  into an unauditable generic bag of metadata.
- **Fleet learning (Phase 4) cannot be built without breaking
  local-first/no-backend, full stop** — any cross-boat aggregation needs a
  server somewhere, even for "anonymized" data. This is flagged as the
  single biggest risk in the entire roadmap. If it's ever pursued, it
  should be modeled as the user exporting to *their own* bucket that a
  separate, clearly-labeled tool reads — never a DeckBoss-operated
  endpoint — and that should be a deliberate, explicit decision, not
  something that arrives disguised as an aggregation feature.
- The regulatory-compliance angle is simultaneously the product
  brainstorm's favorite pitch ("black box mode" for insurers/regulators)
  and the red-team's biggest flagged trap: a volunteer project's data model
  quietly becoming something people's fishing licenses depend on, with no
  chain-of-custody guarantees or legal review, is a real liability path —
  for users and for the project. This tension is currently **unresolved**.
  Nobody has decided on purpose whether DeckBoss is pursuing
  compliance-grade credibility or explicitly disclaiming it. It's
  currently drifting by default because the schema design happens to
  support the claim, not because anyone chose it.

## What's actually open — the decisions nobody has made yet

1. Is DeckBoss pursuing "credible enough for regulatory/insurance use"
   as a real goal, or explicitly disclaiming it ("not a substitute for
   official reporting")? This affects how loudly the additive-corrections
   design gets marketed and how much legal/process rigor it needs.
2. Is fleet learning (Phase 4) worth doing at all if it requires the first
   real crack in "no backend, ever"? If yes, what's the actual boundary
   (opt-in federated export vs. anything resembling a DeckBoss-run
   aggregation service)?
3. How far to lean into "multi-trade substrate" as the real strategic bet
   vs. staying fishing-specific and deep rather than broad and shallow?
4. Sequencing: is the `ext.namespace` + domain-pack split worth doing
   *before* any Phase 2 feature work, even though it delivers nothing
   user-visible on its own? (The people who ran this brainstorm lean yes —
   but you should form your own view, not just inherit theirs.)

## Your task

Think about this at the highest level you can. Specifically:

- Propose an actual sequenced next-2-to-4-weeks plan — not a restatement
  of the four-phase roadmap, a real prioritized list given everything
  above, including what to explicitly *not* do yet.
- Take a real position on the four open decisions above. Don't hedge all
  of them — pick the ones you have a strong view on and say so plainly.
- If you think any part of this brief — the roadmap, the brainstorm
  synthesis, the "must-do now" architecture calls — is wrong or
  overcautious or undercautious, say that directly and argue for your
  alternative.
- You do not need to write code or a full spec. A sharp, well-argued
  strategic memo is more valuable right now than an implementation plan.
