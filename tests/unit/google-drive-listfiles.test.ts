import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GoogleDriveAdapter,
  type GoogleDriveAuthState,
} from "../../src/core/storage/adapters/google-drive";

/**
 * GoogleDriveAdapter's listFiles() recursion test.
 *
 * The restore drill's cold-start orphan scan
 * (fallbackScanForOrphanEntries in src/core/sync/sync-engine.ts) calls
 * adapter.listFiles(STORAGE_ROOT) and expects every .md file under
 * DeckBoss/, regardless of subfolder depth — that's the
 * StorageAdapter-interface contract (interface.ts: listFiles is
 * "// recursive"), and LocalZipAdapter and S3CompatibleAdapter already
 * honor it. GoogleDriveAdapter historically did NOT: it issued one
 * `'${parentId}' in parents` query against the leaf folder the prefix
 * resolved to, returning only direct children. Real entries live at
 * DeckBoss/{yyyy}/{mm}/{dd}/{id}.md — three folders deep — so on Drive
 * the scan would have missed every real orphan.
 *
 * No existing test in this suite exercised GoogleDriveAdapter against a
 * mocked Drive API (the restore drill uses LocalZipAdapter exclusively
 * because it's a complete in-memory adapter). This file builds the
 * minimal Drive API surface the adapter actually talks to (just the two
 * query shapes its listFiles/resolveFolderId/walkFolderTree methods
 * emit) and proves the fix: a file nested two folders deep under the
 * scan prefix is now found, where the previous single-level query would
 * have missed it.
 */

// ---------------------------------------------------------------------------
// In-memory Drive. Items have parent links; folders carry the Drive folder
// mimeType the adapter keys recursion off of. The mock fetch() below
// dispatches purely on the q= query parameter the real adapter sends —
// same wire shape, deterministic answers.
// ---------------------------------------------------------------------------

interface DriveItem {
  id: string;
  name: string;
  mimeType: string; // 'application/vnd.google-apps.folder' for folders
  parents: string[];
  modifiedTime?: string;
  size?: string;
}

function buildTree(items: Omit<DriveItem, "id">[]): Map<string, DriveItem> {
  const byId = new Map<string, DriveItem>();
  let counter = 0;
  for (const item of items) {
    const id = `id-${counter++}`;
    byId.set(id, { ...item, id });
  }
  return byId;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Parses the two query shapes GoogleDriveAdapter emits:
 *  - folder-by-name lookup (resolveFolderId):
 *      name='X' and 'PARENT' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false
 *  - children listing (walkFolderTree):
 *      'FOLDER_ID' in parents and trashed=false
 * The mock returns matching items; if the query asks for a folder by name
 * and none exists, returns empty (drives the real adapter's "create"
 * fallback, which we don't exercise here — every test pre-seeds the
 * folders it expects to be walked).
 */
function makeDriveFetch(items: Map<string, DriveItem>) {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? new URL(url) : url;
    const path = u.pathname;
    const method = init?.method ?? "GET";

    // GET /drive/v3/files?q=...  — the two listing/lookup shapes.
    if (path === "/drive/v3/files" && method === "GET") {
      const q = u.searchParams.get("q") ?? "";
      const fields = u.searchParams.get("fields") ?? "";
      const nameMatch = q.match(/name='((?:[^'\\]|\\.)*)'/);
      const parentMatch = q.match(/'([^']+)' in parents/);
      const folderOnly = q.includes("mimeType='application/vnd.google-apps.folder'");
      const parent = parentMatch?.[1];

      const matched = [...items.values()].filter((it) => {
        if (it.parents.length === 0) return false;
        if (parent && !it.parents.includes(parent)) return false;
        if (folderOnly && it.mimeType !== "application/vnd.google-apps.folder") return false;
        if (nameMatch && nameMatch[1] !== undefined) {
          // Unescape the simple \' escaping the adapter does for single quotes.
          const wanted = nameMatch[1].replace(/\\'/g, "'");
          if (it.name !== wanted) return false;
        }
        return true;
      });

      // Project only fields the caller asked for, mimicking Drive's
      // fields= parameter behavior — keeps the mock honest about what
      // each call site actually requests.
      const projected = matched.map((m) => {
        const out: Record<string, unknown> = { id: m.id, name: m.name };
        if (fields.includes("mimeType")) out.mimeType = m.mimeType;
        if (fields.includes("modifiedTime")) out.modifiedTime = m.modifiedTime ?? "2026-01-01T00:00:00.000Z";
        if (fields.includes("size")) out.size = m.size ?? "0";
        return out;
      });

      const body: Record<string, unknown> = { files: projected };
      if (fields.includes("nextPageToken")) body.nextPageToken = undefined;
      return jsonResponse(body);
    }

    // Fallback: any unexpected call surfaces loudly rather than silently
    // passing for the wrong reason (the same philosophy as the
    // upload-verification check this adapter also implements).
    return jsonResponse({ error: `unexpected fetch: ${method} ${path}` }, 500);
  };
}

describe("GoogleDriveAdapter.listFiles: recursion contract", () => {
  const originalFetch = globalThis.fetch;
  const authState: GoogleDriveAuthState = {
    accessToken: "test-token",
    tokenExpiresAt: Date.now() + 60 * 60 * 1000,
  };

  // Build a realistic tree mirroring what real entries look like on Drive:
  //
  //   root
  //     DeckBoss/                                    (folder)
  //       top-level.md                               (file — would be found by old code too)
  //       2026/                                      (folder)
  //         07/                                      (folder)
  //           02/                                    (folder)
  //             deep-1.md                            (file — old code MISSED)
  //             deep-2.md                            (file — old code MISSED)
  //           sibling-at-month-depth.md              (file — old code MISSED)
  //       .deckboss/                                 (folder)
  //         manifest.json                            (file — old code MISSED)
  //         attachments/                             (folder)
  //           abc_audio.webm                         (file — old code MISSED)
  //     unrelated-at-root.md                         (file — should NOT appear under DeckBoss)
  //
  // buildTree assigns ids id-0, id-1, ... in declaration order, so the
  // parent references below are stable and readable — no guessing which
  // counter value landed on which item.
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const items = buildTree([
    // id-0: DeckBoss (root's only folder of interest)
    { name: "DeckBoss", mimeType: FOLDER_MIME, parents: ["root"] },
    // id-1: file at root, outside DeckBoss — must NOT appear in a DeckBoss scan
    { name: "unrelated-at-root.md", mimeType: "text/markdown", parents: ["root"], size: "11" },
    // id-2: top-level file inside DeckBoss (old code's only .md hit)
    { name: "top-level.md", mimeType: "text/markdown", parents: ["id-0"], size: "10" },
    // id-3: 2026 folder under DeckBoss
    { name: "2026", mimeType: FOLDER_MIME, parents: ["id-0"] },
    // id-4: .deckboss folder under DeckBoss
    { name: ".deckboss", mimeType: FOLDER_MIME, parents: ["id-0"] },
    // id-5: 07 folder under 2026
    { name: "07", mimeType: FOLDER_MIME, parents: ["id-3"] },
    // id-6: a sibling .md directly under 2026 (one level deep)
    { name: "sibling-at-year-depth.md", mimeType: "text/markdown", parents: ["id-3"], size: "26" },
    // id-7: 02 folder under 07
    { name: "02", mimeType: FOLDER_MIME, parents: ["id-5"] },
    // id-8: deep .md under 2026/07/02 (three levels deep — where real entries live)
    { name: "deep-1.md", mimeType: "text/markdown", parents: ["id-7"], size: "7" },
    // id-9: another deep .md under 2026/07/02
    { name: "deep-2.md", mimeType: "text/markdown", parents: ["id-7"], size: "7" },
    // id-10: manifest.json under .deckboss
    { name: "manifest.json", mimeType: "application/json", parents: ["id-4"], size: "42" },
    // id-11: attachments folder under .deckboss
    { name: "attachments", mimeType: FOLDER_MIME, parents: ["id-4"] },
    // id-12: audio blob under .deckboss/attachments
    { name: "abc_audio.webm", mimeType: "audio/webm", parents: ["id-11"], size: "1024" },
  ]);

  beforeEach(() => {
    globalThis.fetch = vi.fn(makeDriveFetch(items)) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function newAdapter(): GoogleDriveAdapter {
    // The constructor accepts an existing token so we bypass the GIS/OAuth
    // dance (which needs a real browser, real client_id, real consent
    // popup) and exercise only the Drive-API call paths.
    return new GoogleDriveAdapter("test-client-id", authState);
  }

  it("finds a file nested two folders deep under the scan prefix — the exact case the previous single-level query missed", async () => {
    const adapter = newAdapter();
    const files = await adapter.listFiles("DeckBoss");

    const paths = files.map((f) => f.path).sort();
    // Three levels deep: DeckBoss/2026/07/02/deep-1.md. The previous
    // implementation resolved "DeckBoss" as a filename (splitPath pops
    // the last segment), resolved to root, then issued
    // `'root' in parents` — returning unrelated-at-root.md and the
    // DeckBoss folder itself, neither of which is at this path. With
    // the recursive walk, this file is found.
    expect(paths).toContain("DeckBoss/2026/07/02/deep-1.md");
    expect(paths).toContain("DeckBoss/2026/07/02/deep-2.md");
  });

  it("returns every file under the prefix, not just one level — exhaustive across the whole subtree", async () => {
    const adapter = newAdapter();
    const files = await adapter.listFiles("DeckBoss");
    const paths = files.map((f) => f.path).sort();

    expect(paths).toEqual(
      [
        "DeckBoss/.deckboss/attachments/abc_audio.webm",
        "DeckBoss/.deckboss/manifest.json",
        "DeckBoss/2026/07/02/deep-1.md",
        "DeckBoss/2026/07/02/deep-2.md",
        "DeckBoss/2026/sibling-at-year-depth.md",
        "DeckBoss/top-level.md",
      ].sort(),
    );
  });

  it("does not leak files from outside the scanned prefix", async () => {
    const adapter = newAdapter();
    const files = await adapter.listFiles("DeckBoss");
    // root-level file outside DeckBoss must not be in the result.
    expect(files.map((f) => f.path)).not.toContain("unrelated-at-root.md");
  });

  it("reconstructs full paths (not just filenames) matching how the rest of the app expects them — verifyRemoteBlob and the orphan scan both match by full path", async () => {
    const adapter = newAdapter();
    const files = await adapter.listFiles("DeckBoss");
    const deep = files.find((f) => f.path === "DeckBoss/2026/07/02/deep-1.md");
    expect(deep).toBeDefined();
    expect(deep?.size).toBe(7);
    expect(deep?.modifiedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("preserves the verifyRemoteBlob use case — a file-path prefix (with extension) resolves the parent folder and still finds the exact file", async () => {
    // verifyRemoteBlob calls listFiles(path) with a full audio path like
    // .deckboss/attachments/{id}_audio.webm and filters by exact match.
    // The extension on the last segment tells the adapter to treat it as
    // a filename and scan its parent folder.
    const adapter = newAdapter();
    const files = await adapter.listFiles("DeckBoss/.deckboss/attachments/abc_audio.webm");

    // The file itself must be present at its exact path.
    const match = files.find((f) => f.path === "DeckBoss/.deckboss/attachments/abc_audio.webm");
    expect(match).toBeDefined();
    expect(match?.size).toBe(1024);
  });

  it("does not silently produce zero results for a plain-folder prefix (the original splitPath-on-'DeckBoss' bug, which resolved to root and returned the wrong folder's children)", async () => {
    // Regression guard: if someone reverts the folder-vs-file heuristic
    // and splitPath pops "DeckBoss" as a filename again, this assertion
    // fails because listFiles would return root's children (only
    // "unrelated-at-root.md" and the DeckBoss folder itself), missing
    // every nested file entirely.
    const adapter = newAdapter();
    const files = await adapter.listFiles("DeckBoss");
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.path.startsWith("DeckBoss/2026/"))).toBe(true);
  });
});

describe("GoogleDriveAdapter.listFiles: pagination", () => {
  const originalFetch = globalThis.fetch;
  const authState: GoogleDriveAuthState = {
    accessToken: "test-token",
    tokenExpiresAt: Date.now() + 60 * 60 * 1000,
  };

  // The walk issues one Drive list call per folder. Drive caps responses
  // (default 100, max 1000) and returns nextPageToken for more; the
  // walker must follow pageToken to drain a folder with more children
  // than one page. A bare single-fetch implementation would silently
  // truncate large folders and miss orphans, defeating the whole point
  // of the scan.
  it("follows nextPageToken to collect every child of a folder that spans multiple pages", async () => {
    // One folder with 5 children, served 2 at a time across 3 pages.
    const folderItem: DriveItem = {
      id: "folder-1",
      name: "DeckBoss",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root"],
    };
    const childItems: DriveItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `child-${i}`,
      name: `entry-${i}.md`,
      mimeType: "text/markdown",
      parents: ["folder-1"],
      size: "10",
      modifiedTime: "2026-01-01T00:00:00.000Z",
    }));

    let listCallCount = 0;
    const fakeFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = typeof url === "string" ? new URL(url) : url;
      const path = u.pathname;
      const method = init?.method ?? "GET";
      if (path === "/drive/v3/files" && method === "GET") {
        const q = u.searchParams.get("q") ?? "";
        const parentMatch = q.match(/'([^']+)' in parents/);
        const parent = parentMatch?.[1];

        // Folder-name lookup from resolveFolderId — answer directly.
        if (q.includes("mimeType='application/vnd.google-apps.folder'")) {
          if (parent === "root") {
            return jsonResponse({ files: [{ id: folderItem.id, name: folderItem.name }] });
          }
          return jsonResponse({ files: [] });
        }

        // Children listing — paginate when scanning folder-1.
        if (parent === folderItem.id) {
          const pageToken = u.searchParams.get("pageToken");
          const pageSize = 2;
          const start = pageToken ? Number(pageToken) : 0;
          const slice = childItems.slice(start, start + pageSize);
          listCallCount++;
          const nextToken = start + pageSize < childItems.length ? String(start + pageSize) : undefined;
          return jsonResponse({
            files: slice.map((c) => ({
              id: c.id,
              name: c.name,
              mimeType: c.mimeType,
              modifiedTime: c.modifiedTime,
              size: c.size,
            })),
            nextPageToken: nextToken,
          });
        }
        return jsonResponse({ files: [] });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    };

    globalThis.fetch = vi.fn(fakeFetch) as unknown as typeof fetch;

    try {
      const adapter = new GoogleDriveAdapter("test-client-id", authState);
      const files = await adapter.listFiles("DeckBoss");

      expect(files.map((f) => f.path).sort()).toEqual(
        ["DeckBoss/entry-0.md", "DeckBoss/entry-1.md", "DeckBoss/entry-2.md", "DeckBoss/entry-3.md", "DeckBoss/entry-4.md"].sort(),
      );
      // Must have made more than one paginated call to drain the folder.
      expect(listCallCount).toBeGreaterThan(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
