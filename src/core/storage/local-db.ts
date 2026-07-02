import { get, set, del, keys, createStore, type UseStore } from "idb-keyval";
import { LogEntrySchema, type LogEntry } from "../types/log-entry";
import { AppConfigSchema, defaultAppConfig, type AppConfig } from "../../config/schema";
import { SyncJobSchema, type SyncJob } from "../sync/types";

/**
 * The local-only persistence layer (dev guide §4.1: "IndexedDB via
 * idb-keyval — queue for audio, entries, sync jobs"). Everything the app
 * shows or acts on before a sync round-trip lives here. Four stores, one
 * database, kept deliberately flat (id -> value) rather than indexed —
 * query-engine.ts does its filtering in memory after `allEntries()`, which
 * is well within the <100ms/1000-entries budget and avoids IndexedDB cursor
 * complexity for a Phase 1 MVP.
 */

const DB_NAME = "deckboss";
const entryStore: UseStore = createStore(DB_NAME, "entries");
const audioStore: UseStore = createStore(DB_NAME, "audio");
const metaStore: UseStore = createStore(DB_NAME, "meta");
const syncQueueStore: UseStore = createStore(DB_NAME, "sync-queue");

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
