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
  onCancel,
}: {
  phase: RecordingPhase;
  elapsedMs: number;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  const recording = phase === "recording";
  const busy = phase === "saving";

  let label = "Tap to record";
  if (phase === "recording") label = formatElapsed(elapsedMs);
  if (phase === "saving") label = "Saving...";
  if (phase === "saved") label = "Saved";
  if (phase === "error") label = "Try again";

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  return (
    <button
      className={`big-record-button ${recording ? "recording" : ""}`}
      disabled={busy}
      onClick={() => (recording ? onStop() : onStart())}
      onPointerDown={() => {
        if (!recording) return;
        longPressTimer = setTimeout(onCancel, 2000); // long-press to cancel, §9.1
      }}
      onPointerUp={() => {
        if (longPressTimer) clearTimeout(longPressTimer);
      }}
      onPointerLeave={() => {
        if (longPressTimer) clearTimeout(longPressTimer);
      }}
      aria-label={recording ? "Stop recording" : "Start recording"}
    >
      <span className="dot" />
      <span>{label}</span>
    </button>
  );
}
