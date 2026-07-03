import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useRecording } from "../hooks/useRecording";
import type { RecordingPhase } from "../hooks/useRecording";
import { useTensorLog } from "../hooks/useTensorLog";
import { BigRecordButton } from "../components/BigRecordButton";
import { LogCard } from "../components/LogCard";
import { useDeckBossStore } from "../../state/store";
import { getDiscardableEntry, formatDuration } from "./discard-eligibility";

interface DiscardBarState {
  entryId: string;
  durationLabel: string;
  discarded: boolean;
}

export function RecordScreen() {
  const { phase, elapsedMs, error, gpsWarning, start, stop } = useRecording();
  const { results: recent } = useTensorLog({ limit: 3 });
  const retractEntry = useDeckBossStore((s) => s.retractEntry);

  const [discardBar, setDiscardBar] = useState<DiscardBarState | null>(null);
  const prevPhaseRef = useRef<RecordingPhase>(phase);

  // Surface the post-save Discard bar the moment a save completes and the
  // button returns to idle. useRecording parks on `saved` for 1.5s (the
  // "Saved" label), then flips to `idle` — that flip is the hook point. The
  // entry offered is derived from the store's recent view, not the capture
  // hook (Fable memo §1.B): by this transition the just-saved entry is
  // already recent[0].
  useEffect(() => {
    const prev = prevPhaseRef.current;
    if (prev === "saved" && phase === "idle") {
      const eligible = getDiscardableEntry(recent, Date.now());
      if (eligible) {
        setDiscardBar({
          entryId: eligible.id,
          durationLabel: formatDuration(eligible.audio?.duration_ms ?? 0),
          discarded: false,
        });
      }
    }
    prevPhaseRef.current = phase;
  }, [phase, recent]);

  // Auto-fade: 10s while offering, 4s after a discard. Re-runs whenever the
  // bar changes (including the discarded→true swap), clearing the prior
  // timer so the shorter post-discard lifetime wins.
  useEffect(() => {
    if (!discardBar) return;
    const ttl = discardBar.discarded ? 4000 : 10_000;
    const timer = setTimeout(() => setDiscardBar(null), ttl);
    return () => clearTimeout(timer);
  }, [discardBar]);

  const handleDiscard = async () => {
    if (!discardBar || discardBar.discarded) return;
    await retractEntry(discardBar.entryId, "discarded right after recording");
    setDiscardBar({ ...discardBar, discarded: true });
  };

  return (
    <div className="record-screen">
      <BigRecordButton
        phase={phase}
        elapsedMs={elapsedMs}
        onStart={() => void start()}
        onStop={() => void stop()}
      />

      {phase === "idle" && <div className="record-instruction">Tap to record</div>}
      {phase === "recording" && <div className="record-instruction">Tap to stop</div>}
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

      {discardBar && phase === "idle" && (
        <div className="discard-bar" role="status">
          {discardBar.discarded ? (
            <span className="discard-bar-message">
              Discarded — recoverable under &ldquo;Show retracted&rdquo; in Log
            </span>
          ) : (
            <>
              <span className="discard-bar-message">Saved {discardBar.durationLabel}</span>
              <button
                type="button"
                className="discard-bar-button"
                onClick={() => void handleDiscard()}
              >
                Discard
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
