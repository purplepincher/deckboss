# Contributing to DeckBoss

Thanks for wanting to help. This project is maintained by one person right
now, not a foundation — that shapes everything below: the bar for
contributing is intentionally different depending on what part of the app
you're touching, because a small volunteer project dies from friction as
easily as it dies from chaos.

There are three lanes. Pick whichever one actually matches what you want
to do — you don't need to read the other two.

## Lane 1: You found a bug, or something felt wrong

You don't need to know how to code for this. Open a
[GitHub issue](https://github.com/purplepincher/deckboss/issues) and
describe what happened in your own words: what you did, what you expected,
what actually happened. If you're a captain using the app rather than a
developer, even better — say so, and use
**Settings → Support → Export everything** in the app first (see
[docs/USER_GUIDE.md](./docs/USER_GUIDE.md#if-somethings-wrong)) and attach
or reference that export. It carries local diagnostic counters that
usually explain more than a description can.

No template, no required fields. A one-line issue that says "recorded a
note on the dock, it never showed up in the log" is genuinely useful.

## Lane 2: You want to suggest a fishing/domain change, no code required

Wrong species in the entity extractor's vocabulary, a gear term it doesn't
recognize, a regulatory detail that's off — this doesn't need a pull
request. Open an issue describing the change in plain language. If you're
a working fisherman rather than a developer, this is very much the lane
for you: your domain knowledge is worth more here than code would be.

If DeckBoss ever gets adapted for a trade other than fishing (see
[docs/CUSTOMIZING.md](./docs/CUSTOMIZING.md#adapting-the-vocabulary-for-a-different-trade)),
this lane extends to that domain's own vocabulary too, reviewed by
whoever actually knows that trade — not by a fisherman, and not by the
maintainer alone if they don't either.

## Lane 3: You want to write code

Normal GitHub flow: fork, branch, PR. A few things that'll save you a
round-trip:

- **Run before you push**: `npm run typecheck && npm run test && npm run
  lint && npm run build`. All four need to pass — CI runs the same four
  on every PR.
- **New behavior gets a test.** Not a coverage mandate, just: if you fixed
  a bug, add a test that would've caught it; if you added a feature,
  add a test that exercises it. Look at `tests/unit/` for the existing
  pattern — most tests are plain Vitest against pure functions, no
  mocking framework needed.
- **[`CODEOWNERS`](./.github/CODEOWNERS)** locks a small set of files —
  the `LogEntry` schema, `entry-builder.ts`, `invariants.ts`,
  `local-db.ts`, `conflict-resolver.ts`. These implement the one
  invariant this project's trustworthiness rests on (committed entries
  are never mutated, only appended to). A PR touching these gets read
  more carefully, not because you're not trusted, but because a mistake
  here is qualitatively worse than a mistake anywhere else in the app —
  see the doc comment at the top of
  [`log-entry.ts`](./src/core/types/log-entry.ts) for the actual
  reasoning before proposing a change there.
- **Everything else gets normal review.** Don't expect — or apply —
  audit-log-level scrutiny to a UI tweak or a new storage adapter. That
  kind of friction is exactly what drives volunteer contributors away
  from small projects, and most of this codebase doesn't need it.

If you're planning something bigger than a small fix — a new storage
backend, a new screen, anything that'll take more than an evening — open
an issue first describing what you want to do. Not required, but it'll
save you from building something that doesn't fit before you find that
out.

## What this project is, honestly

Single maintainer, no formal governance beyond `CODEOWNERS`. That's not a
permanent state, just an honest description of where things are right
now — see [`ROADMAP.md`](./ROADMAP.md) for the actual current priorities
and open decisions, and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the
codebase fits together before you start.
