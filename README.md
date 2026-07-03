# DeckBoss

Voice-first digital fishing logbook. Local-first, your storage, your data.

> Tap to record. Every note gets a timestamp and GPS fix automatically.
> Everything lives on your device first and syncs to storage you own —
> Google Drive, Cloudflare R2, Oracle Object Storage, or a plain .zip export.
> No PurplePincher server ever holds your logs.

Part of the [PurplePincher](https://github.com/purplepincher) Vessel-as-a-Robot
family. See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces fit
together, and [SAFETY.md](../cocapn-foundation) (in the sibling `cocapn-foundation`
repo) for the longer-horizon autopilot research this project deliberately does
*not* touch in Phase 1.

**DeckBoss is a personal log, not a substitute for official or regulatory
catch reporting.** The additive-corrections design (see below) exists
because it makes offline sync conflict-safe, not because this has been
reviewed or certified as evidence-grade for licensing or compliance
purposes — it hasn't. Don't rely on it for anything a regulator or insurer
needs to accept as authoritative.

## Status

Phase 1 MVP — see the roadmap in project history. Working today:

- Voice recording with GPS + timestamp capture (offline-capable)
- Web Speech API transcription by default; OpenAI Whisper as an opt-in upgrade
- Markdown + YAML frontmatter storage, one file per entry
- Additive corrections (amend/retract) — entries are never destructively edited
- Local-only IndexedDB persistence with an offline sync queue
- Storage adapters: Local ZIP export (works today, zero setup), Google Drive,
  Cloudflare R2, Oracle Object Storage (all need the user's own credentials —
  see setup below)

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
Routing itself uses `HashRouter`, which never needs a `base` — only asset
URLs do (see `vite.config.ts`). Once a custom domain is added, delete the
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

## Design principles

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full module map. The short
version:

- **Corrections are additive, never destructive.** Editing or "deleting" an
  entry appends a Correction event; the original capture is never
  overwritten. This is a deliberate divergence from the original Phase 1 dev
  guide, made to keep Phase 4's regulatory-compliance goal viable.
- **Web Speech API is the default transcription engine**, not Whisper — a
  beta fisherman shouldn't need an OpenAI account before their first
  recording works.
- **Nothing about storage credentials or API keys ever gets written to a
  file that syncs to the user's cloud storage.** `config/schema.ts`'s
  `AppConfig` lives in IndexedDB only.
