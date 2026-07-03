import { processQueue } from "./queue";
import { mergeEntries } from "./conflict-resolver";
import {
  allEntries,
  allSyncJobs,
  getEntry,
  putEntry,
  getAudioBlob,
  enqueueSyncJob,
  getConfig,
  getAudioVerifiedAt,
  markAudioVerified,
} from "../storage/local-db";
import { buildAdapter } from "../storage/registry";
import { entryPath, audioPath, type StorageAdapter } from "../storage/interface";
import { serializeEntry } from "../tensor-log/entry-serializer";
import { parseEntry } from "../tensor-log/entry-parser";
import { mimeToExt } from "../../utils/file";
import { newId } from "../../utils/id";
import { nowIso } from "../../utils/date";
import type { SyncJob } from "./types";

/**
 * The only module that imports StorageAdapter methods on the write side
 * (see ARCHITECTURE.md). UI code calls enqueueEntryForSync /
 * enqueueAudioForSync when something changes locally, and syncNow() when
 * useOfflineStatus says we're back online — it never touches an adapter
 * directly.
 */

export async function enqueueEntryForSync(entryId: string, priority: 0 | 1 = 0): Promise<void> {
  const job: SyncJob = {
    id: newId(),
    type: "upload_entry",
    payload: { type: "upload_entry", entryId },
    priority,
    retries: 0,
    maxRetries: 5,
    createdAt: nowIso(),
    lastAttempt: null,
    error: null,
  };
  await enqueueSyncJob(job);
}

export async function enqueueAudioForSync(entryId: string, blob: Blob, priority: 0 | 1 = 1): Promise<void> {
  const job: SyncJob = {
    id: newId(),
    type: "upload_audio",
    payload: { type: "upload_audio", entryId, audioPath: audioPath(entryId, mimeToExt(blob.type)) },
    priority,
    retries: 0,
    maxRetries: 5,
    createdAt: nowIso(),
    lastAttempt: null,
    error: null,
  };
  await enqueueSyncJob(job);
}

/**
 * "Verified" means read-back confirmed, not "the write call didn't
 * throw" — a Fable strategic review's whole audio-retention recommendation
 * depends on this distinction (the sync layer has the worst track record
 * of any component in this codebase; a write-success-only signal isn't
 * trustworthy enough to gate anything on, let alone eventual local
 * deletion). Filters listFiles()'s results by exact path match rather
 * than trusting the adapter to have already done prefix filtering —
 * GoogleDriveAdapter's listFiles() lists an entire folder and ignores the
 * filename portion of its "prefix" argument, so relying on server-side
 * filtering here would silently pass for the wrong reason.
 */
export async function verifyRemoteBlob(adapter: StorageAdapter, path: string, expectedSize: number): Promise<boolean> {
  const files = await adapter.listFiles(path);
  const match = files.find((f) => f.path === path);
  return match !== undefined && match.size === expectedSize;
}

async function handleJob(job: SyncJob, adapter: StorageAdapter): Promise<void> {
  switch (job.payload.type) {
    case "upload_entry": {
      const entry = await getEntry(job.payload.entryId);
      if (!entry) return; // entry gone locally — nothing to push
      await adapter.writeFile(entryPath(entry.timestamp, entry.id), serializeEntry(entry));
      return;
    }
    case "upload_audio": {
      const blob = await getAudioBlob(job.payload.entryId);
      if (!blob) {
        // Confirmed by a Fable strategic review, verified against this
        // exact code: silently returning here made processQueue() treat a
        // missing blob as SUCCESS (see queue.ts — no throw means the job
        // gets deleted). That's backwards for the one case this matters
        // most: browser-evicted audio. Eviction doesn't just lose the
        // local copy — it was silently cancelling the very upload that
        // would have saved it, with the job vanishing and nothing ever
        // surfacing that the audio was never archived. Throwing here
        // instead means the job exhausts its retries and shows up in
        // Settings → Support's sync-error count — an honest, visible
        // failure instead of a silent, permanent one.
        throw new Error(`Audio for entry ${job.payload.entryId} is missing locally — cannot upload.`);
      }
      await adapter.writeBlob(job.payload.audioPath, blob);
      const verified = await verifyRemoteBlob(adapter, job.payload.audioPath, blob.size);
      if (!verified) {
        // writeBlob() resolving isn't proof of anything — throwing here
        // (rather than the old "assume success") means an upload that
        // silently failed server-side gets retried instead of the job
        // vanishing while marked done.
        throw new Error(
          `Upload of audio for entry ${job.payload.entryId} could not be verified against the remote copy — retrying.`,
        );
      }
      await markAudioVerified(job.payload.entryId, nowIso());
      return;
    }
    case "delete_entry": {
      // Additive model: "delete" already landed as a retract Correction on
      // the local entry (entry-builder.buildRetractCorrection). This job
      // just re-pushes so the remote copy reflects retracted=true too —
      // the file is never actually removed from storage.
      const entry = await getEntry(job.payload.entryId);
      if (!entry) return;
      await adapter.writeFile(entryPath(entry.timestamp, entry.id), serializeEntry(entry));
      return;
    }
    case "download_manifest":
    case "download_file":
      // Reserved for a future incremental-pull path; pullRemoteEntries()
      // below does a full manifest read directly since Phase 1's entry
      // counts don't need queued/batched downloads yet.
      return;
  }
}

export async function drainQueue(): Promise<{ processed: number; failed: number }> {
  const adapter = await getActiveAdapter();
  if (!adapter) return { processed: 0, failed: 0 };
  return processQueue(adapter, handleJob);
}

export async function pullRemoteEntries(): Promise<number> {
  const adapter = await getActiveAdapter();
  if (!adapter) return 0;

  const manifest = await adapter.getManifest();
  let pulled = 0;

  for (const file of manifest.entries) {
    if (!file.path.endsWith(".md")) continue;
    let remoteEntry;
    try {
      remoteEntry = parseEntry(await adapter.readFile(file.path));
    } catch {
      continue; // corrupt or unreadable remote file — skip, don't fail the whole pull
    }

    const localEntry = await getEntry(remoteEntry.id);
    const merged = localEntry ? mergeEntries(localEntry, remoteEntry) : remoteEntry;
    await putEntry(merged);
    pulled++;
  }

  return pulled;
}

export async function pushAllLocalEntries(): Promise<number> {
  const local = await allEntries();
  for (const entry of local) {
    await enqueueEntryForSync(entry.id);
  }
  const { processed } = await drainQueue();
  await refreshManifest();
  return processed;
}

async function refreshManifest(): Promise<void> {
  const adapter = await getActiveAdapter();
  if (!adapter) return;
  const local = await allEntries();
  await adapter.writeManifest({
    version: "1.0",
    generatedAt: nowIso(),
    entries: local.map((e) => ({
      path: entryPath(e.timestamp, e.id),
      // Real byte size of the serialized file, not a placeholder — a
      // multi-model review round caught this hardcoded at 0, which makes
      // FileMetadata.size useless for anything that might one day want it
      // (bandwidth estimates, storage-quota warnings).
      size: new Blob([serializeEntry(e)]).size,
      modifiedAt: e.timestamp,
    })),
  });
}

/**
 * Notices audio that's drifted out of sync with what the device thinks is
 * archived, and re-queues it. Today, audio gets exactly one upload job,
 * created at capture time — nothing ever double-checks it again after
 * that job either succeeds or exhausts its retries. This closes that gap:
 * any entry with a local audio blob that's neither verified nor currently
 * queued gets a fresh job. Deliberately does NOT re-verify already-
 * verified audio (that would mean re-listing the remote on every sync —
 * a heavier integrity-audit feature, not what this pass is for) and does
 * NOT attempt anything for entries whose local blob is already gone —
 * that's a different, unfixable-from-here problem (the audio is just
 * lost) that the retention-policy work in ROADMAP.md is meant to prevent
 * from happening in the first place.
 */
// A stress-test pass found that two overlapping calls can both read the
// same "nothing pending yet" snapshot of allSyncJobs() before either one
// enqueues, so both decide independently to requeue the same entry —
// duplicate (harmless but wasteful) upload_audio jobs. Unreachable through
// any call path today (syncNow()'s own inFlight guard means this is only
// ever invoked once at a time), but this exact codebase has already
// demonstrated, more than once this session, that "unreachable today"
// reliably becomes a live bug the next time something else changes — so
// the same inFlight-promise pattern syncNow() uses gets applied here too,
// rather than leaving this as a footgun for whoever adds the next call
// path (a "sync audio only" button, a retry-audio action, etc).
let reconcileInFlight: Promise<{ requeued: number }> | null = null;

export async function reconcileAudio(): Promise<{ requeued: number }> {
  if (reconcileInFlight) return reconcileInFlight;
  reconcileInFlight = (async () => {
    const [local, jobs] = await Promise.all([allEntries(), allSyncJobs()]);
    const pendingAudioEntryIds = new Set(
      jobs
        .map((j) => j.payload)
        .filter((p): p is Extract<SyncJob["payload"], { type: "upload_audio" }> => p.type === "upload_audio")
        .map((p) => p.entryId),
    );

    let requeued = 0;
    for (const entry of local) {
      if (!entry.audio) continue; // never had audio
      if (pendingAudioEntryIds.has(entry.id)) continue; // already queued — don't duplicate

      const verifiedAt = await getAudioVerifiedAt(entry.id);
      if (verifiedAt) continue; // already confirmed archived

      const blob = await getAudioBlob(entry.id);
      if (!blob) continue; // nothing locally left to re-upload

      await enqueueAudioForSync(entry.id, blob);
      requeued++;
    }
    return { requeued };
  })();
  try {
    return await reconcileInFlight;
  } finally {
    reconcileInFlight = null;
  }
}

async function getActiveAdapter(): Promise<StorageAdapter | null> {
  const config = await getConfig();
  const adapter = await buildAdapter(config);
  if (!adapter) return null;
  if (await adapter.isAuthenticated()) return adapter;

  // Google Drive's authenticate() opens an interactive OAuth popup — it
  // must never fire unprompted during a background sync check. Every
  // other backend's "authenticate" is just a credentials-already-in-config
  // network check, safe to retry silently — this is what makes sync
  // self-heal after a page reload instead of requiring the user to
  // manually hit Settings → Connect again every time they reopen the app.
  if (config.storage.activeBackend === "google-drive") return null;

  try {
    await adapter.authenticate();
  } catch {
    return null;
  }
  return (await adapter.isAuthenticated()) ? adapter : null;
}

// useSync.ts can trigger this both from the online/offline listener and
// from a manual "tap to retry" — without a guard, two overlapping runs
// would push/pull redundantly and both call refreshManifest(). Not data-
// unsafe (every step here is already idempotent/additive), just wasteful
// and confusing if a user taps retry while a background sync is already
// in flight. A concurrent second call gets the first call's in-flight
// result instead of starting its own.
let inFlight: Promise<{ pushed: number; pulled: number }> | null = null;

export async function syncNow(): Promise<{ pushed: number; pulled: number }> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const pushed = await pushAllLocalEntries();
    const pulled = await pullRemoteEntries();
    const { requeued } = await reconcileAudio();
    if (requeued > 0) await drainQueue(); // process the newly re-queued jobs in this same cycle
    return { pushed, pulled };
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
