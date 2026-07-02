import type { EffectiveLogEntry, EntityType, EntrySource } from "../types/log-entry";
import { distanceKm } from "../../utils/gps";

export interface QueryParams {
  text?: string; // full-text, case-insensitive substring match on transcript (Phase 1; Phase 2 indexes it)
  startDate?: Date; // inclusive
  endDate?: Date; // inclusive
  near?: { lat: number; lon: number; radiusKm: number };
  entities?: EntityType[];
  tags?: string[];
  source?: EntrySource;
  includeRetracted?: boolean; // default false — retracted entries are hidden, not deleted
  limit?: number; // default 100
  offset?: number; // default 0
}

const DEFAULT_LIMIT = 100;

/**
 * Pure, synchronous filter over an already-loaded array — the caller (a
 * React hook backed by the IndexedDB store, task #6) owns fetching and
 * applyCorrections(); this function never touches storage. That split is
 * what makes the "<100ms for 1000 entries" budget trivial: it's just array
 * filtering, no I/O in the hot path.
 */
export function queryEntries(
  entries: EffectiveLogEntry[],
  params: QueryParams = {},
): EffectiveLogEntry[] {
  const text = params.text?.trim().toLowerCase();

  let results = entries.filter((e) => {
    if (!params.includeRetracted && e.retracted) return false;

    if (text && !(e.transcript?.text.toLowerCase().includes(text) ?? false)) return false;

    const t = new Date(e.timestamp);
    if (params.startDate && t < params.startDate) return false;
    if (params.endDate && t > params.endDate) return false;

    if (params.near && e.gps) {
      const d = distanceKm(
        { lat: params.near.lat, lon: params.near.lon },
        { lat: e.gps.latitude, lon: e.gps.longitude },
      );
      if (d > params.near.radiusKm) return false;
    } else if (params.near && !e.gps) {
      return false;
    }

    if (params.entities && params.entities.length > 0) {
      const have = new Set(e.entities.map((en) => en.type));
      if (!params.entities.some((needed) => have.has(needed))) return false;
    }

    if (params.tags && params.tags.length > 0) {
      if (!params.tags.some((tag) => e.tags.includes(tag))) return false;
    }

    if (params.source && e.source !== params.source) return false;

    return true;
  });

  results = results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const offset = params.offset ?? 0;
  const limit = params.limit ?? DEFAULT_LIMIT;
  return results.slice(offset, offset + limit);
}
