import { Link } from "react-router-dom";
import { useRecording } from "../hooks/useRecording";
import { useTensorLog } from "../hooks/useTensorLog";
import { BigRecordButton } from "../components/BigRecordButton";
import { LogCard } from "../components/LogCard";

export function RecordScreen() {
  const { phase, elapsedMs, error, gpsWarning, start, stop, cancel } = useRecording();
  const { results: recent } = useTensorLog({ limit: 3 });

  return (
    <div className="record-screen">
      <BigRecordButton
        phase={phase}
        elapsedMs={elapsedMs}
        onStart={() => void start()}
        onStop={() => void stop()}
        onCancel={cancel}
      />

      {phase === "idle" && <div className="record-instruction">Tap to record</div>}
      {phase === "recording" && (
        <div className="record-instruction">Tap to stop · hold 2s to cancel</div>
      )}
      {error && <div className="record-error">{error}</div>}
      {gpsWarning && phase !== "idle" && <div className="record-warning">{gpsWarning}</div>}

      {recent.length > 0 && phase === "idle" && (
        <div style={{ width: "100%", marginTop: 24 }}>
          <div className="record-instruction" style={{ marginBottom: 8, fontSize: 13 }}>
            Recent logs
          </div>
          {recent.map((e) => (
            <LogCard key={e.id} entry={e} />
          ))}
          <Link to="/timeline" className="record-see-all">
            See all →
          </Link>
        </div>
      )}
    </div>
  );
}
