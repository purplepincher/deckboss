import { useEffect, useState } from "react";
import { useDeckBossStore } from "../../state/store";
import { useStorage } from "../hooks/useStorage";
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
  const storage = useStorage();
  const [busy, setBusy] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  // Which S3-compatible backend's credential form is open, if any — replaces
  // sequential prompt() dialogs (a security review flagged those as
  // unmasked and potentially visible in autofill/history; low risk since
  // credentials never leave the browser, but cheap to fix properly).
  const [openForm, setOpenForm] = useState<"cloudflare-r2" | "oracle-oci" | null>(null);
  const [formFields, setFormFields] = useState({
    endpoint: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
  });

  useEffect(() => {
    if (!configLoaded) void loadConfig();
  }, [configLoaded, loadConfig]);

  useEffect(() => {
    void getDiagnostics().then(setDiagnostics);
    void isStoragePersisted().then(setPersisted);
  }, []);

  const connect = async (id: StorageBackendId) => {
    if (id === "cloudflare-r2" || id === "oracle-oci") {
      setFormFields({ endpoint: "", bucket: "", accessKeyId: "", secretAccessKey: "" });
      setOpenForm(id);
      return;
    }

    setBusy(id);
    try {
      const next = { ...config, storage: { ...config.storage, activeBackend: id } };
      const googleDriveAuth = await storage.connect(next);
      if (googleDriveAuth) {
        next.storage.googleDrive = {
          ...config.storage.googleDrive,
          connected: true,
          accessToken: googleDriveAuth.accessToken,
          tokenExpiresAt: googleDriveAuth.tokenExpiresAt,
          refreshToken: null,
          folderId: null,
        };
      }
      await saveConfig(next);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setBusy(null);
    }
  };

  const submitS3Form = async (id: "cloudflare-r2" | "oracle-oci") => {
    const { endpoint, bucket, accessKeyId, secretAccessKey } = formFields;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return;

    setBusy(id);
    try {
      const next = { ...config, storage: { ...config.storage, activeBackend: id } };
      if (id === "cloudflare-r2") {
        next.storage.cloudflareR2 = { endpoint, bucket, accessKeyId, secretAccessKey };
      } else {
        next.storage.oracleOci = { endpoint, bucket, accessKeyId, secretAccessKey };
      }
      await storage.connect(next);
      await saveConfig(next);
      setOpenForm(null);
      setFormFields({ endpoint: "", bucket: "", accessKeyId: "", secretAccessKey: "" });
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
      const blob = await storage.exportZip(zipConfig);
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
          // A plain const (not a `b.id` property access) so the narrowed
          // literal type actually survives into the onClick closures below
          // — TS doesn't retain narrowing on object property access across
          // a nested function scope, only on local variable bindings.
          const s3Id: "cloudflare-r2" | "oracle-oci" | null =
            b.id === "cloudflare-r2" || b.id === "oracle-oci" ? b.id : null;
          return (
            <div key={b.id}>
              <div className="settings-row">
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
              {s3Id && openForm === s3Id && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0 16px" }}>
                  <input
                    placeholder="Endpoint URL"
                    value={formFields.endpoint}
                    onChange={(e) => setFormFields({ ...formFields, endpoint: e.target.value })}
                  />
                  <input
                    placeholder="Bucket name"
                    value={formFields.bucket}
                    onChange={(e) => setFormFields({ ...formFields, bucket: e.target.value })}
                  />
                  <input
                    type="password"
                    placeholder="Access key ID"
                    value={formFields.accessKeyId}
                    onChange={(e) => setFormFields({ ...formFields, accessKeyId: e.target.value })}
                  />
                  <input
                    type="password"
                    placeholder="Secret access key"
                    value={formFields.secretAccessKey}
                    onChange={(e) => setFormFields({ ...formFields, secretAccessKey: e.target.value })}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn primary"
                      disabled={busy === s3Id}
                      onClick={() => void submitS3Form(s3Id)}
                    >
                      {busy === s3Id ? "Connecting…" : "Connect"}
                    </button>
                    <button className="btn" onClick={() => setOpenForm(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
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
