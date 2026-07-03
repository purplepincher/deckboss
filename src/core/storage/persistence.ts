/**
 * Without this, browsers can evict IndexedDB under storage pressure, and
 * Safari specifically evicts script-writable storage — including
 * IndexedDB — for web content not installed to the home screen after
 * roughly a week of non-use. A fisherman who bookmarks DeckBoss instead of
 * installing it as a PWA can lose everything by taking a normal week off
 * between trips. `navigator.storage.persist()` asks the browser to exempt
 * this origin from that eviction; it's best-effort (the browser can still
 * say no, and on iOS it's granted automatically once the PWA is installed
 * to the home screen, denied otherwise) — call it at boot and surface the
 * result so onboarding can catch "not persisted" before it becomes a
 * silent data-loss report weeks later.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isStoragePersisted(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number | null; // null when the browser won't report one
}

/**
 * `audioStorageBytes()` (local-db.ts) existed with no UI surfacing it —
 * flagged in a Fable strategic review as a real pre-beta gap: a fisherman
 * has no way to see local storage filling up before the browser starts
 * refusing new recordings. `navigator.storage.estimate()` is the browser's
 * own quota accounting, best-effort and not universally supported, so this
 * degrades to "usage only, no quota" rather than throwing.
 */
export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usageBytes: usage ?? 0, quotaBytes: quota ?? null };
  } catch {
    return null;
  }
}
