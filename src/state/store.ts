import { create } from "zustand";
import {
  allEntries,
  putEntry as putEntryLocal,
  getConfig,
  setConfig as persistConfig,
} from "../core/storage/local-db";
import { applyCorrections } from "../core/tensor-log/entry-builder";
import { defaultAppConfig, type AppConfig } from "../config/schema";
import type { LogEntry, EffectiveLogEntry } from "../core/types/log-entry";

/**
 * The single in-memory source of truth the UI reads from. `entries` is
 * always the *effective* (corrections-applied) view — see
 * ARCHITECTURE.md: nothing above local-db is allowed to read raw
 * `LogEntry.corrections` directly. Loaded once at startup; every write
 * goes through saveEntry(), which re-reads from IndexedDB so the store
 * never drifts from what's actually persisted.
 */
interface DeckBossStore {
  entries: EffectiveLogEntry[];
  entriesLoaded: boolean;
  loadEntries: () => Promise<void>;
  saveEntry: (entry: LogEntry) => Promise<void>;

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
    const raw = await allEntries();
    const next: EffectiveLogEntry[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
      seen.add(entry.id);
      const sig = correctionsSig(entry);
      const cached = effectiveCache.get(entry.id);
      if (cached && correctionSignature.get(entry.id) === sig) {
        next.push(cached);
      } else {
        const effective = applyCorrections(entry);
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
