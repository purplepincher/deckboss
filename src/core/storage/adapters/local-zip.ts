import JSZip from "jszip";
import type { StorageAdapter, FileMetadata, Manifest } from "../interface";
import { MANIFEST_PATH } from "../interface";

/**
 * The zero-setup backend: no OAuth, no credentials, works the moment
 * someone opens the app. It's a virtual filesystem in memory that
 * exportZip()/importZip() bundle to/from an actual .zip file on the user's
 * device — matching dev guide §8.3 ("Export: bundle DeckBoss/ into ZIP,
 * trigger download. Import: read ZIP, merge into IndexedDB").
 *
 * It still implements the full StorageAdapter contract (not just
 * export/import) so sync-engine.ts can drive it through the identical code
 * path as Drive/R2/Oracle — "storage backend" and "batch snapshot" are the
 * same shape here, just with an explicit flush point instead of a live
 * network round-trip.
 */
export class LocalZipAdapter implements StorageAdapter {
  readonly id = "local-zip" as const;
  readonly displayName = "Local Export (.zip)";
  readonly icon = "📦";

  private files = new Map<string, string>();
  private blobs = new Map<string, Blob>();

  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  async authenticate(): Promise<void> {
    // no-op — nothing to authenticate against
  }

  async logout(): Promise<void> {
    this.files.clear();
    this.blobs.clear();
  }

  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`File not found: ${path}`);
    return v;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listFiles(prefix: string): Promise<FileMetadata[]> {
    const now = new Date().toISOString();
    return [...this.files.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, content]) => ({ path: p, size: new Blob([content]).size, modifiedAt: now }));
  }

  async readBlob(path: string): Promise<Blob> {
    const b = this.blobs.get(path);
    if (!b) throw new Error(`Blob not found: ${path}`);
    return b;
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    this.blobs.set(path, blob);
  }

  async deleteBlob(path: string): Promise<void> {
    this.blobs.delete(path);
  }

  async getManifest(): Promise<Manifest> {
    const raw = this.files.get(MANIFEST_PATH);
    if (!raw) return { version: "1.0", generatedAt: new Date().toISOString(), entries: [] };
    return JSON.parse(raw) as Manifest;
  }

  async writeManifest(manifest: Manifest): Promise<void> {
    this.files.set(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }

  async exportZip(): Promise<Blob> {
    const zip = new JSZip();
    for (const [path, content] of this.files) zip.file(path, content);
    for (const [path, blob] of this.blobs) zip.file(path, blob);
    return zip.generateAsync({ type: "blob" });
  }

  async importZip(file: Blob): Promise<void> {
    const zip = await JSZip.loadAsync(file);
    for (const path of Object.keys(zip.files)) {
      const entry = zip.files[path];
      if (!entry || entry.dir) continue;
      if (path.endsWith(".md") || path.endsWith(".json") || path.endsWith(".yaml")) {
        this.files.set(path, await entry.async("text"));
      } else {
        this.blobs.set(path, await entry.async("blob"));
      }
    }
  }
}
