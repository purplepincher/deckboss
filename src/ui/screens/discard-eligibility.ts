import type { EffectiveLogEntry } from "../../core/types/log-entry";

/**
 * Post-save Discard bar eligibility (Fable memo §1.B). The entry offered for
 * discard is derived from the store's own recent-entries view — never from
 * the capture hook — so this stays pure logic over data RecordScreen already
 * has. `recent` is assumed newest-first (that's query-engine's order), so
 * index 0 is the just-saved entry when one is present.
 *
 * Eligibility, per the memo: voice source and captured within the last 60s.
 * Retracted entries are also excluded — `recent` already filters them out by
 * default, but the guard keeps this function honest if ever called with a
 * list that includes them (double-retracting would just stack corrections).
 */
export function getDiscardableEntry(
  recent: EffectiveLogEntry[],
  now: number,
  maxAgeMs = 60_000,
): EffectiveLogEntry | undefined {
  const newest = recent[0];
  if (!newest) return undefined;
  if (newest.source !== "voice") return undefined;
  if (newest.retracted) return undefined;
  const ageMs = now - new Date(newest.timestamp).getTime();
  if (ageMs < 0 || ageMs > maxAgeMs) return undefined;
  return newest;
}

/** "m:ss" — matches BigRecordButton's elapsed format and the memo's "Saved 0:42". */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
