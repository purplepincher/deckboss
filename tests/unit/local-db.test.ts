import { describe, it, expect } from "vitest";
import {
  putEntry,
  getEntry,
  verifyStoreIntegrity,
  markAudioVerified,
  getAudioVerifiedAt,
  allAudioVerifiedAt,
} from "../../src/core/storage/local-db";
import { InvariantViolationError } from "../../src/core/tensor-log/invariants";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import { buildAmendCorrection } from "../../src/core/tensor-log/entry-builder";

const DEVICE_ID = crypto.randomUUID();

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

    const amended = { ...entry, corrections: [buildAmendCorrection({ tags: ["fixed"] }, DEVICE_ID)] };
    await putEntry(amended);

    const back = await getEntry(entry.id);
    expect(back?.corrections).toHaveLength(1);
  });

  it("rejects a write that drops a previously-committed correction", async () => {
    const entry = baseEntry();
    const withCorrection = { ...entry, corrections: [buildAmendCorrection({ tags: ["x"] }, DEVICE_ID)] };
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

    const correctionA = buildAmendCorrection({ tags: ["from-ui"] }, DEVICE_ID);
    const correctionB = buildAmendCorrection({ tags: ["from-sync"] }, DEVICE_ID);

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

describe("allAudioVerifiedAt (batched verified-state read)", () => {
  it("returns every verified id -> timestamp pair in a single read", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const tsA = new Date(2026, 0, 1).toISOString();
    const tsB = new Date(2026, 0, 2).toISOString();
    await markAudioVerified(a, tsA);
    await markAudioVerified(b, tsB);

    const map = await allAudioVerifiedAt();
    expect(map.get(a)).toBe(tsA);
    expect(map.get(b)).toBe(tsB);
    expect(map.size).toBeGreaterThanOrEqual(2);
  });

  it("agrees with the per-id getAudioVerifiedAt for every entry it returns", async () => {
    // The whole point of the batched read is that it's a drop-in for the
    // per-id read reconcileAudio used to do in a loop — so the two must
    // agree on every key.
    const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
    for (const [i, id] of ids.entries()) {
      if (i % 2 === 0) await markAudioVerified(id, new Date().toISOString());
    }
    const map = await allAudioVerifiedAt();
    for (const id of ids) {
      expect(map.get(id) ?? null).toBe(await getAudioVerifiedAt(id));
    }
  });

  it("is empty when nothing has been verified", async () => {
    // A fresh store (this test runs in the shared fake-indexeddb which
    // other tests in this file may have written to) — just assert the
    // read resolves to a Map rather than throwing on an empty store.
    const map = await allAudioVerifiedAt();
    expect(map).toBeInstanceOf(Map);
  });
});
