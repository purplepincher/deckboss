import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { StorageAdapter, FileMetadata, Manifest, StorageBackendId } from "../interface";
import { MANIFEST_PATH } from "../interface";

export interface S3CompatibleConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string; // R2 uses "auto"; Oracle wants a real region string
}

/**
 * Shared implementation behind Cloudflare R2 and Oracle Object Storage
 * (dev guide §8.2: "S3-compatible API using @aws-sdk/client-s3... same
 * pattern for R2 and Oracle"). Both subclasses just fix id/displayName/icon
 * and pass region defaults — no server-side component, direct
 * browser-to-bucket using CORS-enabled buckets (§8.2), credentials supplied
 * by the user at Settings time and never sent anywhere but here.
 */
export abstract class S3CompatibleAdapter implements StorageAdapter {
  abstract readonly id: StorageBackendId;

  private client: S3Client;
  private verified = false;

  constructor(private config: S3CompatibleConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "auto",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async isAuthenticated(): Promise<boolean> {
    return this.verified;
  }

  async authenticate(): Promise<void> {
    // Credentials are supplied directly (no OAuth redirect) — "authenticate"
    // just proves they work against this bucket before we trust them.
    await this.client.send(
      new ListObjectsV2Command({ Bucket: this.config.bucket, MaxKeys: 1 }),
    );
    this.verified = true;
  }

  async logout(): Promise<void> {
    this.verified = false;
  }

  async readFile(path: string): Promise<string> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: path }),
    );
    if (!res.Body) throw new Error(`File not found: ${path}`);
    return res.Body.transformToString();
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: path,
        Body: content,
        ContentType: "text/markdown",
      }),
    );
  }

  async deleteFile(path: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: path }));
  }

  async listFiles(prefix: string): Promise<FileMetadata[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix }),
    );
    return (res.Contents ?? []).map((obj) => ({
      path: obj.Key ?? "",
      size: obj.Size ?? 0,
      modifiedAt: (obj.LastModified ?? new Date()).toISOString(),
      hash: obj.ETag?.replace(/"/g, ""),
    }));
  }

  async readBlob(path: string): Promise<Blob> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: path }),
    );
    if (!res.Body) throw new Error(`Blob not found: ${path}`);
    const bytes = await res.Body.transformToByteArray();
    return new Blob([new Uint8Array(bytes)], { type: res.ContentType });
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: path,
        Body: bytes,
        ContentType: blob.type || "application/octet-stream",
      }),
    );
  }

  async deleteBlob(path: string): Promise<void> {
    await this.deleteFile(path);
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
