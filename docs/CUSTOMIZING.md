# Customizing and forking DeckBoss

This is for developers — forking the app, self-hosting it, wiring in a
new storage backend, or adapting it for a trade other than commercial
fishing. If you just want to *use* DeckBoss, see
[docs/USER_GUIDE.md](./USER_GUIDE.md) instead. If you want to contribute
changes back to this repo rather than fork away, see
[CONTRIBUTING.md](../CONTRIBUTING.md) — this doc assumes you're running
your own instance, which needs less ceremony.

Read [ARCHITECTURE.md](../ARCHITECTURE.md) first for the module map and
the design invariants. This doc is the practical "how do I actually change
X" companion to that.

## Forking and deploying your own instance

DeckBoss is a static site — zero backend, so "deploying your own instance"
just means building `dist/` and pointing any static host at it.

```bash
git clone https://github.com/purplepincher/deckboss.git
cd deckboss
npm install
npm run build   # outputs to dist/
```

`.github/workflows/deploy-pages.yml` already deploys to GitHub Pages on
every push to `main` — fork the repo, enable Pages in your fork's Settings
(Source: GitHub Actions), and it works unmodified except for one thing:
the workflow builds with `BASE_PATH=/deckboss/` because a project repo
with no custom domain serves at `https://<org>.github.io/deckboss/`. If
your fork has a different name, or you're setting up a custom domain,
update or remove that env line (see the comment in
[`vite.config.ts`](../vite.config.ts) for why it exists at all).

Any other static host (Cloudflare Pages, Netlify, S3+CloudFront, a folder
on your own server) works the same way: `npm run build`, serve `dist/`.

## Environment variables

| Variable | Purpose | Required? |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | OAuth Client ID for the Google Drive storage adapter (see [README.md](../README.md#google-drive) for how to create one) | Only if you want Google Drive as a backend. Cloudflare R2, Oracle, and local ZIP export all work with zero env config — credentials are entered by each user at runtime in Settings. |
| `BASE_PATH` | Overrides Vite's `base` for builds served under a subpath | Only needed for GitHub Pages without a custom domain — see above |

Set these in `.env.local` for local dev, or your host's build-time env
config for deployment. Neither is a secret that needs protecting at build
time — `VITE_GOOGLE_CLIENT_ID` is a public OAuth client identifier, not a
secret, and is safe to bake into the bundle (it's already how it works).

## Adding a new storage backend

Every backend implements one interface —
[`StorageAdapter`](../src/core/storage/interface.ts):

```ts
interface StorageAdapter {
  readonly id: StorageBackendId;
  readonly displayName: string;
  readonly icon: string;
  isAuthenticated(): Promise<boolean>;
  authenticate(): Promise<void>;
  logout(): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(prefix: string): Promise<FileMetadata[]>;
  readBlob(path: string): Promise<Blob>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  deleteBlob(path: string): Promise<void>;
  getManifest(): Promise<Manifest>;
  writeManifest(manifest: Manifest): Promise<void>;
}
```

Start from [`src/core/storage/adapters/local-zip.ts`](../src/core/storage/adapters/local-zip.ts)
— it's the simplest complete implementation (no auth, no network) and
shows every method with nothing else in the way. For an authenticated
network backend, [`s3-compatible.ts`](../src/core/storage/adapters/s3-compatible.ts)
is the pattern to copy (it's what both R2 and Oracle actually are —
S3-compatible storage with different default regions).

Once written, wire it into two places:
1. **[`registry.ts`](../src/core/storage/registry.ts)**'s `buildAdapter()`
   — add a case for your new `StorageBackendId`. Use a dynamic
   `import()`, not a static one, for anything with a non-trivial
   dependency (the existing adapters do this specifically so a user who
   never touches your backend never downloads its code — see
   `ARCHITECTURE.md`'s note on this and the Lighthouse-driven bundle-size
   work in `ROADMAP.md` for why it matters).
2. **[`interface.ts`](../src/core/storage/interface.ts)**'s
   `StorageBackendIdSchema` — add your backend's id to the enum.

Nothing else needs to change. `sync-engine.ts` is the only code that calls
`StorageAdapter` methods, and it's written against the interface only.

## Adapting the vocabulary for a different trade

[`src/services/entity-extractor.ts`](../src/services/entity-extractor.ts)
holds the fishing-specific keyword lists (species, gear, location terms,
weather). If you're adapting DeckBoss for a different trade — farming,
search-and-rescue, contracting, anything that keeps verbal, timestamped
field logs — this is the one file that's actually fishing-specific;
everything else (the recording pipeline, storage, sync, the corrections
model) is domain-agnostic already.

Today, customizing this means editing the arrays in that file directly and
maintaining your fork. Splitting this into a swappable `domain-packs/`
structure so a fork doesn't have to touch core files at all is a
deliberately deferred decision — see `ROADMAP.md`'s "Extension
architecture" section for why (short version: not worth building until a
second real domain pack actually exists). If you're building one, that's
exactly the signal that would justify doing the split — open an issue
saying so.

## Changing transcription defaults

[`src/config/schema.ts`](../src/config/schema.ts)'s `defaultAppConfig()`
sets Web Speech API as the default transcription engine, not Whisper —
deliberately, so a new user's first recording works without an API key.
If your fork has a different constraint (e.g. you're bundling a paid
Whisper key for a closed group of testers), change the default there. The
`TranscriptionEngineChoiceSchema` in the same file is the full set of
valid values.

## What not to casually change

[`CODEOWNERS`](../.github/CODEOWNERS) locks a small set of files — the
`LogEntry` schema, `entry-builder.ts`, `invariants.ts`, `local-db.ts`,
`conflict-resolver.ts` — because they implement the one invariant this
project's trustworthiness rests on: a committed entry is never mutated,
only appended to. This is enforced mechanically, not just by convention —
`invariants.ts`'s `assertWriteIsAdditive()` runs on every write and throws
if it's violated, and `tests/unit/invariants.test.ts` /
`tests/unit/local-db.test.ts` cover it directly. If your fork needs to
change how corrections work, read the doc comment at the top of
[`log-entry.ts`](../src/core/types/log-entry.ts) first — it explains the
actual reasoning (offline sync safety, not the compliance framing an
earlier draft used) and what breaks if you remove it.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173
npm run test        # vitest — 41 tests as of this writing, including a
                     # fake-indexeddb-backed suite for local-db.ts since
                     # jsdom doesn't implement IndexedDB itself
npm run typecheck
npm run lint
npm run build
```

No build step touches a network beyond `npm install` — the entire test
suite, typecheck, and production build run fully offline.
