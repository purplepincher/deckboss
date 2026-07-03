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
});

describe("verifyStoreIntegrity", () => {
  it("reports ok when all stores are reachable", async () => {
    const result = await verifyStoreIntegrity();
    expect(result.ok).toBe(true);
    expect(result.failedStores).toEqual([]);
  });
});
