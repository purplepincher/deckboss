export function nowIso(): string {
  return new Date().toISOString();
}

export function toDayPath(timestamp: string): { yyyy: string; mm: string; dd: string } {
  const d = new Date(timestamp);
  return {
    yyyy: String(d.getUTCFullYear()),
    mm: String(d.getUTCMonth() + 1).padStart(2, "0"),
    dd: String(d.getUTCDate()).padStart(2, "0"),
  };
}

/** "2 hours ago" / "3 days ago" — matches LogCard's relative-timestamp mode. */
export function relativeTime(timestamp: string, now: Date = new Date()): string {
  const then = new Date(timestamp).getTime();
  const diffSec = Math.max(0, Math.floor((now.getTime() - then) / 1000));

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatClock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isWithinRange(timestamp: string, start?: Date, end?: Date): boolean {
  const t = new Date(timestamp).getTime();
  if (start && t < start.getTime()) return false;
  if (end && t > end.getTime()) return false;
  return true;
}
