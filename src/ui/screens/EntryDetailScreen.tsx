import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDeckBossStore } from "../../state/store";
import { buildAmendCorrection, buildRetractCorrection } from "../../core/tensor-log/entry-builder";
import { getAudioBlob, getEntry } from "../../core/storage/local-db";
import { enqueueEntryForSync } from "../../core/sync/sync-engine";
import { AudioWaveform } from "../components/AudioWaveform";
import { GPSBadge } from "../components/GPSBadge";

export function EntryDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const entries = useDeckBossStore((s) => s.entries);
  const saveEntry = useDeckBossStore((s) => s.saveEntry);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const effective = entries.find((e) => e.id === id) ?? null;

  useEffect(() => {
    if (!id) return;
    void getAudioBlob(id).then((b) => setAudioBlob(b ?? null));
  }, [id]);

  if (!effective || !id) {
    return (
      <div className="screen">
        <p>Entry not found.</p>
      </div>
    );
  }

  // Corrections append to the *raw* stored entry, never the effective view —
  // getEntry() re-reads the on-disk record fresh each time this runs.
  const amend = async (tags: string[]) => {
    const raw = await getEntry(id);
    if (!raw) return;
    raw.corrections.push(buildAmendCorrection({ tags }));
    await saveEntry(raw);
    await enqueueEntryForSync(raw.id);
  };

  const retract = async () => {
    if (!confirm("Retract this entry? It stays in your log, marked as retracted — never deleted.")) return;
    const raw = await getEntry(id);
    if (!raw) return;
    raw.corrections.push(buildRetractCorrection("removed via Entry Detail screen"));
    await saveEntry(raw);
    await enqueueEntryForSync(raw.id);
    navigate("/timeline");
  };

  return (
    <div className="screen">
      <button className="btn" onClick={() => navigate(-1)}>
        ← Back
      </button>

      <p style={{ marginTop: 16 }}>{new Date(effective.timestamp).toLocaleString()}</p>
      <GPSBadge gps={effective.gps} />
      {effective.gps && <p style={{ fontSize: 12, opacity: 0.6 }}>Accuracy: {effective.gps.accuracy.toFixed(1)}m</p>}

      {effective.retracted && (
        <p className="record-warning" style={{ marginTop: 12 }}>
          This entry has been retracted. {effective.lastCorrectionReason}
        </p>
      )}

      <div className="entry-detail-transcript">
        {effective.transcript?.text || "(no transcript)"}
      </div>

      <AudioWaveform blob={audioBlob} />

      <div className="log-card-chips" style={{ marginTop: 12 }}>
        {effective.tags.map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
        {effective.entities.map((e, i) => (
          <span key={i} className="chip">
            {e.type}: {e.value} ({Math.round(e.confidence * 100)}%)
          </span>
        ))}
      </div>

      <div className="entry-detail-actions">
        <button
          className="btn"
          onClick={() => {
            const tag = prompt("Add a tag");
            if (tag) void amend([...effective.tags, tag]);
          }}
        >
          Add tag
        </button>
        {!effective.retracted && (
          <button className="btn" onClick={() => void retract()}>
            Retract
          </button>
        )}
      </div>
    </div>
  );
}
