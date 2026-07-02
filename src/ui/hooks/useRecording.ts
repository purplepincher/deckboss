import { useCallback, useRef, useState } from "react";
import { AudioRecorder, RecorderPermissionError } from "../../core/audio/recorder";
import { getCurrentPosition, GeolocationError } from "../../services/geolocation";
import { WebSpeechTranscriber, isWebSpeechSupported } from "../../services/webspeech";
import { transcribeWithWhisper } from "../../services/whisper";
import { buildEntry } from "../../core/tensor-log/entry-builder";
import { putAudioBlob } from "../../core/storage/local-db";
import { useDeckBossStore } from "../../state/store";
import { enqueueEntryForSync, enqueueAudioForSync } from "../../core/sync/sync-engine";
import type { GPSReading, TranscriptResult } from "../../core/types/log-entry";

export type RecordingPhase = "idle" | "recording" | "saving" | "saved" | "error";

/**
 * Drives RecordScreen's one big button end to end: mic + GPS start
 * together on tap (GPS is fire-and-forget — a slow or failed fix never
 * delays recording start, per services/geolocation.ts's contract). On
 * stop: assemble the Blob, fold in whichever transcript source is
 * configured, run buildEntry(), persist, and enqueue both the entry and
 * its audio for sync. Every step here is exactly one call into an already
 *-built module — this hook has no logic of its own beyond sequencing.
 */
export function useRecording() {
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);

  const config = useDeckBossStore((s) => s.config);
  const saveEntry = useDeckBossStore((s) => s.saveEntry);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const transcriberRef = useRef<WebSpeechTranscriber | null>(null);
  const gpsRef = useRef<GPSReading | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setGpsWarning(null);

    getCurrentPosition()
      .then((gps) => {
        gpsRef.current = gps;
      })
      .catch((err: unknown) => {
        gpsRef.current = null;
        setGpsWarning(
          err instanceof GeolocationError
            ? "GPS unavailable — your location will be added when signal returns."
            : "GPS unavailable.",
        );
      });

    const recorder = new AudioRecorder({ maxDurationMs: config.recording.maxDurationMs });
    recorderRef.current = recorder;

    try {
      await recorder.start();
    } catch (err) {
      setPhase("error");
      setError(
        err instanceof RecorderPermissionError
          ? err.message
          : "Could not start recording — check microphone permissions.",
      );
      recorderRef.current = null;
      return;
    }

    if (config.transcription.engine === "webspeech" && isWebSpeechSupported()) {
      const transcriber = new WebSpeechTranscriber();
      transcriberRef.current = transcriber;
      transcriber.start(`${config.transcription.language}-US`);
    }

    setPhase("recording");
    startedAtRef.current = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
  }, [config]);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stop = useCallback(async () => {
    if (!recorderRef.current) return;
    stopTimer();
    setPhase("saving");

    const blob = await recorderRef.current.stop();
    recorderRef.current = null;

    const liveTranscript = transcriberRef.current?.stop();
    transcriberRef.current = null;

    let transcript: TranscriptResult | undefined = liveTranscript;
    if (config.transcription.engine === "whisper" && config.transcription.whisperApiKey) {
      try {
        transcript = await transcribeWithWhisper(
          blob,
          config.transcription.whisperApiKey,
          config.transcription.language,
        );
      } catch {
        // Whisper failed (network, quota, bad key) — fall back to whatever
        // Web Speech caught live, if anything, rather than losing the note.
        transcript = liveTranscript;
      }
    }

    const entry = await buildEntry({
      audioBlob: blob,
      gps: gpsRef.current,
      transcript,
      source: "voice",
    });

    if (entry.audio) {
      await putAudioBlob(entry.id, blob);
      await enqueueAudioForSync(entry.id, blob);
    }

    await saveEntry(entry);
    await enqueueEntryForSync(entry.id);

    setElapsedMs(0);
    setPhase("saved");
    setTimeout(() => setPhase("idle"), 1500);
  }, [config, saveEntry]);

  const cancel = useCallback(() => {
    stopTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    transcriberRef.current?.stop();
    transcriberRef.current = null;
    setElapsedMs(0);
    setPhase("idle");
  }, []);

  return { phase, elapsedMs, error, gpsWarning, start, stop, cancel };
}
