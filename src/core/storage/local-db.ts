import { get, set, del, keys, createStore, type UseStore } from "idb-keyval";
import { LogEntrySchema, type LogEntry } from "../types/log-entry";
import { AppConfigSchema, defaultAppConfig, type AppConfig } from "../../config/schema";
import { SyncJobSchema, type SyncJob } from "../sync/types";

/**
 * The local-only persistence layer (dev guide §4.1: "IndexedDB via
 * idb-keyval — queue for audio, entries, sync jobs"). Everything the app
 * shows or acts on before a sync round-trip lives here. Kept deliberately
 * flat (id -> value) rather than indexed — query-engine.ts does its
 * filtering in memory after `allEntries()`, which is well within the
 * <100ms/1000-entries budget and avoids IndexedDB cursor complexity for a
 * Phase 1 MVP.
 *
 * Each store gets its OWN database rather than sharing one "deckboss" db
 * with four object stores. idb-keyval's createStore(dbName, storeName)
 * calls `indexedDB.open(dbName)` with no explicit version; when multiple
 * createStore calls share a dbName, only the first request's upgradeneeded
 * actually fires and creates its object store — the other three stores
 * never get created, and every read/write against them throws "One of the
 * specified object stores was not found." (confirmed in production: this
 * broke entry persistence and the config read, which cascaded into the
 * Timeline screen hanging on "Loading…" forever and a false "Sync failed"
 * banner on first load). One database per store sidesteps the shared-open
 * race entirely.
 */

const entryStore: UseStore = createStore("deckboss-entries", "entries");
const audioStore: UseStore = createStore("deckboss-audio", "audio");
const metaStore: UseStore = createStore("deckboss-meta", "meta");
const syncQueueStore: UseStore = createStore("deckboss-sync-queue", "sync-queue");

const CONFIG_KEY = "app-config";

// ---- Entries -----------------------------------------------------------

export async function putEntry(entry: LogEntry): Promise<void> {
  LogEntrySchema.parse(entry); // throws on shape drift — catch bugs at the write, not the read
  await set(entry.id, entry, entryStore);
}

export async function getEntry(id: string): Promise<LogEntry | undefined> {
  return get(id, entryStore);
}

export async function allEntries(): Promise<LogEntry[]> {
  const ks = await keys(entryStore);
  const vals = await Promise.all(ks.map((k) => get(k, entryStore)));
  const out: LogEntry[] = [];
  for (const v of vals) {
    const result = LogEntrySchema.safeParse(v);
    if (result.success) {
      out.push(result.data);
    } else {
      console.warn("Skipping corrupt local entry", v, result.error);
    }
  }
  return out;
}

// ---- Audio blobs ---------------------------------------------------------

export async function putAudioBlob(entryId: string, blob: Blob): Promise<void> {
  await set(entryId, blob, audioStore);
}

export async function getAudioBlob(entryId: string): Promise<Blob | undefined> {
  return get(entryId, audioStore);
}

export async function deleteAudioBlob(entryId: string): Promise<void> {
  await del(entryId, audioStore);
}

export async function audioStorageBytes(): Promise<number> {
  const ks = await keys(audioStore);
  const blobs = await Promise.all(ks.map((k) => get<Blob>(k, audioStore)));
  return blobs.reduce((sum, b) => sum + (b?.size ?? 0), 0);
}

// ---- App config (local-only, never synced — see config/schema.ts) --------

export async function getConfig(): Promise<AppConfig> {
  const raw = await get(CONFIG_KEY, metaStore);
  if (!raw) return defaultAppConfig();
  const result = AppConfigSchema.safeParse(raw);
  return result.success ? result.data : defaultAppConfig();
}

export async function setConfig(config: AppConfig): Promise<void> {
  AppConfigSchema.parse(config);
  await set(CONFIG_KEY, config, metaStore);
}

// ---- Sync queue ------------------------------------------------------

export async function enqueueSyncJob(job: SyncJob): Promise<void> {
  SyncJobSchema.parse(job);
  await set(job.id, job, syncQueueStore);
}

export async function updateSyncJob(job: SyncJob): Promise<void> {
  await set(job.id, job, syncQueueStore);
}

export async function removeSyncJob(id: string): Promise<void> {
  await del(id, syncQueueStore);
}

export async function allSyncJobs(): Promise<SyncJob[]> {
  const ks = await keys(syncQueueStore);
  const vals = await Promise.all(ks.map((k) => get(k, syncQueueStore)));
  return vals
    .map((v) => SyncJobSchema.safeParse(v))
    .filter((r): r is { success: true; data: SyncJob } => r.success)
    .map((r) => r.data);
}
