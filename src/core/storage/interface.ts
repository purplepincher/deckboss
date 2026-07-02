import { z } from "zod";
import { isoDateString } from "../types/common";

/**
 * ============================================================================
 * STORAGE ADAPTER CONTRACT
 * ============================================================================
 *
 * Every cloud backend (Google Drive, Cloudflare R2, Oracle OCI) and the
 * zero-auth Local ZIP export implement this exact interface. sync-engine.ts
 * is written against StorageAdapter only — it never imports a concrete
 * adapter. This is what makes storage "shell-agnostic": swapping backends
 * means swapping which adapter registry.ts hands to the sync engine, nothing
 * else changes.
 *
 * SECURITY BOUNDARY: adapters take credentials at construction time (from
 * IndexedDB via the local-only settings store — see config/schema.ts) and
 * hold them in memory. No adapter, and nothing it writes through
 * writeManifest/writeFile, may ever place a secret (API key, OAuth token,
 * client secret) into a file that lands in the user's cloud storage. The
 * manifest and entry files are meant to be readable by any tool, including
 * ones with no notion of "this app's credentials."
 */

export const StorageBackendIdSchema = z.enum([
  "google-drive",
  "cloudflare-r2",
  "oracle-oci",
  "local-zip",
]);
export type StorageBackendId = z.infer<typeof StorageBackendIdSchema>;

export const FileMetadataSchema = z.object({
  path: z.string(),
  size: z.number().nonnegative(),
  modifiedAt: isoDateString,
  hash: z.string().optional(), // sha256, for conflict/change detection
});
export type FileMetadata = z.infer<typeof FileMetadataSchema>;

export const ManifestSchema = z.object({
  version: z.string(),
  generatedAt: isoDateString,
  entries: z.array(FileMetadataSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export interface StorageAdapter {
  readonly id: StorageBackendId;
  readonly displayName: string;
  readonly icon: string; // emoji or SVG path, rendered in SettingsScreen

  // Authentication
  isAuthenticated(): Promise<boolean>;
  authenticate(): Promise<void>;
  logout(): Promise<void>;

  // Text file operations (Markdown entries, manifest.json, config.yaml)
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(prefix: string): Promise<FileMetadata[]>; // recursive

  // Binary attachments (audio)
  readBlob(path: string): Promise<Blob>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  deleteBlob(path: string): Promise<void>;

  // Sync helpers
  getManifest(): Promise<Manifest>;
  writeManifest(manifest: Manifest): Promise<void>;
}

/**
 * Path layout every adapter writes, regardless of backend. Matches the dev
 * guide §3.1 exactly so a user's Drive folder is human-browseable:
 *
 *   DeckBoss/
 *     2026/07/02/{filename}.md
 *     .deckboss/manifest.json
 *     .deckboss/config.yaml
 *     .deckboss/attachments/{filename}_audio.webm
 */
export const STORAGE_ROOT = "DeckBoss";
export const MANIFEST_PATH = ".deckboss/manifest.json";
export const ATTACHMENTS_DIR = ".deckboss/attachments";

export function entryPath(timestamp: string, id: string): string {
  const d = new Date(timestamp);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${STORAGE_ROOT}/${yyyy}/${mm}/${dd}/${id}.md`;
}

export function audioPath(id: string, ext: string): string {
  return `${ATTACHMENTS_DIR}/${id}_audio.${ext}`;
}
