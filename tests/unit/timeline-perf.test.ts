import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStore, clear, setMany, set } from "idb-keyval";
import { allEntries } from "../../src/core/storage/local-db";
import { applyCorrections } from "../../src/core/tensor-log/entry-builder";
import { LogEntrySchema, newEntrySkeleton } from "../../src/core/types/log-entry";

const entryStore = createStore("deckboss-entries", "entries");

function makeEntry(id: string) {
  return newEntrySkeleton({
    id,
    timestamp: new Date().toISOString(),
    gps: null,
    audio: null,
    source: "voice",
  });
}

async function seed(count: number): Promise<void> {
  const pairs: [string, ReturnType<typeof makeEntry>][] = [];
  for (let i = 0; i < count; i++) {
    const entry = makeEntry(crypto.randomUUID());
    pairs.push([entry.id, entry]);
  }
  await setMany(pairs, entryStore);
}

describe("Timeline load performance", () => {
  beforeEach(async () => {
    // Start each run with an empty entries store so counts are deterministic.
    await clear(entryStore);
  });

  it("loads and corrects 1000 entries within a reasonable budget", async () => {
    const count = 1000;
    await seed(count);

    const t0 = performance.now();
    const raw = await allEntries();
    const effective = raw.map(applyCorrections);
    const t1 = performance.now();

    const elapsed = t1 - t0;
    console.log(`Timeline load (${count} entries): ${elapsed.toFixed(1)}ms`);
    expect(effective).toHaveLength(count);
    // Budget is intentionally loose for CI; the pre-fix path (per-key IDB
    // reads + Zod parse of every record + corrections fold) was observed at
    // 1.5-3s in the beta at ~800 entries. 500ms is a 3x improvement bar at
    // 1000 entries.
    expect(elapsed).toBeLessThan(500);
  });

  it("does not run full Zod validation on current-version entries", async () => {
    await seed(50);
    const spy = vi.spyOn(LogEntrySchema, "safeParse");

    const result = await allEntries();
    expect(result).toHaveLength(50);
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it("still falls back to Zod validation for records that look wrong", async () => {
    await seed(10);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A record with the current schema version but a broken shape should
    // still be caught by the fallback safeParse rather than trusted blindly.
    await set(
      "corrupt-record",
      { version: "1.0", id: "not-a-uuid", timestamp: "not-a-date" },
      entryStore,
    );

    const result = await allEntries();
    expect(result).toHaveLength(10);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
