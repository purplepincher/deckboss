import { useCallback, useEffect, useState } from "react";
import { syncNow } from "../../core/sync/sync-engine";
import { pendingJobCount, failedJobCount } from "../../core/sync/queue";
import { useOfflineStatus } from "./useOfflineStatus";
import type { SyncStatus } from "../../core/sync/types";
import { recordSyncAttempt, recordSyncFailure } from "../../core/diagnostics";

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
      await syncNow();
      setLastSyncAt(new Date().toISOString());
      setStatus("online");
    } catch {
      setStatus("error");
      void recordSyncFailure();
    } finally {
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
