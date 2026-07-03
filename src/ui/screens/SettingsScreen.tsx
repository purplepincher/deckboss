import { useEffect, useState } from "react";
import { useDeckBossStore } from "../../state/store";
import { buildAdapter } from "../../core/storage/registry";
import { LocalZipAdapter } from "../../core/storage/adapters/local-zip";
import { pushAllLocalEntries } from "../../core/sync/sync-engine";
import type { StorageBackendId } from "../../core/storage/interface";
import { getDiagnostics, type Diagnostics } from "../../core/diagnostics";
import { isStoragePersisted } from "../../core/storage/persistence";

const BACKENDS: { id: StorageBackendId; label: string }[] = [
  { id: "google-drive", label: "Google Drive" },
  { id: "cloudflare-r2", label: "Cloudflare R2" },
  { id: "oracle-oci", label: "Oracle Object Storage" },
  { id: "local-zip", label: "Export ZIP" },
];

export function SettingsScreen() {
  const config = useDeckBossStore((s) => s.config);
  const configLoaded = useDeckBossStore((s) => s.configLoaded);
  const loadConfig = useDeckBossStore((s) => s.loadConfig);
  const saveConfig = useDeckBossStore((s) => s.saveConfig);
  const [busy, setBusy] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!configLoaded) void loadConfig();
  }, [configLoaded, loadConfig]);

  useEffect(() => {
    void getDiagnostics().then(setDiagnostics);
    void isStoragePersisted().then(setPersisted);
  }, []);

  const connect = async (id: StorageBackendId) => {
    setBusy(id);
    try {
      if (id === "cloudflare-r2" || id === "oracle-oci") {
        const endpoint = prompt("Endpoint URL") ?? "";
        const bucket = prompt("Bucket name") ?? "";
        const accessKeyId = prompt("Access key ID") ?? "";
        const secretAccessKey = prompt("Secret access key") ?? "";
        if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return;

        const next = { ...config, storage: { ...config.storage, activeBackend: id } };
        if (id === "cloudflare-r2") {
          next.storage.cloudflareR2 = { endpoint, bucket, accessKeyId, secretAccessKey };
        } else {
          next.storage.oracleOci = { endpoint, bucket, accessKeyId, secretAccessKey };
        }
        const adapter = buildAdapter(next);
        await adapter?.authenticate();
        await saveConfig(next);
      } else if (id === "google-drive") {
        const next = { ...config, storage: { ...config.storage, activeBackend: id } };
        const adapter = buildAdapter(next);
        await adapter?.authenticate();
        await saveConfig(next);
      } else {
        await saveConfig({ ...config, storage: { ...config.storage, activeBackend: id } });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setBusy(null);
    }
  };

  const exportZip = async () => {
    setBusy("export");
    try {
      const zipConfig = { ...config, storage: { ...config.storage, activeBackend: "local-zip" as const } };
      await saveConfig(zipConfig);
      await pushAllLocalEntries();
      const adapter = buildAdapter(zipConfig) as LocalZipAdapter;
      // Bundled so a fisherman can hit one button and send the resulting
      // .zip when something seems wrong, without needing to know what
      // GitHub is — this is the whole support path for the field beta.
      const currentDiagnostics = await getDiagnostics();
      const persistedNow = await isStoragePersisted();
      await adapter.writeFile(
        "diagnostics.json",
        JSON.stringify({ ...currentDiagnostics, storagePersisted: persistedNow }, null, 2),
      );
      const blob = await adapter.exportZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deckboss-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="screen">
      <div className="settings-section">
        <h2>STORAGE</h2>
        {BACKENDS.map((b) => {
          const active = config.storage.activeBackend === b.id;
          return (
            <div className="settings-row" key={b.id}>
              <label>{b.label}</label>
              {b.id === "local-zip" ? (
                <button className="btn" disabled={busy === "export"} onClick={() => void exportZip()}>
                  {busy === "export" ? "Exporting…" : "Export →"}
                </button>
              ) : (
                <button
                  className={`btn ${active ? "connected" : ""}`}
                  disabled={busy === b.id}
                  onClick={() => void connect(b.id)}
                >
                  {busy === b.id ? "Connecting…" : active ? "● Connected" : "Connect"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="settings-section">
        <h2>TRANSCRIPTION</h2>
        <div className="settings-row">
          <label>Engine</label>
          <select
            value={config.transcription.engine}
            onChange={(e) =>
              void saveConfig({
                ...config,
                transcription: { ...config.transcription, engine: e.target.value as "webspeech" | "whisper" },
              })
            }
          >
            <option value="webspeech">Browser (free)</option>
            <option value="whisper">OpenAI Whisper (your key)</option>
          </select>
        </div>
        {config.transcription.engine === "whisper" && (
          <div className="settings-row">
            <label>API key</label>
            <input
              type="password"
              defaultValue={config.transcription.whisperApiKey ?? ""}
              placeholder="sk-..."
              onBlur={(e) =>
                void saveConfig({
                  ...config,
                  transcription: { ...config.transcription, whisperApiKey: e.target.value },
                })
              }
            />
          </div>
        )}
      </div>

      <div className="settings-section">
        <h2>RECORDING</h2>
        <div className="settings-row">
          <label>Max duration</label>
          <select
            value={config.recording.maxDurationMs}
            onChange={(e) =>
              void saveConfig({
                ...config,
                recording: { ...config.recording, maxDurationMs: Number(e.target.value) },
              })
            }
          >
            <option value={60_000}>1 min</option>
            <option value={300_000}>5 min</option>
            <option value={600_000}>10 min</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h2>SUPPORT</h2>
        <div className="settings-row">
          <label>Something wrong?</label>
          <button className="btn" disabled={busy === "export"} onClick={() => void exportZip()}>
            {busy === "export" ? "Exporting…" : "Export everything →"}
          </button>
        </div>
        {diagnostics && (
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
            {diagnostics.recordingsCompleted} saved · {diagnostics.recordingsFailed} failed to start ·{" "}
            {diagnostics.syncFailures} sync error{diagnostics.syncFailures === 1 ? "" : "s"}
          </p>
        )}
        <p style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
          Storage: {persisted === null ? "checking…" : persisted ? "persistent ✓" : "not persistent ⚠"}
          {persisted === false && " — install this app to your home screen to protect it from being cleared."}
        </p>
      </div>

      <div className="settings-section">
        <h2>ABOUT</h2>
        <p style={{ fontSize: 13, opacity: 0.6 }}>DeckBoss 0.1.0 · PurplePincher.org</p>
        <p style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
          Personal log only — not a substitute for official or regulatory catch reporting.
        </p>
      </div>
    </div>
  );
}
