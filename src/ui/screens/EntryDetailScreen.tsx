import { useNavigate, useParams } from "react-router-dom";
import { useDeckBossStore } from "../../state/store";
import { useAudioBlob } from "../hooks/useAudioBlob";
import { AudioWaveform } from "../components/AudioWaveform";
import { GPSBadge } from "../components/GPSBadge";

export function EntryDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const entries = useDeckBossStore((s) => s.entries);
  const amendEntry = useDeckBossStore((s) => s.amendEntry);
  const retractEntry = useDeckBossStore((s) => s.retractEntry);
  const audioBlob = useAudioBlob(id);

  const effective = entries.find((e) => e.id === id) ?? null;

  if (!effective || !id) {
    return (
      <div className="screen">
        <p>Entry not found.</p>
      </div>
    );
  }

  // The raw entry + correction bookkeeping lives entirely in the store now
  // (see amendEntry/retractEntry in state/store.ts) — this screen only ever
  // touches the effective (corrections-applied) view.
  const amend = async (tags: string[]) => {
    await amendEntry(id, { tags });
  };

  const retract = async () => {
    if (!confirm("Retract this entry? It stays in your log, marked as retracted — never deleted.")) return;
    await retractEntry(id, "removed via Entry Detail screen");
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
        {effective.transcript?.text ||
          (effective.pendingTranscript === "whisper_retry"
            ? "Transcript pending — will retry when online."
            : "No transcript — audio saved. Play it back below.")}
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
