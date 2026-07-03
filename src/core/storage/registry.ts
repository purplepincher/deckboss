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
 */
export async function buildAdapter(config: AppConfig): Promise<StorageAdapter | null> {
  switch (config.storage.activeBackend) {
    case "local-zip": {
      const { LocalZipAdapter } = await import("./adapters/local-zip");
      return new LocalZipAdapter();
    }

    case "google-drive": {
      const { GoogleDriveAdapter } = await import("./adapters/google-drive");
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
      return new GoogleDriveAdapter(clientId ?? "");
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
