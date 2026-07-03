import { processQueue } from "./queue";
import { mergeEntries } from "./conflict-resolver";
import {
  allEntries,
  getEntry,
  putEntry,
  getAudioBlob,
  enqueueSyncJob,
  getConfig,
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
    return { pushed, pulled };
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
