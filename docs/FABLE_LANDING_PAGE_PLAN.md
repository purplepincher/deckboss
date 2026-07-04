# Landing page + production-readiness plan

Status: plan of record, ready to dispatch. Decisions below are stated, not
offered as options — reasoning is included so a later session can re-derive
or overturn them deliberately.

Facts this plan is built on (all verified directly against the repo, not
assumed): the deployed site serves the SPA at `https://purplepincher.github.io/deckboss/`
with `BASE_PATH=/deckboss/` (vite.config.ts + deploy-pages.yml); `App.tsx`
routes `/` straight to `RecordScreen` via `HashRouter`; microphone/GPS
permission is requested **on first tap, not on page load** (useRecording.ts —
so the cold-visitor experience is "unexplained dark app," not "instant
permission prompt"); `index.html` has **zero `og:`/`twitter:` meta tags** and
no social-preview image exists; **no screenshot of the app exists anywhere in
the repo**; the manifest/meta description is the internal tagline "Your boat's
memory. Your data. Your shell.", which means nothing to a stranger; the field
beta has testers lined up but **nobody onboarded yet** (ROADMAP: "not yet
clear to proceed").

---

## 1. What the landing page is (content/design decision)

**One static page, dark, honest, screenshot-led, with a single CTA into the
live app.** No email capture (there is no backend and adding a third-party
form service contradicts the product's whole trust story), no pricing table
(it's free — the CTA says so), no AI-generated hero imagery (this audience is
skeptical of tech that looks like marketing; a real screenshot of the real
app is the only credible visual, and an obviously-AI ocean painting would
actively cost trust). Real product screenshots are the hero asset and they
have to be created as part of this work — they don't exist yet.

**Audience order:** (1) a commercial fisherman sent the link by another
fisherman — price-conscious, zero patience, reads on a phone; (2) a
developer/self-hoster arriving from GitHub. The page is written for #1;
#2 is served by a footer.

**Page structure, top to bottom:**

1. **Hero.** Wordmark + headline + one subhead + primary CTA. Headline
   direction (mmx drafts final words): the two facts that differentiate —
   *you talk instead of type, and it works with zero bars.* Something in the
   register of "A fishing log you talk to. Works with no signal, no account,
   no subscription." Primary CTA button: **"Open DeckBoss — free, nothing to
   sign up for"** → `./app/`. Secondary link: "View the code on GitHub."
   A phone-framed screenshot of the Record screen sits beside/below the CTA.
2. **How it works — three steps.** Tap. Talk. Done. Each step one sentence:
   timestamp and GPS fix attach automatically; transcript happens on-device
   via the browser; if there's no signal, the audio still saves and nothing
   is lost. This is the actual shipped behavior per the README — no
   embellishment.
3. **"Built for a working deck."** Three short trust blocks drawn from real
   shipped design decisions: works offline *by design* (offline is the normal
   operating mode, not an edge case); tap-only interaction, no gestures, made
   for gloves and wet hands; **nothing is ever deleted or overwritten** —
   entries are only ever corrected, and retracted notes stay recoverable.
4. **"Your data, not ours."** The strongest differentiator this product has:
   no account, no DeckBoss server, everything on your phone first and synced
   to storage *you* own (Google Drive, Cloudflare R2, Oracle, or a plain
   .zip). Open source, MIT. This section is what separates DeckBoss from
   every subscription fishing app, and it's 100% true, so it leads with
   plain declarative sentences, not marketing adjectives.
5. **Screenshot strip.** Timeline and entry-detail screenshots, captioned.
6. **Honesty block.** Two sentences, visually quiet but present: this is a
   beta heading into on-the-water testing with working boats; and it is a
   personal log, **not** a substitute for official catch reporting (mirrors
   the README's disclaimer — for a skeptical audience, volunteering the
   limitation is itself a trust signal).
7. **Footer.** GitHub repo, User Guide, Architecture doc, MIT license,
   PurplePincher org link.

**Design constraints (hard requirements for whoever builds it):** dark navy
matching the app (`#0a1628` background, matching `theme-color`), system font
stack, large type and high contrast (same sunlight/older-eyes rationale as
the app's own viewport comment), mobile-first single column, one HTML file
with inline CSS, **zero external requests** (matches the app's CSP posture
and keeps GitHub Pages simple), no JS except a five-line hash-redirect shim
(see §2).

## 2. Technical architecture (decision + reasoning)

**Decision: static landing page becomes the root `index.html` of the deploy;
the app moves to `/deckboss/app/`.** Vite multi-page build: `index.html`
(landing, plain HTML) + `app/index.html` (current SPA entry) as rollup
inputs; PWA manifest `start_url`/`scope` updated to `./app/`.

Why this beats the alternatives:

- **The in-SPA first-visit gate (localStorage flag) is rejected** because it
  puts marketing content inside the app bundle whose time-to-tappable-record-
  button was just painstakingly optimized (195KB→94.5KB, TBT work in
  vite.config.ts is explicitly about the first second); because a cleared-
  storage or new-device visit would shove a promo screen in front of a
  working fisherman trying to record; and because copy edits would ride the
  app's deploy/test pipeline forever. Marketing and product have different
  change cadences and different failure tolerances — keep them in different
  files.
- **A separate repo/docs-site is rejected** because the shared, canonical URL
  is `purplepincher.github.io/deckboss/` — that root URL is what's on the
  README badge and what gets passed around, and a landing page anywhere else
  doesn't fix what a cold visitor to *that* URL sees. Same-repo also keeps
  one deploy pipeline and lets the landing link to `./app/` relatively.
- **The usual killer objection to moving the app — breaking installed PWAs
  and bookmarks — doesn't apply *right now and only right now*.** The field
  beta hasn't onboarded anyone; the installed-user population is
  approximately zero. Once 3–5 fishermen have DeckBoss on their home screens
  mid-season, moving the app URL becomes effectively forbidden. This is the
  one cheap moment to claim the root for marketing, and it closes fast —
  which is why this whole plan runs before tester onboarding.

Repeat-user cost is contained: the manifest's `start_url: "./app/"` means an
installed icon launches straight into the app, never the landing page, so
add-to-home-screen UX is untouched for anyone who installs after the move.

**Transition details the implementation must get right** (all in the kimi
brief, item 4 below): old shared deep links like `…/deckboss/#/timeline` now
hit the landing page, so the landing carries an inline shim — `if
(location.hash.startsWith("#/")) location.replace("./app/" + location.hash)`;
the existing service worker (scope `/deckboss/`, `autoUpdate`) will have
precached the old root `index.html`, so the workbox `navigateFallback`
behavior must be checked so the landing URL isn't hijacked back into the app
shell for previously-visited browsers; the manifest keeps scope covering
`./app/`; the landing page gets its own CSP meta (tighter than the app's —
it needs no `connect-src *`, no Google origin); and `BASE_PATH=/deckboss/`
asset rewriting must be verified in the built `dist/` for both pages, not
assumed (including the existing `href="/icons/…"` favicon links, which depend
on Vite's HTML base-rewriting).

## 3. Production-readiness checklist beyond the landing page

Confirmed gaps a cold visitor (or a shared link) hits today:

- [ ] **No `og:`/`twitter:` meta tags at all** — a link shared in iMessage/
      Slack/Twitter renders as a bare URL. Needs `og:title`, `og:description`,
      `og:image` (absolute URL — relative og:image doesn't work), `og:url`,
      `og:type`, `twitter:card=summary_large_image`, on both landing and app
      pages.
- [ ] **No social-preview image exists.** Needs a 1200×630 card. Built as an
      HTML template screenshotted at exact size (real wordmark + real app
      screenshot), not AI art — see items 3–4.
- [ ] **No product screenshot exists anywhere** — the GitHub README, the #1
      referrer for developer-audience visitors, is all text. Add one
      screenshot to the README once captured.
- [ ] **Meta + manifest description is the internal tagline** ("Your boat's
      memory. Your data. Your shell.") — meaningless as a search snippet or
      link preview. Replace with a plain-language sentence (mmx drafts).
- [ ] **Favicon is a raw 192px PNG via absolute path**; no `favicon.ico`/SVG,
      and the absolute `/icons/…` hrefs must be verified to survive
      `BASE_PATH` rewriting in the built output.
- [ ] **No `404.html`** — GitHub Pages shows its default for any bad path.
      A tiny one that forwards to the landing (preserving `#/` hashes to
      `./app/`) is cheap.
- [ ] **No `robots.txt`** — trivial, add alongside 404.
- [ ] **README top links** must be updated for the new URL shape ("Live app"
      badge → landing; add explicit "open the app" link → `/app/`), and the
      Google OAuth *origin* is unchanged by the path move (origins are
      scheme+host+port only) — no console reconfiguration needed; verify
      rather than assume.
- [ ] **One new human action item**: if any lined-up tester was already sent
      the old URL or installed early, they get the new `/app/` link and a
      re-install at the hands-on setup session (which ROADMAP already
      mandates). Otherwise onboard testers only after this plan ships.

Explicitly *not* in scope, already owned elsewhere: field-beta gating, device
census, audio rehydration, manifest-scan fallback — those are ROADMAP items
with their own sequencing; nothing here re-litigates them.

## 4. Ordered work items (dispatchable briefs)

Items 1 and 2 run in parallel; 3 depends on both; 4 depends on 3; 5–6 after
4 lands; 7 is the gate.

### 1. Landing-page copy — **mmx/MiniMax** (text only, no code)
Brief: *Draft the complete text content for a one-page landing site for
DeckBoss (attach README.md as source material — every claim must be traceable
to it; invent nothing, no testimonials, no statistics, no feature that isn't
listed as shipped). Audience: commercial fishermen — plain declarative
sentences, no marketing adjectives, reads well on a phone. Deliver, in
markdown: a headline (≤9 words) + subhead (≤20 words) built on "voice
instead of typing" and "works with zero signal, no account, free"; a 3-step
"how it works" (tap / talk / done — timestamp+GPS automatic, saves even
offline); three "built for a working deck" blocks (offline-by-design,
tap-only for gloves/wet hands, nothing ever deleted — only corrected); a
"your data, not ours" section (no account, no company server, syncs to YOUR
Google Drive/R2/Oracle or a plain .zip, open source MIT); a two-sentence
honesty block (beta heading into on-the-water testing; personal log, not
official catch reporting); CTA button text; plus a ≤155-char meta/manifest
description in plain language and a ≤60-char og:title and ≤200-char
og:description. Optionally check 2–3 comparable small-team field-tool
landing pages (e.g. onX, Deckhand, FishOn-type apps) for tone calibration
only — do not copy structure or claims.*

### 2. App screenshots — **kimi**
Brief: *In the deckboss repo, produce three real screenshots of the running
app at 390×844 (iPhone-ish portrait, 2x scale): the Record screen, the
Timeline populated with 6–8 plausible demo entries (salmon/halibut/crab,
realistic PNW coordinates and dates, one entry marked retracted), and one
entry-detail view. Use Playwright against `npm run dev`; seed demo entries
through the app's real IndexedDB store (a setup script calling the same
store/build paths tests use — do not hand-forge DB rows that bypass
`putEntry`). Verify each PNG visually (open it, confirm it's not a blank or
error state) before declaring done. Commit under `landing-assets/` (git-
tracked, source of truth) — the landing build will copy what it needs into
`public/`. These are marketing/README assets; do not modify any app code.*

### 3. Build the landing page file + social-card template — **aider (deepseek)**
Purely additive, fully specified, two new files — aider's lane. Brief hands
it the finished copy from item 1 verbatim and the screenshot filenames from
item 2. Brief: *Create exactly two new files, changing nothing else.
(a) `landing/index.html`: a complete, self-contained one-page site using the
attached copy verbatim, structured hero → how-it-works → built-for-a-deck →
your-data → screenshots → honesty block → footer (footer links: GitHub repo,
docs/USER_GUIDE.md on GitHub, ARCHITECTURE.md on GitHub, MIT license,
github.com/purplepincher). Inline CSS only, zero external requests, system
font stack, background #0a1628, high-contrast light text, min 18px body
size, mobile-first single column with a ~720px max-width desktop layout;
`<img>` tags reference `./assets/<screenshot names>` with real alt text and
explicit width/height; primary CTA is an `<a>` styled as a large button,
href="./app/". Include this exact inline script in `<head>`:
`<script>if(location.hash.startsWith("#/"))location.replace("./app/"+location.hash)</script>`.
(b) `landing/card.html`: a 1200×630 fixed-size social card — wordmark
"DeckBoss", the headline, one phone screenshot right-aligned, same palette.
Do not touch vite.config.ts, index.html, src/, or the manifest.*

### 4. Root/app restructure and wire-in — **kimi** (the risky piece; correctness-critical)
Brief: *In the deckboss repo: convert the Vite build to two pages so the
static landing page is served at the site root and the existing SPA moves to
`/app/`. Concretely: move the current `index.html` to `app/index.html`
(updating its `/src/main.tsx` script path), promote `landing/index.html` to
root `index.html` with screenshots copied into `public/assets/`, configure
`build.rollupOptions.input` for both pages, set the PWA manifest
`start_url` and `scope` to `./app/`, and check vite-plugin-pwa's workbox
`navigateFallback` so (a) app-shell fallback never serves for the landing
URL and (b) previously-visited browsers with the old precached root aren't
stuck on the stale app shell after the autoUpdate SW activates. Give the
landing page its own CSP meta (`default-src 'self'; img-src 'self' data:;
style-src 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none';
base-uri 'self'` — it needs neither `connect-src *` nor the Google origin).
Screenshot `landing/card.html` at exactly 1200×630 into
`public/og-card.png`. Update README's live-app badge/links for the new
structure. Verification is the deliverable: `npm run typecheck && npm run
test && BASE_PATH=/deckboss/ npm run build` must pass, then `vite preview`
and confirm with a real browser fetch that `/deckboss/` serves the landing,
`/deckboss/app/` serves the working app (record button renders), all asset
URLs including the `/icons/` favicons resolve under the base path (no 404s
in the network log), and `/deckboss/#/timeline` redirects to the app. Do
not change any behavior inside `src/` beyond what the entry move requires.*

### 5. Mechanical extras — **aider (deepseek)**
Brief: *In the deckboss repo, add exactly three small static files:
`public/404.html` (self-contained, matching the site's dark #0a1628 style,
"Page not found" + a link to the site root, plus an inline script that
forwards a URL containing `#/` to `/deckboss/app/` preserving the hash);
`public/robots.txt` (allow all); and a one-line README edit embedding the
Timeline screenshot near the top with alt text. Touch nothing else.*

### 6. Audit pass — **opencode/GLM** (thorough audit is its strength)
Brief: *Audit the deckboss deploy output for first-visit production
readiness, and fix what you find in-place. Scope: (1) og:/twitter: meta on
BOTH `index.html` (landing) and `app/index.html` — og:image must be the
absolute URL `https://purplepincher.github.io/deckboss/og-card.png`, og:url
correct per page, `twitter:card=summary_large_image`; verify the card file
exists in `dist/` at that path. (2) Replace the meta + PWA-manifest
descriptions with the plain-language description provided (from item 1's
copy). (3) Lighthouse (mobile, throttled) on both the landing and the app —
the landing should score ≥95 performance/accessibility/SEO/best-practices;
fix contrast, alt text, tap-target, and heading-order findings; for the app
page, flag any regression vs the documented 94.5KB-gzip baseline but do not
refactor app code. (4) CSP review of both pages — confirm the landing's
tight policy holds and the app's documented policy (see the long comment in
its index.html — its reasoning is deliberate, do not "fix" `connect-src *`)
is unchanged. (5) Crawl every href on the landing page, the README, and
docs/USER_GUIDE.md for 404s, including the new `/app/` links. Run the full
build after your changes and confirm green.*

### 7. Independent final verification — orchestrator (not delegated)
Per standing convention, no tool's self-report is trusted: after 4–6 merge
and deploy, verify against the **live** site — landing renders at the root
URL on a phone-width viewport, CTA opens the working app, a fresh
add-to-home-screen install launches into `/app/` directly, a shared link
unfurls with the card image (Slack/iMessage or an OG-preview checker), and
the old `#/timeline`-style deep link lands in the app. Only then does tester
onboarding (ROADMAP human items) get the URL.
