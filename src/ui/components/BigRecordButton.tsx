import { useRef } from "react";
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

  // Plain `let`s here get reset every render, and this button re-renders
  // every 200ms while recording (elapsedMs ticking) — a timer id stored in
  // a render-local variable can be orphaned by the next render before
  // pointerup ever reads it back. useRef survives across renders instead.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The browser fires a synthesized `click` after pointerup even when a
  // long-press just cancelled the recording — by then `recording` has
  // already flipped back to false, so an unguarded onClick reads that as
  // "idle, start a new recording" and immediately starts one. This flag
  // tells the next click to no-op instead.
  const suppressNextClickRef = useRef(false);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <button
      className={`big-record-button ${recording ? "recording" : ""}`}
      disabled={busy}
      onClick={() => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        if (recording) {
          onStop();
        } else {
          onStart();
        }
      }}
      onPointerDown={() => {
        if (!recording) return;
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          suppressNextClickRef.current = true;
          onCancel();
        }, 2000); // long-press to cancel, §9.1
      }}
      onPointerUp={clearLongPressTimer}
      onPointerLeave={clearLongPressTimer}
      aria-label={recording ? "Stop recording" : "Start recording"}
    >
      <span className="dot" />
      <span>{label}</span>
    </button>
  );
}
