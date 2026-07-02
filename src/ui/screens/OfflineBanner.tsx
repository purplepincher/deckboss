import { useSync } from "../hooks/useSync";

const MESSAGES: Record<string, string> = {
  offline: "Offline — your log is safe on this device and will sync when you're back in harbor",
  syncing: "Syncing...",
  error: "Sync failed — tap to retry",
};

export function OfflineBanner() {
  const { status, pending, runSync } = useSync();

  if (status === "online" && pending === 0) return null;
  if (status === "online" && pending > 0) {
    return (
      <div className="offline-banner syncing" onClick={() => void runSync()}>
        {pending} item{pending === 1 ? "" : "s"} queued to sync
      </div>
    );
  }

  return (
    <div className={`offline-banner ${status}`} onClick={() => void runSync()}>
      {MESSAGES[status] ?? ""}
    </div>
  );
}
