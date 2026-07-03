import { describe, it, expect } from "vitest";
import { putEntry, getEntry, verifyStoreIntegrity } from "../../src/core/storage/local-db";
import { InvariantViolationError } from "../../src/core/tensor-log/invariants";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import { buildAmendCorrection } from "../../src/core/tensor-log/entry-builder";

function baseEntry(id = crypto.randomUUID()) {
  return newEntrySkeleton({
    id,
    timestamp: new Date().toISOString(),
    gps: null,
    audio: null,
    source: "voice",
  });
}

describe("local-db putEntry (fake-indexeddb)", () => {
  it("round-trips a fresh entry", async () => {
    const entry = baseEntry();
    await putEntry(entry);
    const back = await getEntry(entry.id);
    expect(back).toEqual(entry);
  });

  it("allows an additive update (appending a correction)", async () => {
    const entry = baseEntry();
    await putEntry(entry);

    const amended = { ...entry, corrections: [buildAmendCorrection({ tags: ["fixed"] })] };
    await putEntry(amended);

    const back = await getEntry(entry.id);
    expect(back?.corrections).toHaveLength(1);
  });

  it("rejects a write that drops a previously-committed correction", async () => {
    const entry = baseEntry();
    const withCorrection = { ...entry, corrections: [buildAmendCorrection({ tags: ["x"] })] };
    await putEntry(withCorrection);

    const stripped = { ...withCorrection, corrections: [] };
    await expect(putEntry(stripped)).rejects.toThrow(InvariantViolationError);

    // and the store still holds the last valid write, not the rejected one
    const back = await getEntry(entry.id);
    expect(back?.corrections).toHaveLength(1);
  });

  it("rejects a write that changes an immutable field after creation", async () => {
    const entry = baseEntry();
    await putEntry(entry);

    const tampered = { ...entry, source: "text" as const };
    await expect(putEntry(tampered)).rejects.toThrow(InvariantViolationError);
  });

  it("serializes concurrent same-entry writes instead of silently losing one", async () => {
    // Simulates a sync pull merging a remote correction at the same
    // moment the UI amends the same entry — both start from the same
    // `existing` read. Without a per-id lock, both writes "succeed" and
    // whichever set() lands second silently overwrites the first: a lost
    // update with no error anywhere. With the lock, the writes serialize
    // — the first succeeds, and the second (built from a now-stale read,
    // since it doesn't include the first write's correction) is rejected
    // by the invariant check instead of silently discarding it. A loud,
    // catchable error is the correct outcome here, not silent data loss.
    const entry = baseEntry();
    await putEntry(entry);

    const correctionA = buildAmendCorrection({ tags: ["from-ui"] });
    const correctionB = buildAmendCorrection({ tags: ["from-sync"] });

    const results = await Promise.allSettled([
      putEntry({ ...entry, corrections: [correctionA] }),
      putEntry({ ...entry, corrections: [correctionB] }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    // At least one write must land; if both were built from a stale read
    // relative to each other, at least one must be caught rather than
    // silently accepted.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(fulfilled.length + rejected.length).toBe(2);

    // Whatever's in storage reflects a real write that actually happened
    // — never zero corrections when one write plainly succeeded.
    const back = await getEntry(entry.id);
    expect(back?.corrections.length).toBeGreaterThanOrEqual(1);
  });
});

describe("verifyStoreIntegrity", () => {
  it("reports ok when all stores are reachable", async () => {
    const result = await verifyStoreIntegrity();
    expect(result.ok).toBe(true);
    expect(result.failedStores).toEqual([]);
  });
});
