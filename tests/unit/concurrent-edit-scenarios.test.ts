import { describe, it, expect } from "vitest";
import { mergeEntries } from "../../src/core/sync/conflict-resolver";
import { applyCorrections } from "../../src/core/tensor-log/entry-builder";
import {
  newEntrySkeleton,
  type LogEntry,
  type Correction,
} from "../../src/core/types/log-entry";

/** Helper that attaches a corrections array to a skeleton entry. */
function entryWithCorrections(
  base: LogEntry,
  corrections: Correction[],
): LogEntry {
  return { ...base, corrections };
}

/* ------------------------------------------------------------------ */
/*  Deterministic merge                                               */
/* ------------------------------------------------------------------ */
describe("mergeEntries – deterministic ordering", () => {
  const skeleton = newEntrySkeleton({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    timestamp: "2025-01-01T00:00:00.000Z",
    gps: null,
    audio: null,
    source: "voice",
  });

  // Two corrections with the same created_at but different ids.
  // id a < b lexicographically – used to verify deterministic tiebreak.
  const correctionA: Correction = {
    id: "corr-A",
    created_at: "2025-03-10T00:00:00.000Z",
    type: "amend",
    fields: { tags: ["a"] },
  };

  const correctionB: Correction = {
    id: "corr-B",
    created_at: "2025-03-10T00:00:00.000Z", // same second
    type: "amend",
    fields: { entities: [{ type: "gear", value: "reg", confidence: 0.8 }] },
  };

  it("identical correction sets produce identical result regardless of argument order", () => {
    const baseA = entryWithCorrections(skeleton, [correctionA, correctionB]);
    const baseB = entryWithCorrections(skeleton, [correctionA, correctionB]);

    const mergedAB = mergeEntries(baseA, baseB);
    const mergedBA = mergeEntries(baseB, baseA);

    // Deep equality of entire entry (core fields identical anyway).
    expect(mergedAB).toStrictEqual(mergedBA);
  });

  it("even when incoming orders differ, merged order is deterministic", () => {
    // local [A, B], remote [B, A]
    const local = entryWithCorrections(skeleton, [correctionA, correctionB]);
    const remote = entryWithCorrections(skeleton, [correctionB, correctionA]);

    const forward = mergeEntries(local, remote);
    const backward = mergeEntries(remote, local);

    expect(forward).toStrictEqual(backward);
    // Tiebreak by id: A < B => A then B
    const ids = forward.corrections.map((c) => c.id);
    expect(ids).toEqual(["corr-A", "corr-B"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Retraction + amends – field-update behaviour                     */
/* ------------------------------------------------------------------ */
describe("retraction does not freeze fields", () => {
  const skeleton = newEntrySkeleton({
    id: "rrrr-ssss-tttt-uuuu-vvvvvvvvvvvv",
    timestamp: "2025-02-20T12:00:00.000Z",
    gps: null,
    audio: null,
    source: "voice",
  });

  it("retract earlier, amend later → retracted=true AND amend fields are applied", () => {
    const retract: Correction = {
      id: "ret-1",
      created_at: "2025-04-01T00:00:00.000Z",
      type: "retract",
      reason: "privacy",
    };
    const amend: Correction = {
      id: "amend-later",
      created_at: "2025-04-02T00:00:00.000Z",
      type: "amend",
      fields: {
        transcript: {
          text: "corrected text",
          confidence: 1.0,
          language: "en",
          engine: "whisper-1",
        },
      },
    };

    const entry = entryWithCorrections(skeleton, [retract, amend]);
    const eff = applyCorrections(entry);

    expect(eff.retracted).toBe(true);
    expect(eff.amended).toBe(true);
    expect(eff.transcript?.text).toBe("corrected text");
    expect(eff.lastCorrectionReason).toBe("privacy");
  });

  it("amend earlier, retract later → fields from amend are preserved, retracted=true", () => {
    const amendFirst: Correction = {
      id: "amend-first",
      created_at: "2025-04-01T00:00:00.000Z",
      type: "amend",
      fields: {
        tags: ["early"],
      },
    };
    const retractLater: Correction = {
      id: "ret-later",
      created_at: "2025-04-02T00:00:00.000Z",
      type: "retract",
      reason: "irrelevant",
    };

    const entry = entryWithCorrections(skeleton, [amendFirst, retractLater]);
    const eff = applyCorrections(entry);

    expect(eff.retracted).toBe(true);
    expect(eff.amended).toBe(true);
    expect(eff.tags).toEqual(["early"]);
    expect(eff.lastCorrectionReason).toBe("irrelevant");
  });

  it("multiple amends interleaved with retract → final fields come from last amend, retracted=true", () => {
    const amend1: Correction = {
      id: "a1",
      created_at: "2025-05-01T00:00:00.000Z",
      type: "amend",
      fields: { tags: ["a"] },
    };
    const retract: Correction = {
      id: "r1",
      created_at: "2025-05-02T00:00:00.000Z",
      type: "retract",
      reason: "wrong",
    };
    const amend2: Correction = {
      id: "a2",
      created_at: "2025-05-03T00:00:00.000Z",
      type: "amend",
      fields: { tags: ["b"] },
    };

    const entry = entryWithCorrections(skeleton, [amend1, retract, amend2]);
    const eff = applyCorrections(entry);

    expect(eff.retracted).toBe(true);
    expect(eff.amended).toBe(true);
    expect(eff.tags).toEqual(["b"]);
    expect(eff.lastCorrectionReason).toBe("wrong"); // last reason comes from the retract
  });
});
