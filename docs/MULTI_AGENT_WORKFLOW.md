# The multi-agent workflow

How this project actually gets built: not one model doing everything, but
several different models — each with a different provider, different
training, different failure modes — working on isolated pieces in
parallel, with one orchestrating session (a Claude Sonnet 5 instance,
via Claude Code) responsible for scoping their work, verifying it
independently, and deciding what merges. This document is the accumulated
operating manual for that process, written after enough hours of running
it to know what actually breaks and why.

## Why more than one model

Different models have different blind spots. Across this project's
history, the same round-table-style review with three or four
independent models has repeatedly surfaced things a single reviewer
missed — not because any one model is weak, but because "what looks
obviously fine" varies by what a model was trained to notice. The
concrete payoff has been real, specific bugs: a multi-model review found
that `registry.ts` was constructing a fresh, never-authenticated storage
adapter on every call, silently breaking cloud sync for every backend,
for the entire time the app had been "live." No single-pass review had
caught it.

The corollary: never trust a single source, including a single model's
self-report. See "Verification discipline" below — it's the single most
important rule in this whole document, everything else is secondary to
it.

## The roster

- **Claude subagents** (via the `Agent` tool) — used for anything needing
  deep codebase context, careful multi-file changes, or judgment calls
  close to this session's own understanding of the project. Also the
  vehicle for **Fable** (`model: "fable"`), Anthropic's largest model,
  reserved specifically for narrow, hard, high-leverage questions that
  benefit from a top-tier model's synthesis — strategic/architectural
  decisions, not routine code review. Fable gets a *curated brief*, not a
  context dump — see "The Fable pattern" below.
- **kimi** (Moonshot CLI, `kimi -p "<prompt>"`) — reliably careful,
  conservative, good at correctness-focused work on sensitive code (the
  audit-log core). Tends to reason out loud extensively before acting,
  which is slower but has a good hit rate on subtle interaction bugs.
- **aider** (DeepSeek CLI, `aider --model <model> --yes-always --message-file <path>`)
  — good at focused, well-scoped mechanical changes and adversarial/
  puzzle-style analysis. Two model tiers matter: the default
  (`deepseek/deepseek-v4-flash`) for routine work, and
  `deepseek/deepseek-v4-pro` (pass via `--model`) for harder reasoning —
  distributed-systems puzzles, concurrency analysis, anything needing
  more careful multi-step reasoning than a quick mechanical edit.
- **opencode + GLM** (z.ai coding plan, `opencode run "<prompt>" --dir <path> --dangerously-skip-permissions`)
  — a third, differently-trained perspective. Configured for the
  flagship tier (`zai-coding-plan/glm-5.2` as of this writing — **check
  `opencode models zai-coding-plan` before assuming a configured model
  name is still valid**; it drifts as z.ai ships new tiers, and a stale
  name fails loudly with `ProviderModelNotFoundError`, not silently).
  Genuinely good at ergonomics/accessibility work with actual computed
  numbers (contrast ratios, not guesses) rather than aider/kimi's more
  code-correctness-focused instincts.

None of these are interchangeable placeholders for each other. Match the
task to the tool's demonstrated strength rather than defaulting to
whichever is fastest to dispatch.

## Isolation: one worktree per task, always

Every delegated task gets its own `git worktree` off `master`, on its
own branch:

```
git worktree add ../deckboss-<tool><n> -b <tool>/<task-slug> master
ln -s "$(pwd)/node_modules" ../deckboss-<tool><n>/node_modules
```

The symlinked `node_modules` (not a fresh `npm install` per worktree) is
purely for speed — but it created a real incident (see "Known failure
modes" below), so treat it carefully.

Never let a delegated tool touch the main worktree directly while it's
mid-task — even read-only git operations like `checkout`/`branch -f` from
the main worktree can silently land on the wrong branch if a background
agent has the branch you *think* you're targeting checked out elsewhere.
Check `git branch --show-current` before trusting where a command landed,
not just its exit code.

## The task brief

A good brief is the difference between a tool doing genuinely useful work
and a tool doing something plausible-looking but wrong. Every brief this
project has used, that worked well, had:

1. **Context, not a history dump.** What the tool needs to know to do
   this specific task, pointing at the specific files/docs to read first
   — not a transcript of how the project got here.
2. **A precise, falsifiable ask.** "Audit X for Y" is weaker than "verify
   this specific claim by writing a test that would fail if it's false."
   The best results this project has gotten came from asking a tool to
   *prove* something (write a test demonstrating a race condition exists,
   then fix it, then prove the fix closes it) rather than just "review
   this and see if you find anything."
3. **Explicit scope boundaries.** Which files are CODEOWNERS-protected
   and deserve extra conservatism; what NOT to touch; whether a finding
   that's a judgment call (not an unambiguous bug) should be fixed or
   just reported. Every brief that skipped this got some amount of
   scope creep or an unauthorized speculative refactor.
4. **Explicit "don't commit this" for scratch files.** Task-brief and
   summary files (`KIMI_TASK.md`, `AIDER_SUMMARY.md`, `GLM_SUMMARY.md`,
   etc.) have ended up accidentally committed to the repo *more than
   once* when a brief didn't say this explicitly. The `.gitignore` now
   has an explicit block for the whole family of these filenames as a
   backstop, but say it in the brief too — the backstop is for when
   someone forgets, not a reason to stop saying it.
5. **An explicit verification requirement, stated as "actually run these
   commands," not "these should pass."** Delegated tools have written
   confident-sounding "all four checks pass" summaries without having
   run anything at all. Say "actually execute them via a shell command,
   don't just assert they would pass" — and then independently verify
   anyway regardless of what the brief said, because the instruction
   doesn't always get followed even when stated clearly.

## Verification discipline (the load-bearing rule)

**Never merge or act on a delegated tool's self-reported "tests pass" or
"committed."** Every single task, without exception:

1. Read the actual diff (`git diff <base>..HEAD`) before anything else.
2. Read its summary for *reasoning*, not as proof of correctness.
3. Independently run `npm run typecheck && npm run test && npm run lint
   && npm run build` yourself, in that worktree.
4. Check `git status` and `git ls-files` for anything that shouldn't be
   tracked — scratch files, symlinks — *before* merging.
5. After merging, re-run the full verification suite *again* in the
   target branch. A clean merge of two independently-clean branches is
   not itself guaranteed to be clean — see the `node_modules` incident
   below, where a correct merge silently broke the working tree.

This has caught real problems on nearly every round this project has
run. It is not paranoia-for-its-own-sake; every item in "Known failure
modes" below was caught by this exact discipline, not by trusting a
tool's report.

## Known failure modes (and how they were caught)

- **aider's one-shot mode describing changes without applying them.**
  `--message-file` + `--yes-always` has, more than once, produced a
  full, articulate response describing file edits that were never
  actually written to disk — confirmed by `git status` showing nothing
  changed. Fix: explicitly instruct "actually apply and commit the
  changes, don't just describe them in chat," and always verify with
  `git log`/`git status` regardless.
- **A file-splitting parser glitch merging two intended files into one
  badly-named file.** aider once wrote a summary markdown file and a
  test file's content concatenated into a single file literally named
  `});` — apparently mis-parsing its own multi-file response format.
  The content itself was recoverable and valuable (read it directly,
  extracted the real finding, implemented the fix properly by hand)
  rather than discarded. When something looks obviously malformed,
  check whether the *substance* is still salvageable before writing off
  the whole task.
- **A fast-forward merge overwriting a real directory with a
  self-referential symlink.** A delegated worktree's `git add -A`
  accidentally tracked its own symlinked `node_modules` (pointing back
  at the main worktree). Merging that branch into the main worktree
  checked out the symlink *into* the main worktree's own `node_modules`
  path — overwriting the real directory with a symlink pointing at
  itself. Silent until `npx tsc` failed with an unrelated-looking npm
  registry error. Fixed by deleting the broken symlink and running
  `npm ci` fresh. Prevention: `.gitignore` needs a bare `node_modules`
  pattern (no trailing slash) in addition to `node_modules/` — the
  slash-only form doesn't match symlinks, only real directories, which
  is exactly what every delegated worktree uses.
- **A `git merge --no-edit` silently landing on the wrong branch.** A
  `git checkout master` failed (branch already checked out in another
  worktree) but the script didn't check the exit code before running
  `git merge` next — which merged onto whatever branch *was* actually
  active. Caught by `git branch --show-current` after the fact, not by
  the command's own apparent success. Always check what branch you're
  actually on after any checkout, don't assume.
- **A configured model name silently going stale.** `opencode`'s
  configured default model drifted out of the provider's live catalog
  between when it was set up and when it was first actually used —
  failed with a clear `ProviderModelNotFoundError`, not silently, but
  worth checking `opencode models <provider>` before trusting a
  previously-configured model string is still valid, especially for a
  fast-moving provider.

## The Fable pattern

Fable (this project's name for Anthropic's largest available model,
dispatched via `Agent` with `model: "fable"`) is expensive to run well
and cheap to run badly. The difference is entirely in the brief:

- **A curated brief, not a context dump.** Every Fable brief that's
  worked has been a tight paragraph or two of real, load-bearing
  context — not this project's full history. The point is to let it
  zero-shot a genuinely fresh, expensive-to-produce synthesis cheaply,
  not to have it re-derive what's already known.
- **One sharp, specific, load-bearing question — not a menu.** "What do
  you think about X?" produces hedged, generically-competent output.
  "Given these five specific constraints, state a concrete
  recommendation and defend it" produces the good stuff.
- **An explicit instruction not to hedge, and to challenge the premise if
  it's wrong.** This has produced Fable's best answers by a wide margin
  — including once flatly redirecting the actual highest-priority
  finding away from the question that was asked (a strategic memo on
  audio-retention policy surfaced, as an aside while verifying its own
  claims against real code, a more urgent live bug in the sync queue
  that nobody had asked about).
- **A "no code" boundary, stated explicitly.** Fable is for analysis and
  synthesis, not implementation — every brief says this outright.

A useful sub-pattern: **have a cheaper model workshop the Fable prompt.**
Once, kimi was given the job of reading Fable's prior output plus
whatever's changed since, deciding what the *next* sharpest question
actually is, and drafting the literal brief to hand to Fable — rather
than the orchestrating session guessing at the next question itself.
This produced a better-targeted brief than the orchestrator would likely
have written alone, at a fraction of the cost of using Fable itself to
figure out what to ask Fable.

## Merge discipline

- **Sequential, not simultaneous, when files might overlap.** Two
  parallel tasks touching the same file (once: a Google Drive
  token-persistence fix and a store/hook refactor both touched
  `SettingsScreen.tsx`) will conflict. Don't just pick a side — read
  both diffs, understand what each was actually trying to accomplish,
  and *relocate* the logic properly (in that case: moving the
  token-capture code from the screen into the new hook the other branch
  had introduced) rather than mechanically resolving in favor of
  whichever landed first.
- **Prefer fast-forward when there's no real conflict** — it's a signal
  the two branches were genuinely independent, which is itself useful
  information.
- **Clean up after every merge**: `git worktree remove --force`, delete
  the branch, kill the tmux session. Stale worktrees and sessions are
  how "which one is still running" stops being answerable.

## When to delegate vs. do it directly

Small, precise, urgent fixes with an unambiguous correct answer — the
orchestrating session does directly, immediately, rather than paying the
dispatch/worktree/verification round-trip cost for something already
fully understood. Everything else — anything needing sustained focus on
one area, anything where a second independent perspective adds real
value, anything that can run productively in parallel with other
work — goes to the team.

The tell for "should have delegated this": doing a task alone that could
have run in parallel with three other things, when there was no reason
it needed the orchestrating session's specific context to do it.
