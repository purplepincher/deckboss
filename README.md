# DeckBoss

[![Deploy to GitHub Pages](https://github.com/purplepincher/deckboss/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/purplepincher/deckboss/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Landing page](https://img.shields.io/badge/landing-purplepincher.github.io%2Fdeckboss-blue)](https://purplepincher.github.io/deckboss/)
[![Open app](https://img.shields.io/badge/open%20app-%2Fdeckboss%2Fapp-blue)](https://purplepincher.github.io/deckboss/app/)

A voice-first fishing logbook: tap to record, and timestamp, GPS, and
transcript are captured automatically. It's a **Progressive Web App
(PWA)** — a website you install on your phone's home screen like an app,
that keeps working with no signal at all. Recordings queue on your
device and sync later, whenever you're back in range. Runs entirely in
the browser, and syncs only to storage you own — Google Drive, Cloudflare
R2, Oracle Object Storage, or a plain `.zip` export. No PurplePincher
server ever holds your logs.

**DeckBoss is a personal log, not a substitute for official or regulatory
catch reporting.** The additive-corrections design (see
[Design principles](#design-principles) below) exists because it makes
offline sync conflict-safe, not because this has been reviewed or
certified as evidence-grade for licensing or compliance purposes — it
hasn't. Don't rely on it for anything a regulator or insurer needs to
accept as authoritative.

![DeckBoss timeline showing voice-recorded fishing log entries](landing-assets/screenshot-timeline.png)

## Running it locally

Requires Node 20+ (the PWA build tooling needs it; the app itself only needs a
modern browser).

```bash
npm install
npm run dev       # http://localhost:5173
npm run test      # vitest unit tests
npm run typecheck
npm run build      # production build to dist/
```

No backend, no server, nothing to deploy besides the static `dist/` output —
GitHub Pages, Cloudflare Pages, or any static host works.
`.github/workflows/deploy-pages.yml` deploys `dist/` to GitHub Pages on every
push to `main`, building with `BASE_PATH=/deckboss/` since a project repo
with no custom domain is served at `https://<org>.github.io/deckboss/`.
Routing itself uses `HashRouter` (a routing approach that keeps the current
screen in the URL after a `#`, e.g. `/#/timeline` — the browser never sends
the part after `#` to the server, so a static host with no server-side
routing config can serve every screen from the same one `index.html`).
That's why `HashRouter` never needs a `base` path — only asset URLs do
(see `vite.config.ts`). Once a custom domain is added, delete the
`BASE_PATH` env line from the workflow (defaults back to `/`).

## Storage setup (BYOK)

DeckBoss never asks you to trust a PurplePincher-run server with your data.
Every cloud backend needs your own account and credentials, entered in
Settings.

### Google Drive

1. Go to https://console.cloud.google.com and create a project.
2. Enable the **Google Drive API**.
3. Configure the OAuth consent screen (External, Testing mode is fine for a
   beta — caps at 100 users before Google requires verification).
4. Create an **OAuth 2.0 Client ID** (type: Web application).
5. Add your app's URL to **Authorized JavaScript origins** (e.g.
   `http://localhost:5173` for dev, your production URL for deployed).
6. Set `VITE_GOOGLE_CLIENT_ID` in a `.env.local` file (or your host's env
   config) to that client ID.
7. In the app, Settings → Storage → Google Drive → Connect.

The app requests the `drive.file` scope only — it can see files it created,
never your whole Drive.

### Cloudflare R2

1. Create an R2 bucket at https://dash.cloudflare.com.
2. Generate an S3-compatible API token (Account API tokens → R2 token).
3. Enable CORS on the bucket for your app's origin, allowing GET/PUT/DELETE.
4. In the app, Settings → Storage → Cloudflare R2 → Connect, and enter the
   endpoint, bucket name, access key ID, and secret access key.

### Oracle Object Storage

Same pattern as R2 — Oracle's Object Storage exposes an S3-compatible
endpoint. Generate Customer Secret Keys in the Oracle Cloud Console and enter
them the same way.

### Local ZIP export

No setup. Settings → Storage → Export ZIP bundles every entry (Markdown +
audio) into a downloadable .zip.

## Documentation by audience

- **Just want to use it?** → [docs/USER_GUIDE.md](./docs/USER_GUIDE.md) —
  no jargon, no assumed technical knowledge.
- **Want to fork it, self-host it, or adapt it for a different trade?** →
  [docs/CUSTOMIZING.md](./docs/CUSTOMIZING.md)
- **Want to contribute changes back to this repo?** →
  [CONTRIBUTING.md](./CONTRIBUTING.md) — three lanes depending on whether
  you're reporting a bug, suggesting a domain change, or writing code.
- **Want to understand how the codebase actually fits together?** →
  [ARCHITECTURE.md](./ARCHITECTURE.md) — the module map and the design
  invariants everything else is built on.
- **Curious about the strategic reasoning and open decisions?** →
  [ROADMAP.md](./ROADMAP.md) — the living decision record.
- **Want to go deeper — the field-beta plan, the interaction-design
  reasoning behind recent UI changes, the multi-agent build process, or
  the formal case for why offline sync doesn't lose data?** →
  [docs/FABLE_PHASE2_PLAN.md](./docs/FABLE_PHASE2_PLAN.md),
  [docs/FABLE_FRONTEND_DESIGN.md](./docs/FABLE_FRONTEND_DESIGN.md),
  [docs/MULTI_AGENT_WORKFLOW.md](./docs/MULTI_AGENT_WORKFLOW.md), and
  [docs/RESEARCH_sync_resilience.md](./docs/RESEARCH_sync_resilience.md) /
  [docs/RESEARCH_multi_device.md](./docs/RESEARCH_multi_device.md).

See [`docs/cocapn-foundation-mirror/SAFETY.md`](./docs/cocapn-foundation-mirror/SAFETY.md)
(a local mirror of the sibling [`cocapn-foundation`](https://github.com/SuperInstance/cocapn-foundation)
repo's safety/schema docs — mirrored because that repo doesn't guarantee
permanence) for the longer-horizon autopilot/steering research this
project deliberately keeps out of scope — see `ROADMAP.md`'s "Fleet
learning: off the roadmap" entry for why that's a removed ambition, not
a deferred one.

## Design principles

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full module map. The short
version:

- **Corrections are additive, never destructive.** Imagine two crew phones
  both editing the same log entry while the boat has no signal — say, the
  captain fixes a typo in the species name on one phone, and a deckhand
  updates the catch count on the other. When both phones come back into
  range, whose edit wins? Most apps solve this with "last write wins,"
  which quietly throws away whichever edit synced second. DeckBoss doesn't:
  editing or "deleting" an entry appends a Correction event, and the
  original capture is never overwritten. The justification is sync safety,
  not compliance (see the disclaimer above): because edits are additive,
  two devices editing the same entry produce two Correction objects that
  always merge safely instead of conflicting, so nobody's edit ever
  silently disappears. This pattern has a formal name — a **state-based
  CRDT** (Conflict-free Replicated Data Type): a grow-only set of
  corrections merged by union, with a proven convergence property for the
  derived view under a documented, explicitly-stated clock-skew
  assumption. See
  [docs/RESEARCH_sync_resilience.md](./docs/RESEARCH_sync_resilience.md)
  §1 for the proof sketch, and the doc comment at the top of
  `src/core/types/log-entry.ts` for the practical reasoning.
- **It works with zero signal**, because zero signal is the normal
  operating environment on a working boat, not an edge case to handle.
  Entries queue locally and sync opportunistically when connectivity
  returns.
- **Web Speech API is the default transcription engine**, not Whisper — a
  beta fisherman shouldn't need an OpenAI account before their first
  recording works.
- **Nothing about storage credentials or API keys ever gets written to a
  file that syncs to the user's cloud storage.** `config/schema.ts`'s
  `AppConfig` lives in IndexedDB only.

## Status

Hardened MVP, headed into field validation. The core recording →
transcript → sync loop worked from early on; most of the work since has
gone into closing correctness and data-loss gaps that a multi-method QA
process kept finding — security review,
cross-browser testing, stress testing, and several independent rounds of
code audit (see `ROADMAP.md` for the blow-by-blow). The next milestone
isn't a feature. It's real fishermen: a 6-8 week field beta with 3-5
boats is the actual current focus, planned in detail in
[docs/FABLE_PHASE2_PLAN.md](./docs/FABLE_PHASE2_PLAN.md).

**Shipped and working:**

- Voice recording with GPS + timestamp capture, fully offline-capable
- Web Speech API transcription by default — no account needed before a
  first recording works; OpenAI Whisper as an opt-in upgrade, with an
  **offline Whisper retry queue**: if Whisper is configured but the network
  is unreachable at sea, the recording is saved locally and automatically
  re-transcribed when connectivity returns (see `enqueueWhisperRetry` in
  `sync-engine.ts`, exercised by `tests/unit/whisper-retry.test.ts`)
- Markdown + YAML frontmatter storage, one human-readable file per entry
- Additive corrections (amend/retract) — entries are never destructively
  edited; retracted entries stay recoverable via a "Show retracted" toggle
- Local-only IndexedDB persistence with an offline sync queue, uploads
  that are verified by reading them back rather than trusted on a
  successful write, and an automatic reconciliation pass for anything
  that still drifts out of sync
- Storage adapters: Local ZIP export (works today, zero setup), Google
  Drive, Cloudflare R2, Oracle Object Storage (cloud backends need the
  user's own credentials — see setup above)
- A stable per-device id, a storage-usage meter in Settings, local
  diagnostics counters, and a one-tap "export everything" support bundle
- Property-based tests proving the sync/merge core's convergence and
  no-silent-drop guarantees hold across randomized concurrent scenarios,
  not just the specific orderings someone thought to hand-write
- Ask-Your-Log: a local keyword/date/species/gear/weather/depth/location
  query layer over the timeline, including voice search — no LLM, no API
  key. Entity extraction is keyword + regex (no ML): it recognises species,
  gear, weather terms, relative locations, depths (e.g. "eighty fathoms"),
  measurements (degrees, feet, knots), and standalone quantities from the
  transcript text, so they become filterable query dimensions in
  Ask-Your-Log
- The hold-to-cancel gesture during recording — formerly the one
  destructive, wet-glove-unreliable action left in an otherwise
  append-only app — is gone, replaced by a post-save Discard step (design
  reasoning in
  [docs/FABLE_FRONTEND_DESIGN.md](./docs/FABLE_FRONTEND_DESIGN.md))

**What's left before the field beta:** the restore-drill (fresh device,
zero local state, recovers everything from a shared archive) has been
run and hardened against `LocalZipAdapter` — the manifest-destruction
bug, the audio-rehydration gap, and the stale-manifest fallback-scan gap
are all fixed and verified. What hasn't run yet is the same drill
against a real Google Drive or S3-compatible account on a real device —
see `ROADMAP.md`'s restore-drill section for the exact status.

## How this gets built

DeckBoss is built by an orchestrated team of AI models rather than one
model doing everything — Claude, Moonshot's kimi, aider on DeepSeek, and
GLM via opencode each take on pieces of work matched to a demonstrated
strength (concurrency-heavy sync puzzles, correctness-focused audits of
the write path, ergonomics passes with real computed numbers), with
independent verification at every merge instead of trusting any tool's
own report of what it did. This is the process that caught a bug where
cloud sync had silently never worked, for any backend, for the entire
time the app had been live. The full operating manual — including the
failure modes it's caused and how each was caught — is in
[docs/MULTI_AGENT_WORKFLOW.md](./docs/MULTI_AGENT_WORKFLOW.md).
