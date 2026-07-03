import type { StorageAdapter, FileMetadata, Manifest } from "../interface";
import { MANIFEST_PATH } from "../interface";

/**
 * Google Drive backend. Client-side only — Google Identity Services' token
 * client (§8.1: "GIS with PKCE-equivalent flow, no server needed"). Scope
 * is drive.file, the least-privileged option: the app can only see files it
 * created, never the user's whole Drive.
 *
 * Needs a Google Cloud Console OAuth Client ID (Web application type) —
 * see project README for the console steps. Until a clientId is configured
 * this adapter's authenticate() throws a clear error; it's real, working
 * code, just inert without the user's own console setup (BYOK for cloud
 * storage, same philosophy as the Whisper/Anthropic keys).
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
          }): TokenClient;
          revoke(token: string, done: () => void): void;
        };
      };
    };
  }
}

let gisScriptPromise: Promise<void> | null = null;
function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

export class GoogleDriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleDriveAuthError";
  }
}

export class GoogleDriveAdapter implements StorageAdapter {
  readonly id = "google-drive" as const;

  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private folderIdCache = new Map<string, string>(); // path segment chain -> folder id
  private fileIdCache = new Map<string, string>(); // full path -> file id

  constructor(private clientId: string) {}

  async isAuthenticated(): Promise<boolean> {
    return this.accessToken !== null && Date.now() < this.tokenExpiresAt;
  }

  async authenticate(): Promise<void> {
    if (!this.clientId) {
      throw new GoogleDriveAuthError(
        "No Google OAuth Client ID configured. Add one in Settings (see README for Cloud Console setup).",
      );
    }
    await loadGisScript();
    if (!window.google) throw new GoogleDriveAuthError("Google Identity Services failed to load.");

    await new Promise<void>((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error || !resp.access_token) {
            reject(new GoogleDriveAuthError(resp.error ?? "No access token returned."));
            return;
          }
          this.accessToken = resp.access_token;
          this.tokenExpiresAt = Date.now() + resp.expires_in * 1000;
          resolve();
        },
      });
      client.requestAccessToken();
    });
  }

  async logout(): Promise<void> {
    if (this.accessToken && window.google) {
      window.google.accounts.oauth2.revoke(this.accessToken, () => {});
    }
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.folderIdCache.clear();
    this.fileIdCache.clear();
  }

  private authHeaders(): Record<string, string> {
    if (!this.accessToken) throw new GoogleDriveAuthError("Not authenticated.");
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  private async apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...this.authHeaders(), ...init.headers } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Drive API ${res.status}: ${body}`);
    }
    return res;
  }

  /** Walks/creates the folder chain for a path's directory portion, returns the leaf folder id. */
  private async resolveFolderId(dirSegments: string[]): Promise<string> {
    const cacheKey = dirSegments.join("/");
    const cached = this.folderIdCache.get(cacheKey);
    if (cached) return cached;

    let parentId = "root";
    let builtPath = "";
    for (const segment of dirSegments) {
      builtPath = builtPath ? `${builtPath}/${segment}` : segment;
      const already = this.folderIdCache.get(builtPath);
      if (already) {
        parentId = already;
        continue;
      }

      const q = encodeURIComponent(
        `name='${segment.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      );
      const listRes = await this.apiFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
      const listData = (await listRes.json()) as { files: { id: string }[] };

      let folderId = listData.files[0]?.id;
      if (!folderId) {
        const createRes = await this.apiFetch(`${DRIVE_API}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: segment,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentId],
          }),
        });
        const created = (await createRes.json()) as { id: string };
        folderId = created.id;
      }

      this.folderIdCache.set(builtPath, folderId);
      parentId = folderId;
    }
    return parentId;
  }

  private splitPath(path: string): { dirSegments: string[]; filename: string } {
    const segments = path.split("/").filter(Boolean);
    const filename = segments.pop() ?? "";
    return { dirSegments: segments, filename };
  }

  private async resolveFileId(path: string): Promise<string | null> {
    const cached = this.fileIdCache.get(path);
    if (cached) return cached;

    const { dirSegments, filename } = this.splitPath(path);
    const parentId = await this.resolveFolderId(dirSegments);
    const q = encodeURIComponent(
      `name='${filename.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`,
    );
    const res = await this.apiFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime,size)`);
    const data = (await res.json()) as { files: { id: string }[] };
    const id = data.files[0]?.id ?? null;
    if (id) this.fileIdCache.set(path, id);
    return id;
  }

  async readFile(path: string): Promise<string> {
    const id = await this.resolveFileId(path);
    if (!id) throw new Error(`File not found: ${path}`);
    const res = await this.apiFetch(`${DRIVE_API}/files/${id}?alt=media`);
    return res.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.writeMedia(path, new Blob([content], { type: "text/markdown" }));
  }

  async deleteFile(path: string): Promise<void> {
    const id = await this.resolveFileId(path);
    if (!id) return;
    await this.apiFetch(`${DRIVE_API}/files/${id}`, { method: "DELETE" });
    this.fileIdCache.delete(path);
  }

  async listFiles(prefix: string): Promise<FileMetadata[]> {
    const { dirSegments } = this.splitPath(prefix.endsWith("/") ? `${prefix}x` : prefix);
    const parentId = await this.resolveFolderId(dirSegments);
    const res = await this.apiFetch(
      `${DRIVE_API}/files?q='${parentId}'+in+parents+and+trashed=false&fields=files(id,name,modifiedTime,size)`,
    );
    const data = (await res.json()) as {
      files: { id: string; name: string; modifiedTime: string; size?: string }[];
    };
    return data.files.map((f) => ({
      path: `${prefix.replace(/\/[^/]*$/, "")}/${f.name}`,
      size: f.size ? Number(f.size) : 0,
      modifiedAt: f.modifiedTime,
    }));
  }

  async readBlob(path: string): Promise<Blob> {
    const id = await this.resolveFileId(path);
    if (!id) throw new Error(`Blob not found: ${path}`);
    const res = await this.apiFetch(`${DRIVE_API}/files/${id}?alt=media`);
    return res.blob();
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    await this.writeMedia(path, blob);
  }

  async deleteBlob(path: string): Promise<void> {
    await this.deleteFile(path);
  }

  private async writeMedia(path: string, blob: Blob): Promise<void> {
    const { dirSegments, filename } = this.splitPath(path);
    const parentId = await this.resolveFolderId(dirSegments);
    const existingId = await this.resolveFileId(path);

    const metadata = existingId ? {} : { name: filename, parents: [parentId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", blob);

    const url = existingId
      ? `${DRIVE_UPLOAD_API}/files/${existingId}?uploadType=multipart`
      : `${DRIVE_UPLOAD_API}/files?uploadType=multipart`;
    const method = existingId ? "PATCH" : "POST";

    const res = await this.apiFetch(url, { method, body: form });
    const data = (await res.json()) as { id: string };
    this.fileIdCache.set(path, data.id);
  }

  async getManifest(): Promise<Manifest> {
    try {
      const raw = await this.readFile(MANIFEST_PATH);
      return JSON.parse(raw) as Manifest;
    } catch {
      return { version: "1.0", generatedAt: new Date().toISOString(), entries: [] };
    }
  }

  async writeManifest(manifest: Manifest): Promise<void> {
    await this.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }
}
