import { useCallback } from "react";
import { buildAdapter } from "../../core/storage/registry";
import { pushAllLocalEntries } from "../../core/sync/sync-engine";
import { getDiagnostics } from "../../core/diagnostics";
import { isStoragePersisted } from "../../core/storage/persistence";
import type { AppConfig } from "../../config/schema";
import type { LocalZipAdapter } from "../../core/storage/adapters/local-zip";
import type { GoogleDriveAdapter, GoogleDriveAuthState } from "../../core/storage/adapters/google-drive";

/**
 * The one place SettingsScreen touches storage-adapter machinery. Wraps
 * registry.buildAdapter() (and the local-zip export flow, which needs a
 * method — exportZip() — that isn't part of the generic StorageAdapter
 * contract) so the screen itself never imports `adapters/*` or the
 * registry directly — see ARCHITECTURE.md ("UI code never imports
 * adapters/* directly. It enqueues a SyncJob and reads status via
 * useSync.") and docs/ROUNDTABLE_SYNTHESIS.md.
 *
 * "Connect" is a legitimate exception to "sync-engine is the only caller
 * of StorageAdapter methods": authenticate() has to run synchronously with
 * a user gesture (Google Drive's OAuth popup gets blocked otherwise), so
 * it can't be queued as a SyncJob the way entry/audio uploads are. This
 * hook is the seam that keeps that exception contained to one place
 * instead of letting the screen reach for the registry itself.
 */
export function useStorage() {
  // Returns the Google Drive auth state to persist when connecting that
  // backend (null otherwise) — the caller is responsible for merging it
  // into config and saving, since this hook doesn't own the store. Without
  // this, a page reload throws away a still-valid OAuth token and silently
  // breaks Drive sync until the user manually reconnects (see registry.ts
  // and google-drive.ts's GoogleDriveAuthState for the full story).
  const connect = useCallback(async (config: AppConfig): Promise<GoogleDriveAuthState | null> => {
    const adapter = await buildAdapter(config);
    await adapter?.authenticate();
    if (config.storage.activeBackend === "google-drive") {
      return (adapter as GoogleDriveAdapter | null)?.getAuthState() ?? null;
    }
    return null;
  }, []);

  const exportZip = useCallback(async (config: AppConfig): Promise<Blob> => {
    // Push whatever's local up to the (now-active) local-zip adapter first
    // — see registry.ts's doc comment: this and the write below must land
    // on the same cached adapter instance, or the .zip ships without the
    // entries.
    await pushAllLocalEntries();

    const adapter = await buildAdapter(config);
    if (!adapter || adapter.id !== "local-zip") {
      throw new Error("Export requires the local export (.zip) backend to be active.");
    }
    const zipAdapter = adapter as LocalZipAdapter;

    // Bundled so a fisherman can hit one button and send the resulting
    // .zip when something seems wrong, without needing to know what
    // GitHub is — this is the whole support path for the field beta.
    const currentDiagnostics = await getDiagnostics();
    const persistedNow = await isStoragePersisted();
    await zipAdapter.writeFile(
      "diagnostics.json",
      JSON.stringify({ ...currentDiagnostics, storagePersisted: persistedNow }, null, 2),
    );

    return zipAdapter.exportZip();
  }, []);

  return { connect, exportZip };
}
