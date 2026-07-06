import "fake-indexeddb/auto";
import { clear, createStore } from "idb-keyval";
import { getDiagnostics, recordEntriesSkipped, recordSyncAttempt } from "../../src/core/diagnostics";

describe("diagnostics", () => {
  beforeEach(async () => {
    const store = createStore("deckboss-diagnostics", "diagnostics");
    await clear(store);
  });

  it("recordEntriesSkipped increments entriesSkipped by the given count", async () => {
    let diag = await getDiagnostics();
    expect(diag.entriesSkipped).toBe(0);

    await recordEntriesSkipped(5);
    diag = await getDiagnostics();
    expect(diag.entriesSkipped).toBe(5);

    await recordEntriesSkipped(2);
    diag = await getDiagnostics();
    expect(diag.entriesSkipped).toBe(7);
  });

  it("recordEntriesSkipped does not affect other counters", async () => {
    await recordSyncAttempt();
    const countBefore = (await getDiagnostics()).syncAttempts;

    await recordEntriesSkipped(3);
    const diag = await getDiagnostics();
    expect(diag.syncAttempts).toBe(countBefore);
    expect(diag.entriesSkipped).toBe(3);
  });
});
