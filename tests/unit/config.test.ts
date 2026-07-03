import { describe, it, expect } from "vitest";
import { set, createStore } from "idb-keyval";
import { getConfig, setConfig } from "../../src/core/storage/local-db";
import { AppConfigSchema, defaultAppConfig } from "../../src/config/schema";

const metaStore = createStore("deckboss-meta", "meta");

function validOldShapeConfigWithoutDeviceId() {
  return {
    version: "1.0",
    storage: { activeBackend: null },
    transcription: { engine: "webspeech", language: "en" },
    recording: { maxDurationMs: 300_000, autoStopSilenceMs: 3_000, shakeToRecord: false },
    ui: { darkMode: true, relativeTimestamps: true },
  };
}

describe("AppConfig deviceId", () => {
  it("defaultAppConfig() generates a valid UUID deviceId", () => {
    const config = defaultAppConfig();
    expect(config.deviceId).toBeDefined();
    const parsed = AppConfigSchema.shape.deviceId.safeParse(config.deviceId);
    expect(parsed.success).toBe(true);
  });

  it("getConfig() backfills a missing deviceId and persists it", async () => {
    // Simulate a config written before deviceId existed.
    const oldConfig = validOldShapeConfigWithoutDeviceId();
    await set("app-config", oldConfig, metaStore);

    const loaded = await getConfig();
    expect(loaded.deviceId).toBeDefined();
    const parsed = AppConfigSchema.shape.deviceId.safeParse(loaded.deviceId);
    expect(parsed.success).toBe(true);

    // Other settings should be preserved, not reset to defaults.
    expect(loaded.transcription.engine).toBe("webspeech");
    expect(loaded.ui.darkMode).toBe(true);

    // A second load should now parse strictly without re-backfilling.
    const reloaded = await getConfig();
    expect(reloaded.deviceId).toBe(loaded.deviceId);
  });

  it("getConfig() preserves an already-present deviceId", async () => {
    const config = defaultAppConfig();
    await setConfig(config);

    const loaded = await getConfig();
    expect(loaded.deviceId).toBe(config.deviceId);
  });
});
