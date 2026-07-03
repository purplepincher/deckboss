# Roadmap

This is the living decision record. `FABLE_BRIEFING.md` is a point-in-time
snapshot of the reasoning that led here (four-agent brainstorm, then an
independent strategic review) — read it for the *why*. This file is the
*what's actually decided*, and gets updated as decisions change; the
briefing does not.

## Decided

**Regulatory/compliance stance: explicitly disclaimed.** DeckBoss is a
personal log, not a substitute for official catch reporting — stated in
the README and in-app (Settings → About). The additive-corrections design
is kept and justified purely on sync-safety grounds (see `ARCHITECTURE.md`
and `log-entry.ts`'s doc comment), not on a compliance ambition nobody
has actually chosen to pursue. This is fully reversible: if a real
compliance use case shows up later with an actual regulator or insurer
attached, that's a new decision made on purpose, with its own legal review
— not something that arrives by default because the schema happened to
support it.

**Fleet learning: off the roadmap.** Not "decide the boundary later" —
removed as a planned phase. It cannot be built without a DeckBoss-operated
backend somewhere, which breaks the core local-first promise the shipped
product already depends on for trust. A dead future phase was already
distorting present decisions (see the compliance-stance drift above). If
fleet-shaped value is ever wanted, the only acceptable shape is a
separate, clearly-labeled tool that reads exports users chose to push to
their own storage — never anything DeckBoss itself operates — and that's
a decision to make explicitly when someone actually wants it, not a line
item to plan around now.

**Multi-trade / "substrate" ambition: not now.** Stay fishing-specific for
at least the next 6 months. There are effectively zero real fishermen
using this yet; substrate plays get earned by dominating one vertical, not
chosen in advance of any user validation. Revisit only after real field
usage exists.

**Extension architecture: split into three, only two of three approved.**
- ✅ **Now**: the write-path invariant validator (`invariants.ts`) and a
  CODEOWNERS lock on the audit-log core. Shipped this pass.
- ✅ **Opportunistic**: split fishing vocabulary out of
  `entity-extractor.ts` into a `domain-packs/fishing/` directory when
  someone's touching that code anyway. Not urgent, cheap when it happens.
- ❌ **Deferred**: the full `ext.<namespace>.*` schema extension framework
  for future sensor/ML/etc fields. This was the brainstorm's top
  architecture recommendation; the strategic review pushed back
  correctly — it's speculative generality for Phase 3 features that may
  never ship, and namespaced-extensible-schema is close to base-rate
  advice for "how do I make a schema extensible," not domain-specific
  insight. Additive changes to a YAML frontmatter format are cheap. Add
  the namespace when the first real extension actually shows up.

## The actual top priority, which wasn't on anyone's list

Every data point behind every decision above — the beta testing, the
four-agent brainstorm, this roadmap — came from AI agents, not a working
fisherman. That's the real gap. Before any Phase 2 feature work: **get the
app in front of 3-5 real commercial fishermen and watch them use it**,
specifically to find out whether Web Speech API produces usable
transcripts on a moving deck (diesel engine, wind, gloves, regional
accent, a phone in a waterproof case). If that fails, nothing else on this
roadmap matters. This is not something an agent can do — it's the one
action item that's actually on the humans running this project, not on
whoever's writing code next.

## Next 2-4 weeks

**Week 1 (this pass):**
- [x] Write-path invariant validator (`invariants.ts`) enforcing
      corrections-are-append-only on every write, regardless of code path
- [x] Boot-time IndexedDB store-integrity self-check with a loud failure
      state instead of the silent breakage that shipped once already
- [x] CODEOWNERS lock on the audit-log core
- [x] Non-compliance disclaimer, README + in-app
- [x] Re-justify additive corrections on sync-safety merits, not a
      compliance goal nobody decided to pursue
- [ ] **Human action item, not code**: start recruiting field testers.
      Docks, fishing forums, PNW commercial-fishing Facebook groups — this
      has the longest lead time of anything on this list, which is why it
      starts now, in parallel with everything else.

**Week 2:**
- Ask-Your-Log: a local keyword/date/species query layer over existing
  entries, no LLM, no API key. `query-engine.ts` already does the
  filtering — this is mostly UI. Also the best source of real signal for
  whether Phase 2's Context Packets are worth building at all.
- Domain-pack vocabulary split, opportunistically, while touching the
  extractor for Ask-Your-Log anyway.

**Weeks 3-4:**
- Spot Memory: surface past entries automatically on GPS re-entry to a
  location. The standout product idea from the brainstorm — but its real
  parameters (geofence radius, when to surface it, how not to be annoying
  mid-haul) need actual field testers to tune, which is why it's
  sequenced after outreach starts, not before.
- Continue black-box agent QA on every deploy (this already caught a real
  release blocker once — keep doing it), plus a field-conditions pass:
  throttled CPU, mid-recording offline flips, denied GPS permission,
  storage-quota pressure.

**Explicitly not doing in this window**: the `ext.*` framework, anything
LLM (Context Packets included), new storage adapters, Bluetooth mesh,
sensors/NMEA, anything with "fleet" in the name. The Bluetooth mesh
"hot bite" share idea is genuinely novel and on-brand — parked, not
killed, but it's a quarter-scale bet, not a week-scale one.

## Known landmine

Google Drive OAuth in Testing mode caps at 100 users before Google
requires app verification. Fine for a small field beta; worth knowing
about before recruiting gets close to that number.
