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
  allAudioVerifiedAt,
  markAudioVerified,
} from "../storage/local-db";
import { buildAdapter } from "../storage/registry";
import { entryPath, audioPath, type StorageAdapter, type FileMetadata } from "../storage/interface";
import { mimeToExt } from "../../utils/file";
import { newId } from "../../utils/id";
import { nowIso } from "../../utils/date";
import type { SyncJob } from "./types";
import { transcribeWithWhisper, WhisperApiError, WhisperNetworkError } from "../../services/whisper";
import { applyCorrections, buildAmendCorrection } from "../tensor-log/entry-builder";
import { extractEntities } from "../../services/entity-extractor";

// Lazy-loaded: serializeEntry/parseEntry pull in js-yaml (~31KB gzip, ~20%
// of the pre-fix main bundle), but they're only needed on the sync write/read
// path — never on the landing RecordScreen. Keeping them out of a static
// import means the record button can become interactive before the YAML
// serializer downloads and parses. The module promise is cached by the JS
// runtime after the first await, so subsequent syncs pay no extra cost.
const lazySerializer = (): Promise<typeof import("../tensor-log/entry-serializer")> =>
  import("../tensor-log/entry-serializer");
const lazyParser = (): Promise<typeof import("../tensor-log/entry-parser")> => import("../tensor-log/entry-parser");

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
    maxRetries: 20,
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
    maxRetries: 20,
    createdAt: nowIso(),
    lastAttempt: null,
    error: null,
  };
  await enqueueSyncJob(job);
}

/**
 * Queue a stored audio recording for Whisper transcription once the device is
 * back online. This is the recovery path for the offline-at-sea case: the
 * recording is already saved locally (audio blob + entry), but the Whisper call
 * failed because the network was unreachable. The language is frozen at enqueue
 * time so a later Settings change doesn't silently alter which language a
 * queued retry runs in.
 */
export async function enqueueWhisperRetry(entryId: string, language: string, priority: 0 | 1 = 1): Promise<void> {
  const jobs = await allSyncJobs();
  const alreadyQueued = jobs.some((j) => j.payload.type === "whisper_retry" && j.payload.entryId === entryId);
  if (alreadyQueued) return;

  const job: SyncJob = {
    id: newId(),
    type: "whisper_retry",
    payload: { type: "whisper_retry", entryId, language },
    priority,
    retries: 0,
    maxRetries: 20,
    createdAt: nowIso(),
    lastAttempt: null,
    error: null,
  };
  await enqueueSyncJob(job);
}

/** Returns the set of entry ids that currently have a pending Whisper retry job. */
export async function pendingWhisperRetryEntryIds(): Promise<Set<string>> {
  const jobs = await allSyncJobs();
  return new Set(
    jobs
      .map((j) => j.payload)
      .filter((p): p is Extract<SyncJob["payload"], { type: "whisper_retry" }> => p.type === "whisper_retry")
      .map((p) => p.entryId),
  );
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
      const { serializeEntry } = await lazySerializer();
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
      const { serializeEntry } = await lazySerializer();
      await adapter.writeFile(entryPath(entry.timestamp, entry.id), serializeEntry(entry));
      return;
    }
    case "whisper_retry": {
      // Offline-recovery path for Whisper: the audio blob and entry are
      // already local, but the original transcription failed because the
      // network was unreachable. If we can transcribe it now, attach the
      // result as an amend Correction (the same path a human edit uses) so
      // the original capture-time record stays untouched.
      const entry = await getEntry(job.payload.entryId);
      if (!entry) return; // entry gone — nothing to transcribe

      const effective = applyCorrections(entry);
      if (effective.transcript) return; // already got a transcript somehow

      const blob = await getAudioBlob(job.payload.entryId);
      if (!blob) return; // local audio gone — unrecoverable from here

      const config = await getConfig();
      if (!config.transcription.whisperApiKey) return; // Whisper de-configured — permanent failure

      let result;
      try {
        result = await transcribeWithWhisper(blob, config.transcription.whisperApiKey, job.payload.language);
      } catch (err) {
        if (err instanceof WhisperNetworkError || err instanceof WhisperApiError) {
          // Network errors should retry with backoff; API errors (bad key,
          // quota, malformed audio) are permanent for this recording. Throwing
          // here keeps the job in the queue for network cases, while returning
          // for API errors removes it so it doesn't burn retries forever.
          if (err instanceof WhisperNetworkError) throw err;
          return;
        }
        throw err;
      }

      const amended: typeof entry = {
        ...entry,
        corrections: [
          ...entry.corrections,
          buildAmendCorrection(
            { transcript: result, entities: extractEntities(result.text) },
            config.deviceId,
            "Whisper transcription completed after reconnect",
            { kind: "model", engine: result.engine },
          ),
        ],
      };
      await putEntry(amended);
      await enqueueEntryForSync(amended.id);
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
      const { parseEntry } = await lazyParser();
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
  const { serializeEntry } = await lazySerializer();
  const localFiles: FileMetadata[] = local.map((e) => ({
    path: entryPath(e.timestamp, e.id),
    // Real byte size of the serialized file, not a placeholder — a
    // multi-model review round caught this hardcoded at 0, which makes
    // FileMetadata.size useless for anything that might one day want it
    // (bandwidth estimates, storage-quota warnings).
    size: new Blob([serializeEntry(e)]).size,
    modifiedAt: e.timestamp,
  }));

  // Union with whatever the remote manifest already lists, rather than
  // replacing it outright — a research pass found this was a live
  // discovery bug the moment the adapter-caching fix made real
  // multi-device sync actually work: refreshManifest() runs *before*
  // pullRemoteEntries() in syncNow()'s order, so at write time `local`
  // only reflects what THIS device already had before this sync's pull.
  // If another device uploaded entries since this device's last pull, a
  // blind overwrite here would drop them from the manifest — the .md
  // files would still exist in storage, but pullRemoteEntries() has no
  // other way to discover them. Two devices sharing one bucket could
  // each silently un-list the other's uploads on every sync.
  let remoteFiles: FileMetadata[] = [];
  let remoteReadFailed = false;
  try {
    remoteFiles = (await adapter.getManifest()).entries;
  } catch {
    // no existing manifest yet (first sync ever, or backend that throws
    // on a missing file rather than returning empty) — local-only is
    // correct in that case, nothing to union with.
    remoteReadFailed = true;
  }

  // The restore drill (docs/FABLE_PHASE2_PLAN.md §5, A1) found this
  // silently destructive: a device with nothing local to push (the exact
  // situation a freshly recovering device is in on its very first sync,
  // before pullRemoteEntries() has run) that hits this catch — e.g. a
  // corrupted/partially-written manifest.json, a real and reproducible
  // condition on a real backend, not just "first sync ever" — would fall
  // through to the union below with remoteFiles=[] and localFiles=[],
  // then WRITE that empty manifest back, permanently erasing the only
  // index the archive's actual .md/audio files were discoverable through.
  // The files themselves survive; they just become unreachable, and
  // "pointing a fresh device at the same cloud storage recovers
  // everything" silently stops being true. A device that has nothing to
  // contribute has no safe basis for deciding the remote is genuinely
  // empty rather than momentarily unreadable, so it must not write
  // anything in that case — leave whatever's actually there (readable or
  // not) untouched instead of guessing.
  if (remoteReadFailed && localFiles.length === 0) return;

  const merged = new Map<string, FileMetadata>();
  for (const f of remoteFiles) merged.set(f.path, f);
  for (const f of localFiles) merged.set(f.path, f); // this device's own view of its entries is the freshest for those paths

  await adapter.writeManifest({
    version: "1.0",
    generatedAt: nowIso(),
    entries: [...merged.values()],
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
    // Verified-state read is batched (allAudioVerifiedAt: one IndexedDB
    // `entries()` call) instead of the previous per-entry getAudioVerifiedAt()
    // in the loop below — N audio entries used to mean N round-trips, which
    // dominated this pass at higher counts (measured ~1s at 2000 audio
    // entries on fake-indexeddb). Same single-read pattern allEntries()
    // already uses.
    const [local, jobs, verifiedMap] = await Promise.all([allEntries(), allSyncJobs(), allAudioVerifiedAt()]);
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
      if (verifiedMap.has(entry.id)) continue; // already confirmed archived

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
