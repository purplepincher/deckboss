import { useEffect, useState } from "react";
import { rehydrateAudioForEntry } from "../../core/sync/sync-engine";

/**
 * Loads the audio blob for a given entry id (and reloads when id changes).
 * Kept as a hook rather than a direct `local-db` import in screens so the
 * read side follows the same seam the write side now does — see
 * amendEntry/retractEntry in state/store.ts and ARCHITECTURE.md's module
 * graph, where IndexedDB access lives below the UI layer.
 *
 * DESIGN DECISION: lazy-on-access rehydration.
 *
 * DeckBoss is offline-first and treats the configured cloud archive as
 * canonical. A fresh device recovers all entry text from the manifest, but
 * its local IndexedDB has no audio blobs. Rather than a bulk background
 * sweep that would download every recording a user might never revisit,
 * we rehydrate audio only when it is actually accessed (a screen opens an
 * entry with audio). The first access fetches the blob from the archive via
 * the active StorageAdapter, writes it back into the local audio store, and
 * from then on reads locally. This keeps recovery bandwidth proportional to
 * actual use, preserves the "never destroy a capture" ethos by making every
 * archived blob reachable again, and fails gracefully (no audio UI) if the
 * archive cannot be reached.
 */
export function useAudioBlob(id: string | undefined): { blob: Blob | null; loading: boolean } {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setBlob(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void rehydrateAudioForEntry(id).then(
      (b) => {
        if (!cancelled) {
          setBlob(b ?? null);
          setLoading(false);
        }
      },
      () => {
        if (!cancelled) setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { blob, loading };
}
