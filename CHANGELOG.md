# Changelog

All notable changes to this project are documented in this file. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

No git tags exist yet, so everything below is grouped under the version
currently declared in `package.json` (`0.1.0`) rather than invented release
dates. See `ROADMAP.md` for the full decision record and reasoning behind
each of these — this file summarizes *what* shipped, not *why*.

## [0.1.0]

### Added

- Core recording → transcript → sync loop: tap-to-record with automatic
  GPS/timestamp capture, Web Speech API transcription by default (no
  account needed), optional Whisper upgrade.
- Markdown + YAML frontmatter storage, one human-readable file per entry.
- Additive corrections (amend/retract) — entries are never destructively
  edited; a "Show retracted" toggle keeps retracted entries reachable.
- Storage adapters: Local ZIP export, Google Drive, Cloudflare R2, Oracle
  Object Storage (BYOK — no PurplePincher-run server ever holds user data).
- Offline sync queue with upload verification (read back after write, not
  trusted on a successful write alone) and an automatic reconciliation
  pass (`reconcileAudio`) for anything that drifts out of sync.
- Ask-Your-Log: a local keyword/date/species/gear/weather query layer
  over the timeline, including voice search — no LLM, no API key
  (`4d1587d`, wired into the UI in `e29da81`).
- Whisper offline-retry queue for transcription jobs that fail while
  offline (`4a592c6`).
- Property-based tests (`fast-check`) proving the sync/merge core's
  convergence and no-silent-drop guarantees across randomized concurrent
  scenarios, not just hand-written orderings (`cd3bd7f`, `f5459e0`).
- A stable per-device id, a storage-usage meter, local diagnostics
  counters, and a one-tap "export everything" support bundle.
- Domain-pack split: fishing vocabulary moved out of the generic entity
  extractor into `domain-packs/fishing/` (`e9dbc91`).
- Landing page, social preview card, and app/landing route restructure
  (`933d3e9`, `d121188`).

### Fixed

- **Cloud sync silently no-op'd for every network backend** — the single
  most severe bug found this project's history; caught by the
  multi-agent build process's own verification discipline, not by a user
  report (`646b782`).
- **A fresh device's first sync could silently destroy the archive's
  manifest** — found and fixed during the restore-drill adversarial test
  round; regression test added with confirmed red→green proof (`754a960`).
- **Audio does not rehydrate on a recovering device** — lazy-on-access
  rehydration added (`9695acb`), plus a zero-local cold-start fallback
  scan for entries physically present in storage but missing from the
  manifest (`d481153`).
- `GoogleDriveAdapter.listFiles()` was not actually recursive despite the
  interface's documented contract, and `S3CompatibleAdapter.listFiles()`
  had no pagination past 1000 keys — both found and fixed while verifying
  the fallback-scan fix above, not assumed (`342ff7a`, `dd95701`).
- A real `IMMUTABLE_FIELDS` gap: `transcript`/`entities`/`tags` were not
  protected against silent mutation on the write path (`150100d`,
  `7e11b42`); a compile-time guard now prevents the list from silently
  drifting out of sync again (`9c029e2`).
- Silent audio-upload data loss found by a strategic review — uploads are
  now verified and reconciled (`6a0ed3d`, `aa0d285`).
- The hold-to-cancel gesture during recording — the one destructive,
  wet-glove-unreliable action in an otherwise append-only app — replaced
  with a post-save Discard step (`8c05d21`).
- Silence/no-signal recordings were incorrectly marked "edited" instead
  of leaving the transcript honestly unset (`d38e816`).
- Timeline render time at scale: 1.5–3s → ~20ms for 1000 entries, via a
  fast-path shape guard avoiding full re-validation on every load
  (`3d888ad`, `d8ddbc9`).
- Two concurrency bugs in the sync layer found by an adversarial code
  review (`117906f`).
- `npm run typecheck` never actually checked `tests/` (`408c623`).

### Security

- CSP added (script-src/object-src/base-uri locked down) and credential
  entry moved from unmasked `prompt()` dialogs to real password-masked
  form fields (`a41936e`).
- A self-inflicted CSP regression (missing `media-src`) that silently
  broke audio playback, caught within minutes by two independent agents
  working separately, then fixed (`4d03935`).
- CSP fixed again after it silently broke Google Drive OAuth by blocking
  Google Identity Services (`3f34421`, `f48355a`).

### Performance

- Main bundle cut via dynamic-imported storage adapters and lazy-loaded
  screens; service-worker registration deferred (`b94baa8`).
- `js-yaml` split out of the main bundle; `reconcileAudio()` batched
  (`c73a2b8`, `1cb4c12`).

### Changed

- README rewritten multiple times toward an honest, instructional style:
  the multi-agent build process documented (`8bfdd6a`), then restructured
  to lead with Quickstart and drop narrative framing (`7e54910`,
  `78e3894`).
- Repo made "professional": license, Code of Conduct, issue/PR templates
  (`95d2811`).
