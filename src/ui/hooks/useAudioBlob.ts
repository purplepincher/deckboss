import { useEffect, useState } from "react";
import { getAudioBlob } from "../../core/storage/local-db";

/**
 * Loads the audio blob for a given entry id (and reloads when id changes).
 * Kept as a hook rather than a direct `local-db` import in screens so the
 * read side follows the same seam the write side now does — see
 * amendEntry/retractEntry in state/store.ts and ARCHITECTURE.md's module
 * graph, where IndexedDB access lives below the UI layer.
 */
export function useAudioBlob(id: string | undefined): Blob | null {
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (!id) {
      setBlob(null);
      return;
    }
    let cancelled = false;
    void getAudioBlob(id).then((b) => {
      if (!cancelled) setBlob(b ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return blob;
}
