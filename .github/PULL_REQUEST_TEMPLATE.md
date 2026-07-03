## What this does

<!-- One or two sentences. What changed and why. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] New behavior has a test (fixed a bug → a test that would've caught
      it; added a feature → a test that exercises it)
- [ ] If this touches a [CODEOWNERS](../.github/CODEOWNERS)-locked file
      (the audit-log core — corrections/invariants/schema), I've read the
      doc comment at the top of `src/core/types/log-entry.ts` and this
      change doesn't weaken the append-only guarantee. If it does, I've
      explained why in this PR description.

CI runs the same four checks automatically — this list is so you catch
anything before that, not instead of it.
