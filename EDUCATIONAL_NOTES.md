# Educational-clarity pass — README.md

Rewrite goal: a reader with no background in offline-first apps, CRDTs, or
PWAs should be able to follow the whole document and understand not just
what DeckBoss does but why it's built the way it is — taught in place, not
simplified away.

## Changes made

- **PWA defined at first use** — replaced "offline-capable" with a concrete
  description (install to home screen, works with no signal, queues and
  syncs later) right where the term first appears.
- **CRDT motivated before it's named** — added a concrete two-phones,
  no-signal scenario (a captain and a deckhand both editing the same entry
  offline) to make the last-write-wins data-loss problem tangible before
  naming the state-based CRDT pattern that avoids it.
- **HashRouter defined in place** — explained what the `#` in a URL does
  and why it lets a static host serve every screen without server-side
  routing config, before using the term to justify the `BASE_PATH` setup.

## What did not change

Every original claim, number, link, and caution statement is unchanged.
No new features or capabilities were invented. The maritime voice and
specificity are preserved. Only `README.md` was touched — no source,
config, or other doc files.
