# Task: audio rehydration on a recovering device

## Context

DeckBoss is a voice-first fishing logbook PWA. Its "restore drill" (see
`tests/unit/restore-drill.test.ts` and the "The restore drill" section of
`ROADMAP.md`) proved that a fresh device pointed at an already-populated
archive recovers all text/entries correctly, but **audio does not come
back locally on its own**. Every uploaded, verified audio blob is
genuinely re-fetchable via `adapter.readBlob()` (the bytes are never
lost) — but nothing in `src/` ever calls `readBlob()` to restore a local
copy. `src/ui/hooks/useAudioBlob.ts` currently only reads local
IndexedDB via `getAudioBlob()`, with no remote fallback.

Read `ROADMAP.md`'s "The restore drill" section in full before starting
— it lays out the exact gap and names three design options with
different cost/UX tradeoffs:
1. Automatic background rehydration
2. An explicit "download audio" action
3. Stream-on-play

## Your job

1. **Make a real design decision and write down why**, in a code comment
   or commit message — don't guess silently. A reasonable default for an
   offline-first product with a "never destroy a capture" ethos:
   automatic rehydration when an entry's audio is actually accessed
   (i.e. lazy-on-access, not a bulk background sweep on every device —
   that would be expensive and unnecessary for entries a user never
   revisits). But make your own call and justify it.
2. Implement it. Likely touches:
   - `src/ui/hooks/useAudioBlob.ts` — add a remote fallback path when
     local IndexedDB has no blob for an entry that has `audioMeta`
     (check the actual field name in `src/core/storage/interface.ts`
     and however entries track "this has audio" state).
   - `src/core/sync/sync-engine.ts` — you'll likely need to export
     `getActiveAdapter()` (currently an unexported `async function` —
     check its current signature, it may have changed) so the hook can
     get an adapter instance, or add a new exported helper function
     there rather than reaching into sync-engine internals directly.
   - Write the fetched blob back to local IndexedDB (the same local
     cache `getAudioBlob`/local-db.ts already uses) so it's a one-time
     fetch per entry, not a re-fetch on every access.
   - Any UI surfacing needed (e.g. `EntryDetailScreen.tsx` if it renders
     a loading/fetching state for audio).
3. **Verify with a real red/green regression test**, extending
   `tests/unit/restore-drill.test.ts` in the same adversarial two-device
   pattern the existing tests use (device A populates+syncs, device B
   is a fresh/wiped local state pointed at the same adapter instance).
   Prove: before your fix, device B's audio access returns nothing;
   after your fix, it successfully rehydrates from the archive. Confirm
   this is a genuine red→green proof, not just a new passing test.
4. Run `npm run typecheck && npm run test` and make sure everything
   passes, not just your new test — 162 tests currently pass, that
   count should only go up.

## Process — IMPORTANT, read this

- **Push your branch to origin early and often.** The branch
  `kimi/audio-rehydration` already exists on origin (empty). As soon as
  you've made any real progress — even just the design decision written
  down, or a first rough pass before it's fully working — commit and
  `git push origin kimi/audio-rehydration`. Do this repeatedly as you
  go, not just once at the very end. This environment's scratchpad does
  not survive a computer restart, and losing hours of work has happened
  before on this project — don't let it happen again.
- This is additive work on a real, tested, CODEOWNERS-relevant file
  (`sync-engine.ts`) — do not rewrite existing functions/exports/comments
  you don't need to touch. Keep the diff shaped like the task: mostly
  new code, not wholesale rewrites of what's already there.
- When you believe you're done, run the full verification yourself
  (typecheck + test) before declaring it finished, and say explicitly in
  your final report whether both passed.
