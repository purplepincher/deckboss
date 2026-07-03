import { create } from "zustand";
import {
  allEntries,
  putEntry as putEntryLocal,
  getEntry,
  getConfig,
  setConfig as persistConfig,
} from "../core/storage/local-db";
import { applyCorrections, buildAmendCorrection, buildRetractCorrection } from "../core/tensor-log/entry-builder";
import { enqueueEntryForSync, pendingWhisperRetryEntryIds } from "../core/sync/sync-engine";
import { defaultAppConfig, type AppConfig } from "../config/schema";
import type { LogEntry, EffectiveLogEntry, EditableFields } from "../core/types/log-entry";

/**
 * The single in-memory source of truth the UI reads from. `entries` is
 * always the *effective* (corrections-applied) view — see
 * ARCHITECTURE.md: nothing above local-db is allowed to read raw
 * `LogEntry.corrections` directly. Loaded once at startup; every write
 * goes through saveEntry(), which re-reads from IndexedDB so the store
 * never drifts from what's actually persisted.
 *
 * `amendEntry`/`retractEntry` are the *only* way a screen appends a
 * Correction. The raw `LogEntry` is read, mutated, and persisted entirely
 * inside the store (via saveEntry(), same as every other write) — it
 * never leaves the store. This closes the write-path seam flagged in
 * docs/ROUNDTABLE_SYNTHESIS.md: previously EntryDetailScreen imported
 * getEntry/buildAmendCorrection/buildRetractCorrection/enqueueEntryForSync
 * directly from core and hand-mutated `corrections` itself — exactly the
 * kind of raw-entry access ARCHITECTURE.md says shouldn't happen above
 * entry-builder.ts.
 */
interface DeckBossStore {
  entries: EffectiveLogEntry[];
  entriesLoaded: boolean;
  loadEntries: () => Promise<void>;
  saveEntry: (entry: LogEntry) => Promise<void>;
  amendEntry: (id: string, fields: EditableFields, reason?: string) => Promise<void>;
  retractEntry: (id: string, reason?: string) => Promise<void>;

  config: AppConfig;
  configLoaded: boolean;
  loadConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
}

// Cache the corrections-applied view so repeated `loadEntries()` calls only
// re-fold entries whose corrections actually changed. Since a `LogEntry` is
// immutable except for additive corrections, the signature of its corrections
// array is enough to detect change.
const effectiveCache = new Map<string, EffectiveLogEntry>();
const correctionSignature = new Map<string, string>();

function correctionsSig(entry: LogEntry): string {
  const cs = entry.corrections;
  return `${cs.length}:${cs[cs.length - 1]?.id ?? ""}`;
}

export const useDeckBossStore = create<DeckBossStore>((set, get) => ({
  entries: [],
  entriesLoaded: false,
  loadEntries: async () => {
    const [raw, pendingWhisper] = await Promise.all([allEntries(), pendingWhisperRetryEntryIds()]);
    const next: EffectiveLogEntry[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
      seen.add(entry.id);
      const sig = correctionsSig(entry);
      const cached = effectiveCache.get(entry.id);
      if (cached && correctionSignature.get(entry.id) === sig) {
        const wantsPending: "whisper_retry" | null = pendingWhisper.has(entry.id) ? "whisper_retry" : null;
        if (cached.pendingTranscript !== wantsPending) {
          const updated = { ...cached, pendingTranscript: wantsPending };
          effectiveCache.set(entry.id, updated);
          next.push(updated);
        } else {
          next.push(cached);
        }
      } else {
        const effective = applyCorrections(entry);
        if (pendingWhisper.has(entry.id)) {
          effective.pendingTranscript = "whisper_retry";
        }
        effectiveCache.set(entry.id, effective);
        correctionSignature.set(entry.id, sig);
        next.push(effective);
      }
    }

    for (const id of effectiveCache.keys()) {
      if (!seen.has(id)) {
        effectiveCache.delete(id);
        correctionSignature.delete(id);
      }
    }

    set({ entries: next, entriesLoaded: true });
  },
  saveEntry: async (entry) => {
    await putEntryLocal(entry);
    await get().loadEntries();
  },
  amendEntry: async (id, fields, reason) => {
    const raw = await getEntry(id);
    if (!raw) return; // entry gone locally — nothing to amend, matches prior screen-level behavior
    const { config } = get();
    const next: LogEntry = {
      ...raw,
      corrections: [...raw.corrections, buildAmendCorrection(fields, config.deviceId, reason)],
    };
    await get().saveEntry(next);
    await enqueueEntryForSync(next.id);
  },
  retractEntry: async (id, reason) => {
    const raw = await getEntry(id);
    if (!raw) return; // entry gone locally — nothing to retract
    const { config } = get();
    const next: LogEntry = {
      ...raw,
      corrections: [...raw.corrections, buildRetractCorrection(config.deviceId, reason)],
    };
    await get().saveEntry(next);
    await enqueueEntryForSync(next.id);
  },

  config: defaultAppConfig(),
  configLoaded: false,
  loadConfig: async () => {
    const config = await getConfig();
    set({ config, configLoaded: true });
  },
  saveConfig: async (config) => {
    await persistConfig(config);
    set({ config });
  },
}));
