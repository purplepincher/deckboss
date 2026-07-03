import { describe, it, expect, beforeEach } from "vitest";
import {
  drainQueue,
  enqueueAudioForSync,
  syncNow,
  reconcileAudio,
  verifyRemoteBlob,
} from "../../src/core/sync/sync-engine";
import { allSyncJobs, setConfig, putAudioBlob, getAudioVerifiedAt, putEntry } from "../../src/core/storage/local-db";
import { clearAdapterCache } from "../../src/core/storage/registry";
import { defaultAppConfig } from "../../src/config/schema";
import { newEntrySkeleton } from "../../src/core/types/log-entry";
import type { StorageAdapter, FileMetadata, Manifest } from "../../src/core/storage/interface";

function fakeAdapter(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    id: "local-zip",
    isAuthenticated: async () => true,
    authenticate: async () => {},
    logout: async () => {},
    readFile: async () => {
      throw new Error("not implemented");
    },
    writeFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
    readBlob: async () => {
      throw new Error("not implemented");
    },
    writeBlob: async () => {},
    deleteBlob: async () => {},
    getManifest: async (): Promise<Manifest> => ({ version: "1.0", generatedAt: new Date().toISOString(), entries: [] }),
    writeManifest: async () => {},
    ...overrides,
  };
}

describe("sync-engine: missing local audio blob", () => {
  beforeEach(async () => {
    clearAdapterCache();
    await setConfig({ ...defaultAppConfig(), storage: { activeBackend: "local-zip" } });
  });

  it("fails loudly instead of silently deleting the job when the blob is missing", async () => {
    // Simulates browser-evicted audio: a sync job exists for an entry
    // whose blob no longer exists in local storage (putAudioBlob was
    // never called for this id — nothing wrote it, same as if it existed
    // once and got evicted).
    const entryId = crypto.randomUUID();
    await enqueueAudioForSync(entryId, new Blob(["fake audio"], { type: "audio/webm" }));

    // Remove the "evidence" this job's blob ever existed by never having
    // stored it in the first place — enqueueAudioForSync only enqueues
    // the job, it doesn't call putAudioBlob itself, so this is already
    // the missing-blob state without any extra setup.

    const before = await allSyncJobs();
    expect(before).toHaveLength(1);

    const result = await drainQueue();

    // The old behavior: handleJob() returned normally on a missing blob,
    // processQueue() treated that as success, and removeSyncJob() deleted
    // the job — audio silently never uploaded, no trace left anywhere.
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);

    // The job must still exist (with an incremented retry count and a
    // recorded error), not have vanished.
    const after = await allSyncJobs();
    expect(after).toHaveLength(1);
    expect(after[0]?.retries).toBeGreaterThan(0);
    expect(after[0]?.error).toBeTruthy();
  });
});

describe("verifyRemoteBlob", () => {
  it("returns true only when the exact path is present with the exact size", async () => {
    const files: FileMetadata[] = [
      { path: ".deckboss/attachments/abc_audio.webm", size: 42, modifiedAt: new Date().toISOString() },
    ];
    const adapter = fakeAdapter({ listFiles: async () => files });
    expect(await verifyRemoteBlob(adapter, ".deckboss/attachments/abc_audio.webm", 42)).toBe(true);
  });

  it("returns false when the write silently didn't land — the whole point of this check", async () => {
    // Simulates a backend whose writeBlob() resolved without throwing but
    // never actually persisted anything (the exact failure mode this
    // check exists to catch — "the upload call didn't throw" was never
    // proof of anything).
    const adapter = fakeAdapter({ listFiles: async () => [] });
    expect(await verifyRemoteBlob(adapter, ".deckboss/attachments/abc_audio.webm", 42)).toBe(false);
  });

  it("returns false on a size mismatch (a partial or corrupted upload)", async () => {
    const files: FileMetadata[] = [
      { path: ".deckboss/attachments/abc_audio.webm", size: 10, modifiedAt: new Date().toISOString() },
    ];
    const adapter = fakeAdapter({ listFiles: async () => files });
    expect(await verifyRemoteBlob(adapter, ".deckboss/attachments/abc_audio.webm", 42)).toBe(false);
  });

  it("filters by exact path, not merely by prefix — GoogleDriveAdapter's listFiles ignores the filename portion of its prefix argument and returns a whole folder", async () => {
    const files: FileMetadata[] = [
      { path: ".deckboss/attachments/other_audio.webm", size: 42, modifiedAt: new Date().toISOString() },
    ];
    const adapter = fakeAdapter({ listFiles: async () => files });
    expect(await verifyRemoteBlob(adapter, ".deckboss/attachments/abc_audio.webm", 42)).toBe(false);
  });
});

describe("sync-engine: upload verification end-to-end (local-zip)", () => {
  beforeEach(async () => {
    clearAdapterCache();
    await setConfig({ ...defaultAppConfig(), storage: { activeBackend: "local-zip" } });
  });

  it("marks audio verified only after a successful, read-back-confirmed upload", async () => {
    const entryId = crypto.randomUUID();
    const blob = new Blob(["fake audio"], { type: "audio/webm" });
    await putAudioBlob(entryId, blob);

    expect(await getAudioVerifiedAt(entryId)).toBeNull();

    await enqueueAudioForSync(entryId, blob);
    const result = await drainQueue();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(await getAudioVerifiedAt(entryId)).not.toBeNull();
  });
});

describe("reconcileAudio", () => {
  beforeEach(async () => {
    clearAdapterCache();
    await setConfig({ ...defaultAppConfig(), storage: { activeBackend: "local-zip" } });
  });

  function entryWithAudio() {
    return newEntrySkeleton({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      gps: null,
      audio: { filename: "audio.webm", duration_ms: 1000, format: "webm", size_bytes: 10 },
      source: "voice",
    });
  }

  it("re-queues audio that exists locally but was never verified and has no pending job", async () => {
    const entry = entryWithAudio();
    await putEntry(entry);
    await putAudioBlob(entry.id, new Blob(["audio"], { type: "audio/webm" }));

    const { requeued } = await reconcileAudio();
    expect(requeued).toBe(1);

    const jobs = await allSyncJobs();
    expect(jobs.some((j) => j.payload.type === "upload_audio" && j.payload.entryId === entry.id)).toBe(true);
  });

  it("does not re-queue audio that's already verified", async () => {
    const entry = entryWithAudio();
    await putEntry(entry);
    await putAudioBlob(entry.id, new Blob(["audio"], { type: "audio/webm" }));

    // Simulate a prior successful, verified upload the honest way — drive
    // it through the real upload path rather than poking internal state.
    await enqueueAudioForSync(entry.id, new Blob(["audio"], { type: "audio/webm" }));
    await drainQueue();
    expect(await getAudioVerifiedAt(entry.id)).not.toBeNull();

    const { requeued } = await reconcileAudio();
    expect(requeued).toBe(0);
  });

  it("does not duplicate a job that's already pending", async () => {
    const entry = entryWithAudio();
    await putEntry(entry);
    const blob = new Blob(["audio"], { type: "audio/webm" });
    await putAudioBlob(entry.id, blob);
    await enqueueAudioForSync(entry.id, blob); // one job already queued, not yet drained

    const { requeued } = await reconcileAudio();
    expect(requeued).toBe(0);

    const jobs = await allSyncJobs();
    expect(jobs.filter((j) => j.payload.type === "upload_audio" && j.payload.entryId === entry.id)).toHaveLength(1);
  });

  it("does not double-enqueue when called concurrently — a stress-test found the un-guarded version does", async () => {
    // Reproduces the exact race an adversarial stress-test pass found: two
    // overlapping reconcileAudio() calls both read the same "nothing
    // pending yet" snapshot before either enqueues, so both independently
    // decide the same entry needs a job. Unreachable through any call path
    // today (syncNow()'s inFlight guard means this only ever runs one at a
    // time) but worth locking in as a real guarantee rather than an
    // accident of how it's currently called.
    const entry = entryWithAudio();
    await putEntry(entry);
    await putAudioBlob(entry.id, new Blob(["audio"], { type: "audio/webm" }));

    const [first, second] = await Promise.all([reconcileAudio(), reconcileAudio()]);
    // The second call joins the first's in-flight promise rather than
    // starting its own pass, so both resolve to the identical result.
    expect(first).toBe(second);
    expect(first.requeued).toBe(1);

    const jobs = await allSyncJobs();
    expect(jobs.filter((j) => j.payload.type === "upload_audio" && j.payload.entryId === entry.id)).toHaveLength(1);
  });

  it("does not attempt anything for audio that's already gone locally", async () => {
    const entry = entryWithAudio();
    await putEntry(entry);
    // Deliberately no putAudioBlob() call — simulates evicted local audio.

    const { requeued } = await reconcileAudio();
    expect(requeued).toBe(0);
  });
});

describe("syncNow: reconciliation is part of the regular sync cycle", () => {
  beforeEach(async () => {
    clearAdapterCache();
    await setConfig({ ...defaultAppConfig(), storage: { activeBackend: "local-zip" } });
  });

  it("picks up and uploads audio a reconciliation pass finds, within the same syncNow() call", async () => {
    const entry = newEntrySkeleton({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      gps: null,
      audio: { filename: "audio.webm", duration_ms: 1000, format: "webm", size_bytes: 10 },
      source: "voice",
    });
    await putEntry(entry);
    await putAudioBlob(entry.id, new Blob(["audio"], { type: "audio/webm" }));

    await syncNow();

    expect(await getAudioVerifiedAt(entry.id)).not.toBeNull();
  });
});
