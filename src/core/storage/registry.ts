import type { StorageAdapter } from "./interface";
import type { AppConfig } from "../../config/schema";

/**
 * The only place StorageBackendId gets turned into a live StorageAdapter.
 * sync-engine.ts calls this once per sync attempt (config can change
 * between attempts if the user switches backends in Settings) — it never
 * imports a concrete adapter class itself.
 *
 * Dynamic import()s, not static ones: a Lighthouse audit found 65% of the
 * main bundle going unused on a typical load, dominated by
 * @aws-sdk/client-s3 (pulled in for the R2/Oracle adapters) sitting in
 * every user's bundle even though most sessions never touch those
 * backends. This function is async now so each adapter's code only
 * downloads and parses when actually selected.
 *
 * Cached by config, not rebuilt on every call: a real bug (found by a
 * multi-model review round) — constructing a fresh adapter instance per
 * call meant every adapter's in-memory auth state (S3CompatibleAdapter's
 * `verified` flag, GoogleDriveAdapter's `accessToken`) was thrown away
 * immediately after `authenticate()` set it, so `isAuthenticated()` on
 * the *next* call always saw a brand-new, never-authenticated instance —
 * sync silently no-op'd for every network backend, permanently, the
 * moment "Connect" finished. The same statelessness meant
 * SettingsScreen.exportZip()'s push-entries step and its own
 * write-diagnostics-and-zip step were writing into two different
 * LocalZipAdapter instances, so the exported .zip never actually
 * contained the log entries, only diagnostics.json. One cache, keyed by
 * the config that would otherwise construct a fresh instance, fixes both:
 * the same instance now serves every call until the user actually changes
 * backend or credentials.
 */

let cached: { key: string; adapter: StorageAdapter } | null = null;

function cacheKey(config: AppConfig): string {
  // Only the fields that actually determine adapter identity/credentials —
  // not the whole AppConfig (transcription settings changing shouldn't
  // invalidate a live, authenticated storage connection).
  return JSON.stringify({
    backend: config.storage.activeBackend,
    googleDrive: config.storage.googleDrive,
    r2: config.storage.cloudflareR2,
    oracle: config.storage.oracleOci,
  });
}

export async function buildAdapter(config: AppConfig): Promise<StorageAdapter | null> {
  const key = cacheKey(config);
  if (cached && cached.key === key) return cached.adapter;

  const adapter = await construct(config);
  cached = adapter ? { key, adapter } : null;
  return adapter;
}

/** Settings screens call this after a user explicitly disconnects a backend, so a stale cached instance can't outlive its credentials. */
export function clearAdapterCache(): void {
  cached = null;
}

async function construct(config: AppConfig): Promise<StorageAdapter | null> {
  switch (config.storage.activeBackend) {
    case "local-zip": {
      const { LocalZipAdapter } = await import("./adapters/local-zip");
      return new LocalZipAdapter();
    }

    case "google-drive": {
      const { GoogleDriveAdapter } = await import("./adapters/google-drive");
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
      const gd = config.storage.googleDrive;
      const existingToken =
        gd?.accessToken && typeof gd.tokenExpiresAt === "number"
          ? { accessToken: gd.accessToken, tokenExpiresAt: gd.tokenExpiresAt }
          : null;
      return new GoogleDriveAdapter(clientId ?? "", existingToken);
    }

    case "cloudflare-r2": {
      const c = config.storage.cloudflareR2;
      if (!c?.endpoint || !c.bucket || !c.accessKeyId || !c.secretAccessKey) return null;
      const { CloudflareR2Adapter } = await import("./adapters/cloudflare-r2");
      return new CloudflareR2Adapter({
        endpoint: c.endpoint,
        bucket: c.bucket,
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      });
    }

    case "oracle-oci": {
      const c = config.storage.oracleOci;
      if (!c?.endpoint || !c.bucket || !c.accessKeyId || !c.secretAccessKey) return null;
      const { OracleOciAdapter } = await import("./adapters/oracle-oci");
      return new OracleOciAdapter({
        endpoint: c.endpoint,
        bucket: c.bucket,
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        region: "us-ashburn-1",
      });
    }

    case null:
    default:
      return null;
  }
}
