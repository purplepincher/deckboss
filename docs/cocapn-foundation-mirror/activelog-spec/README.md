# activelog-spec

The substrate. An open format for append-only, timestamped event logs produced by
people narrating their work and devices observing it. Everything in the Cocapn
ecosystem reads and writes this; nothing else in the ecosystem is load-bearing.

## The envelope

Every event, no matter the type:

```json
{
  "alv": 1,
  "dev": "phone-a1b2c3",
  "seq": 4021,
  "ts": 1782000123456,
  "mono": 74520331,
  "type": "speech.segment",
  "fix": { "lat": 55.3421, "lon": -131.6461, "sog": 2.4, "cog": 291 },
  "body": { }
}
```

- `alv` — spec version. Present on every event so streams are self-describing.
- `dev` — device id (stable per install). `(dev, seq)` is the global unique key.
- `seq` — per-device monotonic counter. Never reused, never rewound.
- `ts` — UTC epoch ms, best known wall time (GPS-disciplined when available).
- `mono` — device monotonic clock ms. Survives wall-clock corrections; lets us
  order and measure intervals even when `ts` was wrong at capture.
- `fix` — optional GPS snapshot at capture.
- `body` — type-specific payload.

**Merge rule:** a log set is merged by set-union on `(dev, seq)`, sorted by
`(ts, dev, seq)`. Append-only + unique keys = conflict-free by construction.
No CRDTs, no vector clocks, no server authority.

**Corrections:** history is immutable. `correction.retract` and
`correction.amend` events reference `{dev, seq}` of the target. Consumers apply
corrections at read time. This preserves training-data provenance.

## Core event types (v1)

| type | body highlights |
|---|---|
| `speech.segment` | `text`, `dur_ms`, `mode` (dictation/command), `conf`, optional `audio` media ref, `speaker` hint |
| `helm.command` | `profile`, `action` ("port_10"), `class` (C0–C3), `result`, `confirmed_by` |
| `helm.event` | override, link loss, watchdog trip, token transfer |
| `fix.track` | periodic position (the breadcrumb trail between events) |
| `media.frame` / `media.clip` | `sha256`, `uri`, `source` (deck-cam-1), `w`,`h`,`dur_ms` |
| `catch.assertion` | structured claim parsed from narration: `species`, `container`, `count?`, `raw` (the sentence), `parse_conf` |
| `chat.exchange` | `role`, `text`, `model`, `key_owner: "byok"` |
| `mark.note` | explicit captain marks ("mark: hang here, 40 fathoms") |
| `session.meta` | day/session boundaries, vessel, crew names (locally stored only) |

Types are namespaced (`domain.noun`); unknown types must be preserved by all
tools (forward compatibility).

## Media anchoring

Media is linked to meaning **by time, not by reference**. A `media.frame` from a
deck camera and a `speech.segment` "lingcod going in the port tote" are related
because their `ts` windows overlap. Rules:

- Every media event carries capture `ts`+`mono` from its own device.
- Camera devices emit periodic `clock.beacon` events so cross-device time skew is
  measurable and correctable at merge time.
- A **label export** is a derived artifact: `(media, overlapping speech, parsed
  assertions, fix)` bundles — the supervised-learning byproduct. Exporters live
  downstream; the spec only guarantees the timestamps are trustworthy.

## Files and streams

- One JSONL file per device per UTC day: `{dev}/{yyyy-mm-dd}.alog.jsonl`
- Media in content-addressed blobs: `blobs/{sha256[0:2]}/{sha256}`
- A day directory is portable by definition: copy it anywhere, merge by union.
- Optional integrity: each event may carry `prev` (hash of the device's previous
  event) forming a per-device hash chain — tamper-evidence for logs used as
  legal/regulatory records.

## What's deliberately NOT in the spec

- No user accounts, no server semantics, no permissions model (that's the sync
  layer's problem).
- No schema for fish species, ports, gear (domain vocabularies are versioned
  data packages, like autopilot profiles — not spec).
- No editing. Ever.

## Repo layout (target)

```
activelog-spec/
  SPEC.md                 normative text
  schema/envelope.schema.json
  schema/types/*.schema.json
  examples/troll-day.jsonl
  conformance/            round-trip + merge test vectors
```

See `schema/event.schema.json` and `examples/troll-day.jsonl` here for the
starting points.
