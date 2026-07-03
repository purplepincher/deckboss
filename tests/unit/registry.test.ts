import { describe, it, expect } from "vitest";
import { buildAdapter } from "../../src/core/storage/registry";
import { defaultAppConfig } from "../../src/config/schema";

describe("buildAdapter caching", () => {
  it("returns the same adapter instance across calls with unchanged config", async () => {
    const config = { ...defaultAppConfig(), storage: { activeBackend: "local-zip" as const } };
    const a = await buildAdapter(config);
    const b = await buildAdapter(config);
    expect(a).toBe(b);
  });

  it("preserves in-memory state written through one call in a later call — this is the actual bug: a fresh instance per call meant auth state and in-progress writes were silently discarded", async () => {
    const config = { ...defaultAppConfig(), storage: { activeBackend: "local-zip" as const } };
    const first = await buildAdapter(config);
    await first?.writeFile("marker.txt", "hello");

    const second = await buildAdapter(config);
    await expect(second?.readFile("marker.txt")).resolves.toBe("hello");
  });

  it("returns a different instance when the backend changes", async () => {
    const zipConfig = { ...defaultAppConfig(), storage: { activeBackend: "local-zip" as const } };
    const noneConfig = { ...defaultAppConfig(), storage: { activeBackend: null } };
    const a = await buildAdapter(zipConfig);
    const b = await buildAdapter(noneConfig);
    expect(a).not.toBe(null);
    expect(b).toBe(null);
  });

  it("returns null (not a half-constructed adapter) when R2 credentials are incomplete", async () => {
    const config = {
      ...defaultAppConfig(),
      storage: { activeBackend: "cloudflare-r2" as const, cloudflareR2: { endpoint: "https://example.com" } },
    };
    const adapter = await buildAdapter(config);
    expect(adapter).toBeNull();
  });
});
