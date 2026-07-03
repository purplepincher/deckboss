# Field-readiness briefing for Fable — DeckBoss pre-launch hardening

This is a follow-up to `FABLE_BRIEFING.md` (the original strategic
briefing) and `ROADMAP.md` (the living decision record — both in this
repo's root). Read this one on top of those two, not instead of them. The
situation has changed since that first round, and the question changed
with it.

## What's different since the last briefing

Real commercial fishermen are now lined up and ready to start using
DeckBoss for actual work. That was the top-priority gap the last strategic
review identified — "every data point so far has come from agents, not a
working fisherman" — and it's about to close. Week 1 of the roadmap that
came out of that review has also shipped and been independently verified
live: a write-path invariant validator that mechanically enforces
"corrections are append-only, entries are never mutated" on every write, a
boot-time check that catches storage failures loudly instead of silently
(built specifically because a real bug once let three of four IndexedDB
stores silently never get created), a CODEOWNERS lock on the audit-log
core, and an explicit disclaimer that this isn't a regulatory-compliance
tool. All of that is live at https://purplepincher.github.io/deckboss/ and
on `main` in this repo.

**The question is no longer "what's the strategic roadmap." It's "is this
actually safe to hand to someone whose season depends on it, and what
would make it stop being safe."**

## What "rock solid" needs to mean here, concretely

A fisherman using this isn't a beta tester filing bug reports — if the app
loses a week of catch notes, or silently fails mid-trip with no signal to
fall back on, that's not a bug ticket, that's a person's real working
record gone and their trust in the tool gone with it. The bar has to be
"safe to depend on," not "doesn't crash in a demo."

Some concrete risk areas already known, listed so you have real material
to react to rather than starting from nothing — but don't treat this as
exhaustive, and push back on any of these you think are overweighted or
underweighted:

- **No audio storage cap or eviction policy exists yet.** A season of
  daily voice recordings in IndexedDB could hit browser storage quotas
  with no warning and no graceful degradation currently built. What
  should happen when that limit gets close — warn early, auto-prune
  oldest audio while keeping transcripts, block new recordings with a
  clear message? Nothing is decided.
- **Web Speech API (the default transcription engine) is a Chrome/Edge
  feature.** If any of the lined-up fishermen are on an iPhone, Safari's
  support is inconsistent and iOS's aggressive background-tab killing is
  a known failure mode for exactly this kind of continuous-recognition
  use case. Nobody has tested this app on an actual iPhone yet — all QA
  so far has been headless Chromium via Playwright. This might be the
  single biggest gap between "verified working" and "actually works in a
  real fisherman's pocket."
- **No field-conditions QA yet** — everything verified so far is a clean
  desktop-Chromium environment with fake GPS and fake mic devices. Real
  conditions: spotty connectivity flipping on and off mid-trip, a phone
  at 8% battery, a recording interrupted by an incoming call, the app
  backgrounded for hours between hauls, cold-start after the phone
  restarted overnight, salt-water-wet fingers on the touchscreen.
- **No in-app path for a fisherman to get help or report something
  wrong.** If a note doesn't save, does the app tell them, or do they
  just find out later it's gone? Is there a "something's wrong, here's
  what to do" path that doesn't require them to know what GitHub is?
- **Recovery story is thin.** ZIP export exists as a manual backstop but
  nothing prompts a user to actually use it, and there's been no test of
  what a real recovery from browser storage getting cleared (a user
  clearing site data, reinstalling the PWA, switching phones) actually
  looks like end to end.
- **The four-agent QA process that caught real bugs before was still
  agent-only** — good at finding the class of bug an agent thinks to
  test for, blind to the class a real fisherman's actual workflow would
  surface in the first ten minutes.

## Your task

You're being asked for a pre-field-beta hardening assessment, not more
strategic brainstorming. Specifically:

1. **Prioritize.** Given real fishermen start using this soon, what's the
   actual highest-risk gap to close first — not a long list, your honest
   read of the one or two things most likely to cause a real, trust-
   destroying failure in week one of field use.
2. **Say what "rock solid enough to ship to fishermen" actually requires**
   as a concrete bar — not "more testing," but specific conditions that
   would let you say "yes, hand it to them now" vs. "no, not yet, here's
   why."
3. **React to the risk list above.** Which of these do you think is
   overweighted, underweighted, or missing entirely? You have no reason
   to just agree with what's already been flagged.
4. **Propose what to actually ask the fishermen to do in week one** —
   given they're about to become the best source of signal this project
   has ever had, what should the humans running this project be watching
   for, asking about, or explicitly *not* getting in the way of, so the
   first real field data is as useful as possible?

No code. A sharp, opinionated readiness memo — like the last one, where
you disagreed with parts of the brief and were right to.
