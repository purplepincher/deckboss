import { describe, it, expect, beforeEach } from "vitest";
import { drainQueue, enqueueAudioForSync } from "../../src/core/sync/sync-engine";
import { allSyncJobs } from "../../src/core/storage/local-db";
import { setConfig } from "../../src/core/storage/local-db";
import { clearAdapterCache } from "../../src/core/storage/registry";
import { defaultAppConfig } from "../../src/config/schema";

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
