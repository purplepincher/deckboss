import { useCallback, useEffect, useState } from "react";
import { syncNow } from "../../core/sync/sync-engine";
import { pendingJobCount, failedJobCount } from "../../core/sync/queue";
import { useOfflineStatus } from "./useOfflineStatus";
import { useDeckBossStore } from "../../state/store";
import type { SyncStatus } from "../../core/sync/types";
import { recordSyncAttempt, recordSyncFailure, recordEntriesSkipped } from "../../core/diagnostics";

/**
 * OfflineBanner and SettingsScreen both read this. §10.3's four states map
 * directly: offline (grey/yellow), syncing (spinner), online (green,
 * "Synced N min ago" via lastSyncAt), error (red, tap-to-retry via runSync).
 */
export function useSync() {
  const online = useOfflineStatus();
  const [status, setStatus] = useState<SyncStatus>(online ? "online" : "offline");
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    setPending(await pendingJobCount());
    setFailed(await failedJobCount());
  }, []);

  const runSync = useCallback(async () => {
    if (!online) {
      setStatus("offline");
      return;
    }
    setStatus("syncing");
    void recordSyncAttempt();
    try {
      const syncResult = await syncNow();
      setLastSyncAt(new Date().toISOString());
      setStatus("online");
      if (syncResult.skipped > 0) {
        void recordEntriesSkipped(syncResult.skipped);
      }
    } catch {
      setStatus("error");
      void recordSyncFailure();
    } finally {
      // Sync may have appended corrections (e.g. a successful Whisper retry),
      // pulled remote entries, or changed pending-transcript state — refresh
      // the in-memory store so the UI reflects the latest effective view.
      void useDeckBossStore.getState().loadEntries();
      await refreshCounts();
    }
  }, [online, refreshCounts]);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  useEffect(() => {
    if (online) void runSync();
    else setStatus("offline");
    // Deliberately only re-runs when connectivity flips, not on every
    // runSync identity change — this is the "resumes opportunistically"
    // trigger from §10, not a polling loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return { online, status, pending, failed, lastSyncAt, runSync, refreshCounts };
}
