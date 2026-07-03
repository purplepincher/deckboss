import { describe, it, expect } from "vitest";
import { useDeckBossStore } from "../../src/state/store";
import { putEntry, getEntry } from "../../src/core/storage/local-db";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import { pendingJobCount } from "../../src/core/sync/queue";

function baseEntry(id = crypto.randomUUID()) {
  return newEntrySkeleton({
    id,
    timestamp: new Date().toISOString(),
    gps: null,
    audio: null,
    source: "voice",
  });
}

// Covers the store-level write path added to close the seam flagged in
// docs/ROUNDTABLE_SYNTHESIS.md: amendEntry/retractEntry are now the only
// way a screen appends a Correction, and the raw LogEntry read/mutate/
// persist/enqueue dance happens entirely inside the store.
describe("store.amendEntry", () => {
  it("appends an amend correction, persists it, and updates the effective view", async () => {
    const entry = baseEntry();
    await putEntry(entry);

    await useDeckBossStore.getState().amendEntry(entry.id, { tags: ["fixed"] }, "typo fix");

    const raw = await getEntry(entry.id);
    expect(raw?.corrections).toHaveLength(1);
    expect(raw?.corrections[0]?.type).toBe("amend");
    expect(raw?.corrections[0]?.reason).toBe("typo fix");

    const effective = useDeckBossStore.getState().entries.find((e) => e.id === entry.id);
    expect(effective?.tags).toEqual(["fixed"]);
    expect(effective?.amended).toBe(true);
  });

  it("never rewrites the raw entry's base fields — only appends to corrections", async () => {
    const entry = baseEntry();
    entry.tags = ["original"];
    await putEntry(entry);

    await useDeckBossStore.getState().amendEntry(entry.id, { tags: ["changed"] });

    const raw = await getEntry(entry.id);
    expect(raw?.tags).toEqual(["original"]); // base record untouched, per the additive invariant
    expect(raw?.corrections).toHaveLength(1);
  });

  it("accumulates repeated amends as separate corrections, later fields winning in the effective view", async () => {
    const entry = baseEntry();
    await putEntry(entry);

    await useDeckBossStore.getState().amendEntry(entry.id, { tags: ["first"] });
    await useDeckBossStore.getState().amendEntry(entry.id, { tags: ["second"] });

    const raw = await getEntry(entry.id);
    expect(raw?.corrections).toHaveLength(2);

    const effective = useDeckBossStore.getState().entries.find((e) => e.id === entry.id);
    expect(effective?.tags).toEqual(["second"]);
  });

  it("enqueues a sync job for the amended entry", async () => {
    const entry = baseEntry();
    await putEntry(entry);
    const before = await pendingJobCount();

    await useDeckBossStore.getState().amendEntry(entry.id, { tags: ["x"] });

    expect(await pendingJobCount()).toBe(before + 1);
  });

  it("is a no-op (no throw, nothing persisted) for an id with no local entry", async () => {
    const missingId = crypto.randomUUID();
    await expect(useDeckBossStore.getState().amendEntry(missingId, { tags: ["x"] })).resolves.toBeUndefined();
    expect(await getEntry(missingId)).toBeUndefined();
  });
});

describe("store.retractEntry", () => {
  it("appends a retract correction and marks the effective view retracted", async () => {
    const entry = baseEntry();
    await putEntry(entry);

    await useDeckBossStore.getState().retractEntry(entry.id, "wrong vessel");

    const raw = await getEntry(entry.id);
    expect(raw?.corrections).toHaveLength(1);
    expect(raw?.corrections[0]?.type).toBe("retract");
    expect(raw?.corrections[0]?.reason).toBe("wrong vessel");

    const effective = useDeckBossStore.getState().entries.find((e) => e.id === entry.id);
    expect(effective?.retracted).toBe(true);
    expect(effective?.lastCorrectionReason).toBe("wrong vessel");
  });

  it("keeps prior amendments folded into the effective view once retracted", async () => {
    const entry = baseEntry();
    await putEntry(entry);

    await useDeckBossStore.getState().amendEntry(entry.id, { tags: ["kept"] });
    await useDeckBossStore.getState().retractEntry(entry.id, "bad entry");

    const raw = await getEntry(entry.id);
    expect(raw?.corrections).toHaveLength(2);

    const effective = useDeckBossStore.getState().entries.find((e) => e.id === entry.id);
    expect(effective?.retracted).toBe(true);
    expect(effective?.tags).toEqual(["kept"]);
  });

  it("enqueues a sync job for the retracted entry", async () => {
    const entry = baseEntry();
    await putEntry(entry);
    const before = await pendingJobCount();

    await useDeckBossStore.getState().retractEntry(entry.id);

    expect(await pendingJobCount()).toBe(before + 1);
  });

  it("is a no-op (no throw, nothing persisted) for an id with no local entry", async () => {
    const missingId = crypto.randomUUID();
    await expect(useDeckBossStore.getState().retractEntry(missingId)).resolves.toBeUndefined();
    expect(await getEntry(missingId)).toBeUndefined();
  });
});
