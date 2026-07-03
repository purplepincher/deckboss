import { get, set, del, keys, values, createStore, type UseStore } from "idb-keyval";
import { LogEntrySchema, type LogEntry } from "../types/log-entry";
import { SCHEMA_VERSION } from "../types/common";
import { AppConfigSchema, defaultAppConfig, type AppConfig } from "../../config/schema";
import { SyncJobSchema, type SyncJob } from "../sync/types";
import { assertWriteIsAdditive } from "../tensor-log/invariants";

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

// Per-id async mutex: putEntry() does read-check-write (get existing,
// assertWriteIsAdditive, set), which is a classic lost-update race if two
// writes for the *same* entry overlap — e.g. a sync pull merging a remote
// correction while the UI amends the same entry. Both would read the same
// `existing`, both would pass the additive check against that stale
// value, and whichever `set()` finishes second would silently discard the
// other's write. Caught in a multi-model review round; previously
// unreachable in practice because sync silently never ran at all (see the
// registry.ts adapter-caching fix) — now that sync actually works, this
// race is live. Each id gets its own queue so unrelated entries still
// write concurrently; only same-id writes serialize.
const entryLocks = new Map<string, Promise<void>>();

function withEntryLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = entryLocks.get(id) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  entryLocks.set(
    id,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

export async function putEntry(entry: LogEntry): Promise<void> {
  LogEntrySchema.parse(entry); // throws on shape drift — catch bugs at the write, not the read
  await withEntryLock(entry.id, async () => {
    const existing = await get<LogEntry>(entry.id, entryStore);
    // The one invariant the whole product's trustworthiness rests on:
    // committed entries are never mutated, only appended to. Enforced
    // here, in the single write path, regardless of whether the caller is
    // the UI (amend/retract) or sync-engine (pulling and merging a remote
    // copy).
    assertWriteIsAdditive(existing, entry);
    await set(entry.id, entry, entryStore);
  });
}

export async function getEntry(id: string): Promise<LogEntry | undefined> {
  return get(id, entryStore);
}

/**
 * Fast-path guard for entries written by this version of the app.
 * `putEntry()` already runs the full Zod schema on write, so on read we can
 * trust records whose `version` matches the current schema version and whose
 * shape looks right. This avoids the O(n) Zod re-parse that showed up in
 * beta profiling at ~800 entries. Anything with a mismatched/missing version
 * or an unexpected shape falls back to `LogEntrySchema.safeParse()` so corrupt
 * records are still skipped rather than crashing downstream.
 */
function isCurrentLogEntry(v: unknown): v is LogEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    e.version === SCHEMA_VERSION &&
    typeof e.id === "string" &&
    typeof e.timestamp === "string" &&
    Array.isArray(e.corrections) &&
    typeof e.source === "string" &&
    Array.isArray(e.entities) &&
    Array.isArray(e.tags) &&
    typeof e.thread_id === "string" &&
    (e.gps === null || typeof e.gps === "object") &&
    (e.audio === null || typeof e.audio === "object") &&
    (e.transcript === null || typeof e.transcript === "object")
  );
}

export async function allEntries(): Promise<LogEntry[]> {
  // Read every value in a single readonly transaction. The previous
  // per-key `get()` loop created a transaction for each record; at 800+
  // entries that overhead dominated the Timeline load in addition to the
  // Zod re-parse this function used to run unconditionally.
  const vals = await values<unknown>(entryStore);
  const out: LogEntry[] = [];
  for (const v of vals) {
    if (isCurrentLogEntry(v)) {
      out.push(v);
    } else {
      const result = LogEntrySchema.safeParse(v);
      if (result.success) {
        out.push(result.data);
      } else {
        console.warn("Skipping corrupt local entry", v, result.error);
      }
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

// ---- Startup integrity check --------------------------------------------

export interface StoreIntegrityResult {
  ok: boolean;
  failedStores: string[];
}

/**
 * Verifies every object store this app depends on is actually queryable.
 * Exists because of a real shipped bug: four stores used to share one
 * IndexedDB database name, so three of four silently never got created,
 * and every read/write against them threw "object store was not found" —
 * with no visible symptom beyond a confusing "Sync failed" banner and a
 * Timeline stuck on "Loading…" forever. That failure mode (a season of
 * a fisherman's records silently gone) is the worst-case outcome this
 * product has; this check exists so it fails loudly, once, at launch,
 * instead of quietly breaking every write from then on. Call once from
 * App.tsx on mount.
 */
export async function verifyStoreIntegrity(): Promise<StoreIntegrityResult> {
  const stores: [string, UseStore][] = [
    ["entries", entryStore],
    ["audio", audioStore],
    ["meta", metaStore],
    ["sync-queue", syncQueueStore],
  ];

  const failedStores: string[] = [];
  for (const [name, store] of stores) {
    try {
      await keys(store);
    } catch {
      failedStores.push(name);
    }
  }
  return { ok: failedStores.length === 0, failedStores };
}
