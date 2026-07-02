import { describe, it, expect } from "vitest";
import { mergeEntries, detectCoreFieldConflict } from "../../src/core/sync/conflict-resolver";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import { buildAmendCorrection, buildRetractCorrection } from "../../src/core/tensor-log/entry-builder";

function baseEntry() {
  return newEntrySkeleton({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    gps: null,
    audio: null,
    source: "voice",
  });
}

describe("mergeEntries", () => {
  it("unions two devices' distinct corrections instead of picking a winner", () => {
    const shared = baseEntry();
    const local = { ...shared, corrections: [buildAmendCorrection({ tags: ["from-device-a"] })] };
    const remote = { ...shared, corrections: [buildRetractCorrection("from-device-b")] };

    const merged = mergeEntries(local, remote);
    expect(merged.corrections).toHaveLength(2);
    expect(merged.corrections.map((c) => c.type).sort()).toEqual(["amend", "retract"]);
  });

  it("deduplicates the same correction id seen from both sides", () => {
    const shared = baseEntry();
    const correction = buildAmendCorrection({ tags: ["x"] });
    const local = { ...shared, corrections: [correction] };
    const remote = { ...shared, corrections: [correction] };

    const merged = mergeEntries(local, remote);
    expect(merged.corrections).toHaveLength(1);
  });

  it("sorts merged corrections chronologically", () => {
    const shared = baseEntry();
    const older = { ...buildAmendCorrection({ tags: ["old"] }), created_at: "2026-01-01T00:00:00.000Z" };
    const newer = { ...buildAmendCorrection({ tags: ["new"] }), created_at: "2026-06-01T00:00:00.000Z" };
    const local = { ...shared, corrections: [newer] };
    const remote = { ...shared, corrections: [older] };

    const merged = mergeEntries(local, remote);
    expect(merged.corrections[0]?.created_at).toBe(older.created_at);
  });
});

describe("detectCoreFieldConflict", () => {
  it("returns null when core capture facts match", () => {
    const entry = baseEntry();
    expect(detectCoreFieldConflict(entry, { ...entry })).toBeNull();
  });

  it("flags a mismatched timestamp as a real conflict", () => {
    const a = baseEntry();
    const b = { ...a, timestamp: new Date(Date.now() + 100_000).toISOString() };
    expect(detectCoreFieldConflict(a, b)).toBe("timestamp");
  });
});
