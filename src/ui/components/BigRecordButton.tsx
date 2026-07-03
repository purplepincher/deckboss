import type { RecordingPhase } from "../hooks/useRecording";

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BigRecordButton({
  phase,
  elapsedMs,
  onStart,
  onStop,
}: {
  phase: RecordingPhase;
  elapsedMs: number;
  onStart: () => void;
  onStop: () => void;
}) {
  const recording = phase === "recording";
  const busy = phase === "saving";

  let label = "Tap to record";
  if (phase === "recording") label = formatElapsed(elapsedMs);
  if (phase === "saving") label = "Saving...";
  if (phase === "saved") label = "Saved";
  if (phase === "error") label = "Try again";

  return (
    <button
      className={`big-record-button ${recording ? "recording" : ""}`}
      disabled={busy}
      onClick={() => {
        if (recording) {
          onStop();
        } else {
          onStart();
        }
      }}
      aria-label={recording ? "Stop recording" : "Start recording"}
    >
      <span className="dot" />
      <span>{label}</span>
    </button>
  );
}
