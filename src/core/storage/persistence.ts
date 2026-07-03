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
