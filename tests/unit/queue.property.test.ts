import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { processQueue } from '../../core/sync/queue';
import type { SyncJob } from '../../core/sync/types';
import type { StorageAdapter } from '../../core/storage/interface';
import * as localDb from '../../core/storage/local-db';

vi.mock('../../core/storage/local-db');

const mockedLocalDb = vi.mocked(localDb);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeJob(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: crypto.randomUUID(),
    type: 'upload_entry',
    payload: { entryId: crypto.randomUUID() },
    priority: 0,
    createdAt: new Date().toISOString(),
    retries: 0,
    maxRetries: 3,
    lastAttempt: null,
    error: null,
    ...overrides,
  } as SyncJob;
}

describe('queue property tests', () => {
  // --------------------------------------------------------------------
  // 1. No silent drops – every job is either successfully processed or
  //    still present with incremented retries and an error reason.
  // --------------------------------------------------------------------
  it('never drops jobs silently', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuidV4(),
            priority: fc.integer({ min: 0, max: 3 }),
            createdAt: fc.date().map(d => d.toISOString()),
            maxRetries: fc.integer({ min: 1, max: 5 }),
            shouldFail: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (specs) => {
          // ---- fresh in-memory store ----
          const store = new Map<string, SyncJob>();

          mockedLocalDb.allSyncJobs.mockImplementation(async () => {
            const jobs: SyncJob[] = [];
            store.forEach(j => jobs.push({ ...j }));
            return jobs;
          });
          mockedLocalDb.updateSyncJob.mockImplementation(async (job: SyncJob) => {
            store.set(job.id, { ...job });
          });
          mockedLocalDb.removeSyncJob.mockImplementation(async (id: string) => {
            store.delete(id);
          });

          // populate store
          const jobs = specs.map(s =>
            makeJob({
              id: s.id,
              priority: s.priority,
              createdAt: s.createdAt,
              maxRetries: s.maxRetries,
            }),
          );
          for (const j of jobs) store.set(j.id, j);

          const adapter = {} as StorageAdapter;

          let successCount = 0;
          const handler = async (job: SyncJob, _adapter: StorageAdapter) => {
            const spec = specs.find(s => s.id === job.id)!;
            if (spec.shouldFail) {
              throw new Error('forced failure');
            }
            successCount++;
          };

          await processQueue(adapter, handler);

          // ---- assertions ----
          for (const spec of specs) {
            const job = store.get(spec.id);
            if (spec.shouldFail) {
              expect(job).toBeDefined();
              expect(job?.retries).toBe(1);
              expect(job?.error).toBe('forced failure');
            } else {
              expect(job).toBeUndefined();
            }
          }

          const expectedSuccesses = specs.filter(s => !s.shouldFail).length;
          const removedCount = jobs.length - store.size;
          expect(removedCount).toBe(successCount);
          expect(successCount).toBe(expectedSuccesses);
        },
      ),
      { numRuns: 100 },
    );
  });
});
