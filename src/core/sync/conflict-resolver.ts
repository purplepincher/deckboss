import type { LogEntry, Correction } from "../types/log-entry";

/**
 * Because edits are additive Correction events (not field overwrites — see
 * log-entry.ts), a same-id conflict between two devices is never "which
 * version wins": it's "union both devices' corrections." Two devices
 * editing the same entry produce two different Correction objects (unique
 * ids), so keeping both is always safe — this is strictly simpler and
 * safer than the dev guide's last-write-wins (§10.2), which would silently
 * drop one device's edit.
 *
 * `local`/`remote` must be the same entry (same id) — core fields
 * (timestamp, gps, audio, source) are capture-time facts and are assumed
 * identical; if they ever differ that's a bug upstream, not something this
 * function should paper over, so it trusts `local`'s core fields.
 */
export function mergeEntries(local: LogEntry, remote: LogEntry): LogEntry {
  const merged = dedupeCorrections([...local.corrections, ...remote.corrections]);
  return { ...local, corrections: merged };
}

function dedupeCorrections(corrections: Correction[]): Correction[] {
  const seen = new Map<string, Correction>();
  for (const c of corrections) {
    if (!seen.has(c.id)) seen.set(c.id, c);
  }
  return [...seen.values()].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

/**
 * True two-device create races on the same *id* are vanishingly rare
 * (UUIDv4) — this only fires if a bug somewhere reused an id. Surfaced so
 * the UI can flag it rather than silently picking one.
 */
export function detectCoreFieldConflict(local: LogEntry, remote: LogEntry): string | null {
  if (local.timestamp !== remote.timestamp) return "timestamp";
  if (local.source !== remote.source) return "source";
  if ((local.audio?.filename ?? null) !== (remote.audio?.filename ?? null)) return "audio";
  return null;
}
