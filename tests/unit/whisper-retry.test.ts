import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  drainQueue,
  enqueueWhisperRetry,
  pendingWhisperRetryEntryIds,
} from "../../src/core/sync/sync-engine";
import { allSyncJobs, putAudioBlob, putEntry, getEntry, setConfig } from "../../src/core/storage/local-db";
import { applyCorrections } from "../../src/core/tensor-log/entry-builder";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import { clearAdapterCache } from "../../src/core/storage/registry";
import { defaultAppConfig } from "../../src/config/schema";
import { updateSyncJob } from "../../src/core/storage/local-db";

import { clear, createStore } from "idb-keyval";

async function clearAllStores(): Promise<void> {
  // Clear each object store through a fresh connection rather than deleting
  // the databases, because idb-keyval holds long-lived connections and
  // deleteDatabase() would hang waiting for them to close.
  await Promise.all([
    clear(createStore("deckboss-entries", "entries")),
    clear(createStore("deckboss-audio", "audio")),
    clear(createStore("deckboss-meta", "meta")),
    clear(createStore("deckboss-sync-queue", "sync-queue")),
    clear(createStore("deckboss-audio-verified", "audio-verified")),
  ]);
}

// jsdom's FormData rejects Node's Blob (see tests/setup.ts). The sync-engine
// handler calls transcribeWithWhisper, which only needs FormData to bundle
// fields for the fetch body; a minimal fake keeps these tests focused on the
// retry-queue logic rather than jsdom's Blob conformance.
class FakeFormData {
  private data = new Map<string, { value: unknown; filename?: string }>();
  append(key: string, value: unknown, filename?: string) {
    this.data.set(key, { value, filename });
  }
}

function entryWithAudio() {
  return newEntrySkeleton({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    gps: null,
    audio: { filename: "audio.webm", duration_ms: 1000, format: "audio/webm", size_bytes: 10 },
    source: "voice",
  });
}

describe("whisper offline-retry queue", () => {
  const originalFetch = globalThis.fetch;
  const originalFormData = globalThis.FormData;

  beforeEach(async () => {
    await clearAllStores();
    clearAdapterCache();
    globalThis.fetch = vi.fn();
    globalThis.FormData = FakeFormData as unknown as typeof FormData;
    await setConfig({
      ...defaultAppConfig(),
      storage: { activeBackend: "local-zip" },
      transcription: { engine: "whisper", whisperApiKey: "sk-test", language: "en" },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.FormData = originalFormData;
  });

  it("queues a retry for a Whisper transcription that failed due to network", async () => {
    const entry = entryWithAudio();
    await putEntry(entry);
    await putAudioBlob(entry.id, new Blob(["audio"], { type: "audio/webm" }));

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await enqueueWhisperRetry(entry.id, "en");
    expect(await pendingWhisperRetryEntryIds()).toContain(entry.id);

    const result = await drainQueue();
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);

    // Job stays in the queue so it can retry once connectivity returns.
    const jobs = await allSyncJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.type).toBe("whisper_retry");
    expect(jobs[0]?.retries).toBeGreaterThan(0);
  });

  it("attaches a successful retry as an amend correction, not a direct mutation", async () => {
    const entry = entryWithAudio();
    await putEntry(entry);
    await putAudioBlob(entry.id, new Blob(["audio"], { type: "audio/webm" }));

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ text: "crab pots in fifty fathoms" }), { status: 200 }),
    );

    await enqueueWhisperRetry(entry.id, "en");
    const result = await drainQueue();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(await pendingWhisperRetryEntryIds()).not.toContain(entry.id);

    const raw = await getEntry(entry.id);
    expect(raw?.corrections).toHaveLength(1);
    const correction = raw?.corrections[0];
    expect(correction?.type).toBe("amend");
    expect(correction?.author).toEqual({ kind: "model", engine: "whisper-1" });

    const effective = applyCorrections(raw!);
    expect(effective.transcript?.text).toBe("crab pots in fifty fathoms");
    expect(effective.transcript?.engine).toBe("whisper-1");

    // The successful transcription should also be queued for cloud sync.
    const jobs = await allSyncJobs();
    expect(jobs.some((j) => j.payload.type === "upload_entry" && j.payload.entryId === entry.id)).toBe(
      true,
    );
  });

  it("does not retry permanent Whisper API errors like a bad key", async () => {
    const entry = entryWithAudio();
    await putEntry(entry);
    await putAudioBlob(entry.id, new Blob(["audio"], { type: "audio/webm" }));

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 }),
    );

    await enqueueWhisperRetry(entry.id, "en");
    const result = await drainQueue();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(await allSyncJobs()).toHaveLength(0);

    const raw = await getEntry(entry.id);
    expect(raw?.corrections).toHaveLength(0);
  });

  it("respects maxRetries for repeated network failures", async () => {
    const entry = entryWithAudio();
    await putEntry(entry);
    await putAudioBlob(entry.id, new Blob(["audio"], { type: "audio/webm" }));

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await enqueueWhisperRetry(entry.id, "en");
    const job = (await allSyncJobs())[0];
    if (!job) throw new Error("job not enqueued");

    // Simulate the job already having retried up to just under the limit.
    await updateSyncJob({
      ...job,
      retries: 19,
      lastAttempt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const result = await drainQueue();
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);

    const after = await allSyncJobs();
    expect(after).toHaveLength(1);
    expect(after[0]?.retries).toBe(20);
    expect(after[0]?.retries).toBeLessThanOrEqual(after[0]?.maxRetries ?? 0);
  });
});
