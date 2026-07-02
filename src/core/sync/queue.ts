import { allSyncJobs, updateSyncJob, removeSyncJob } from "../storage/local-db";
import type { SyncJob } from "./types";
import type { StorageAdapter } from "../storage/interface";

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/** 1s, 2s, 4s, 8s ... capped at 5 minutes (dev guide §10.1). */
export function backoffMs(retries: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** retries, BACKOFF_MAX_MS);
}

export type JobHandler = (job: SyncJob, adapter: StorageAdapter) => Promise<void>;

/**
 * Drains every due job in priority order (0 = user-initiated, before
 * background jobs), skipping ones still in backoff. This is the only code
 * path that calls into a StorageAdapter on the write side — see
 * ARCHITECTURE.md's "sync-engine.ts is the only caller of StorageAdapter
 * methods."
 */
export async function processQueue(
  adapter: StorageAdapter,
  handler: JobHandler,
): Promise<{ processed: number; failed: number }> {
  const jobs = await allSyncJobs();
  const due = jobs
    .filter((job) => {
      if (!job.lastAttempt) return true;
      return Date.now() - new Date(job.lastAttempt).getTime() >= backoffMs(job.retries);
    })
    .sort(
      (a, b) =>
        a.priority - b.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  let processed = 0;
  let failed = 0;

  for (const job of due) {
    try {
      await handler(job, adapter);
      await removeSyncJob(job.id);
      processed++;
    } catch (err) {
      failed++;
      await updateSyncJob({
        ...job,
        retries: job.retries + 1,
        lastAttempt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed, failed };
}

/** Resets backoff on every job stuck past maxRetries so the user's manual "retry all" is immediate. */
export async function retryAllFailed(): Promise<void> {
  const jobs = await allSyncJobs();
  await Promise.all(
    jobs
      .filter((j) => j.retries >= j.maxRetries)
      .map((j) => updateSyncJob({ ...j, retries: 0, error: null, lastAttempt: null })),
  );
}

export async function pendingJobCount(): Promise<number> {
  return (await allSyncJobs()).length;
}

export async function failedJobCount(): Promise<number> {
  return (await allSyncJobs()).filter((j) => j.retries >= j.maxRetries).length;
}
