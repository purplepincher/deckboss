import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudflareR2Adapter } from "../../src/core/storage/adapters/cloudflare-r2";
import type { StorageAdapter } from "../../src/core/storage/interface";

const send = vi.fn();

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...mod,
    S3Client: class MockS3Client {
      send = send;
    },
  };
});

describe("S3CompatibleAdapter.listFiles", () => {
  let adapter: StorageAdapter;

  beforeEach(() => {
    send.mockReset();
    adapter = new CloudflareR2Adapter({
      endpoint: "https://example.r2.cloudflarestorage.com",
      bucket: "deckboss",
      accessKeyId: "key",
      secretAccessKey: "secret",
    });
  });

  it("follows NextContinuationToken and returns objects from every page", async () => {
    send
      .mockResolvedValueOnce({
        IsTruncated: true,
        NextContinuationToken: "page-2",
        Contents: [
          {
            Key: "DeckBoss/2026/07/01/entry-a.md",
            Size: 100,
            LastModified: new Date("2026-07-01T00:00:00.000Z"),
            ETag: '"abc"',
          },
        ],
      })
      .mockResolvedValueOnce({
        IsTruncated: false,
        Contents: [
          {
            Key: "DeckBoss/2026/07/02/entry-b.md",
            Size: 200,
            LastModified: new Date("2026-07-02T00:00:00.000Z"),
            ETag: '"def"',
          },
        ],
      });

    const files = await adapter.listFiles("DeckBoss/");

    expect(send).toHaveBeenCalledTimes(2);
    const firstCall = send.mock.calls[0]![0] as { input: Record<string, unknown> };
    const secondCall = send.mock.calls[1]![0] as { input: Record<string, unknown> };
    expect(firstCall.input).toEqual({
      Bucket: "deckboss",
      Prefix: "DeckBoss/",
      ContinuationToken: undefined,
    });
    expect(secondCall.input).toEqual({
      Bucket: "deckboss",
      Prefix: "DeckBoss/",
      ContinuationToken: "page-2",
    });

    expect(files).toHaveLength(2);
    expect(files).toContainEqual({
      path: "DeckBoss/2026/07/01/entry-a.md",
      size: 100,
      modifiedAt: "2026-07-01T00:00:00.000Z",
      hash: "abc",
    });
    expect(files).toContainEqual({
      path: "DeckBoss/2026/07/02/entry-b.md",
      size: 200,
      modifiedAt: "2026-07-02T00:00:00.000Z",
      hash: "def",
    });
  });

  it("returns an empty array when the bucket is empty", async () => {
    send.mockResolvedValueOnce({ IsTruncated: false, Contents: undefined });

    const files = await adapter.listFiles("DeckBoss/");

    expect(files).toEqual([]);
  });
});
