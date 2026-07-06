import { z } from "zod";
import { get, set, createStore, type UseStore } from "idb-keyval";

/**
 * Local-only usage counters — never sent anywhere, never touch a
 * StorageAdapter, exist purely so a fisherman having a bad day can export
 * one file and a maintainer can tell "the app is failing" from "nothing's
 * wrong, don't need them to reconstruct a timeline from memory over the phone. This
 * is the field-beta support path: Settings → Export ZIP already exists;
 * this makes it carry the data that turns "it's broken" into something
 * actionable.
 */

const DiagnosticsSchema = z.object({
  recordingsStarted: z.number().int().nonnegative(),
  recordingsCompleted: z.number().int().nonnegative(),
  recordingsFailed: z.number().int().nonnegative(),
  syncAttempts: z.number().int().nonnegative(),
  syncFailures: z.number().int().nonnegative(),
  entriesSkipped: z.number().int().nonnegative(),
  firstEventAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
});
export type Diagnostics = z.infer<typeof DiagnosticsSchema>;

function defaultDiagnostics(): Diagnostics {
  return {
    recordingsStarted: 0,
    recordingsCompleted: 0,
    recordingsFailed: 0,
    syncAttempts: 0,
    syncFailures: 0,
    entriesSkipped: 0,
    firstEventAt: null,
    lastEventAt: null,
  };
}

const diagnosticsStore: UseStore = createStore("deckboss-diagnostics", "diagnostics");
const KEY = "counters";

export async function getDiagnostics(): Promise<Diagnostics> {
  const raw = await get(KEY, diagnosticsStore);
  const result = DiagnosticsSchema.safeParse(raw);
  return result.success ? result.data : defaultDiagnostics();
}

async function bump(field: keyof Omit<Diagnostics, "firstEventAt" | "lastEventAt">): Promise<void> {
  const current = await getDiagnostics();
  const now = new Date().toISOString();
  const next: Diagnostics = {
    ...current,
    [field]: current[field] + 1,
    firstEventAt: current.firstEventAt ?? now,
    lastEventAt: now,
  };
  await set(KEY, next, diagnosticsStore);
}

export const recordRecordingStarted = () => bump("recordingsStarted");
export const recordRecordingCompleted = () => bump("recordingsCompleted");
export const recordRecordingFailed = () => bump("recordingsFailed");
export const recordSyncAttempt = () => bump("syncAttempts");
export const recordSyncFailure = () => bump("syncFailures");

/** Increment `entriesSkipped` by the given amount (not just 1). */
export async function recordEntriesSkipped(count: number): Promise<void> {
  const current = await getDiagnostics();
  const now = new Date().toISOString();
  const next: Diagnostics = {
    ...current,
    entriesSkipped: current.entriesSkipped + count,
    firstEventAt: current.firstEventAt ?? now,
    lastEventAt: now,
  };
  await set(KEY, next, diagnosticsStore);
}
