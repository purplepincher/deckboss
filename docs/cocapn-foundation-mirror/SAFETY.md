# SAFETY — voice-commanded steering on a working vessel

This document is written first and published loudest. If the safety story isn't
airtight, nothing else matters: nobody sane wires an internet-adjacent hobby board
into their steering, and they're right not to.

## Threat model

1. Software hang or crash (phone app, firmware) while a command is active
2. Link loss (BLE/WiFi drop) mid-command
3. Misheard command (wind, engine noise, VHF chatter, crew joking)
4. Unauthorized command (another phone, replayed packet, malicious actor)
5. Electrical fault in the Helm unit itself
6. The captain needs the boat NOW (crossing traffic, man overboard, gear in the wheel)

## The five-layer defense

### 1 · Electrical: parallel, momentary, de-energized-safe
- The Helm unit wires **in parallel** with existing helm controls at the remote
  port. Physical controls always work, regardless of Helm unit state.
- Actuation outputs are **momentary contact closures (or their electrical
  equivalent) through normally-open relays/optocouplers**. Unpowered, crashed, or
  unplugged = open circuit = the autopilot sees "nobody touching the remote."
  There is no state in which our failure holds a rudder command.
- No command is ever latched in hardware. "Hold" behaviors are implemented as
  repeated short pulses from live software, so any failure stops the behavior.

### 2 · Firmware: hardware watchdog + command TTL
- Every actuation carries a TTL (default 500 ms). The firmware releases outputs
  when the TTL expires unless a fresh authenticated heartbeat extends it.
- The ESP32's **hardware watchdog** resets the chip if the main loop stalls;
  outputs are open during boot by design (pull-downs, relays default open).
- A physical **override detect** input (wired to the helm's own controls where the
  profile allows) drops all outputs instantly and enters a 10-second lockout when
  the human touches the real controls. Human always outranks radio.

### 3 · Protocol: authenticated, replay-proof, single-master
- All commands are inside an encrypted session (keys established at QR pairing);
  every message carries a monotonic counter — replays are dropped.
- Exactly **one brain holds the helm token**. A second device can listen, not steer.
  Token transfer is explicit and logged.
- Link loss = immediate release to standby (the autopilot keeps doing what *it*
  was doing — we are a remote, not the pilot).

### 4 · Voice: command classes and escalating confirmation

| Class | Examples | Confirmation |
|---|---|---|
| C0 INFO | "what's our heading?" | none |
| C1 TRIM | "port ten", "starboard five", dodge | none — but echo-back spoken ("port ten") and instantly cancellable ("belay that") |
| C2 MODE | "auto", "standby", "tack" course changes > 30° | spoken confirm required: system says "engage auto?" captain says "confirm" |
| C3 PROPULSION / anything irreversible | throttle, gear | disabled by default; enabling requires dockside setup + per-command confirm + physical enable switch on the unit |

- The command grammar is **closed** (a few dozen phrases per profile). Recognition
  below a confidence floor = the system asks, never guesses.
- "**Belay**" / "**cancel**" / touching anything physical kills the active command.
- Wake word required for every command; no open-mic actuation. Dictation mode
  *cannot* actuate — the two pipelines are separate code paths by construction.

### 5 · Human: sea-trial checklist and honest documentation
- The provisioner will not mark an install complete until a guided **sea trial**
  passes: override test, link-kill test, TTL test, wrong-word test — with the
  installer's hands on the wheel.
- Every wiring card carries the same sentence: *"This device is a remote control
  accessory. The vessel's master remains responsible for navigation and watchkeeping
  at all times."* We say plainly what the system is and is not.

## What voice never does (v1 policy)
- No waypoint/route following beyond what the autopilot itself already does.
- No propulsion, no anchor winch, no hydraulics (C3 disabled by default).
- No actuation from dictation mode, chat mode, or any cloud path. Actuation
  originates only from the local command pipeline holding the helm token.

## Logged accountability
Every command, confirmation, override, link event, and watchdog trip is an
ActiveLog event. After any incident, the sequence is replayable to the millisecond.
This protects the captain, the installer, and the project.
