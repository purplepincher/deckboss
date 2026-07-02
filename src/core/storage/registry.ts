import type { StorageAdapter } from "./interface";
import { LocalZipAdapter } from "./adapters/local-zip";
import { GoogleDriveAdapter } from "./adapters/google-drive";
import { CloudflareR2Adapter } from "./adapters/cloudflare-r2";
import { OracleOciAdapter } from "./adapters/oracle-oci";
import type { AppConfig } from "../../config/schema";

/**
 * The only place StorageBackendId gets turned into a live StorageAdapter.
 * sync-engine.ts calls this once per sync attempt (config can change
 * between attempts if the user switches backends in Settings) — it never
 * imports a concrete adapter class itself.
 */
export function buildAdapter(config: AppConfig): StorageAdapter | null {
  switch (config.storage.activeBackend) {
    case "local-zip":
      return new LocalZipAdapter();

    case "google-drive": {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
      return new GoogleDriveAdapter(clientId ?? "");
    }

    case "cloudflare-r2": {
      const c = config.storage.cloudflareR2;
      if (!c?.endpoint || !c.bucket || !c.accessKeyId || !c.secretAccessKey) return null;
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
