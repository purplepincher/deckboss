import type { TranscriptResult } from "../core/types/log-entry";

/**
 * Phase 1 default transcription engine (see config/schema.ts's
 * defaultAppConfig — this project deliberately flips the dev guide's
 * stated Whisper-first default). Free, zero setup, works the moment the
 * user taps record. Runs live alongside MediaRecorder — the Web Speech API
 * has no way to transcribe a pre-recorded Blob, only a live mic stream, so
 * RecordScreen (task #7) starts both at once and stops both together.
 */

// Chrome/Edge ship this under a webkit-prefixed global; not yet in lib.dom.d.ts.
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export class WebSpeechUnsupportedError extends Error {
  constructor() {
    super("Web Speech API is not supported in this browser.");
    this.name = "WebSpeechUnsupportedError";
  }
}

export class WebSpeechTranscriber {
  private recognition: SpeechRecognitionLike | null = null;
  private finalChunks: string[] = [];
  private confidences: number[] = [];
  private active = false;
  private language = "en-US";
  private _hadNetworkError = false;

  /**
   * True if recognition ever reported a "network" error during this
   * session — i.e. Chrome tried to ship audio to a cloud recognition
   * service and couldn't reach it. This is the common case at sea: most
   * browsers' Web Speech implementation is network-backed, not on-device,
   * so "no signal" and "no transcript" are the same failure. Distinct from
   * "no-speech" (genuine silence, benign) — only "network" sets this.
   * Checked by useRecording.ts's stop() to decide whether an empty result
   * means "you didn't say anything" or "we couldn't even try."
   */
  get hadNetworkError(): boolean {
    return this._hadNetworkError;
  }

  start(language = "en-US"): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) throw new WebSpeechUnsupportedError();

    this.finalChunks = [];
    this.confidences = [];
    this.active = true;
    this.language = language;
    this._hadNetworkError = false;

    this.recognition = new Ctor();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = language;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result || !result.isFinal) continue;
        const alt = result[0];
        if (!alt) continue;
        this.finalChunks.push(alt.transcript.trim());
        this.confidences.push(alt.confidence || 0.8);
      }
    };

    // Chrome periodically ends continuous recognition on its own; restart
    // while we're still meant to be listening.
    this.recognition.onend = () => {
      if (this.active) this.recognition?.start();
    };
    this.recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
      // "no-speech"/"aborted" are benign — onend restarts us, an empty
      // result honestly means "nothing was said." "network" is not benign:
      // most browsers' Web Speech is a cloud service, not on-device, so
      // this is what happens with zero bars — the common case at sea, not
      // an edge case. Flag it so stop() can tell the difference.
      if (ev.error === "network") this._hadNetworkError = true;
    };

    this.recognition.start();
  }

  /** Stops listening and returns whatever was transcribed as one TranscriptResult. */
  stop(): TranscriptResult {
    this.active = false;
    this.recognition?.stop();
    this.recognition = null;

    const text = this.finalChunks.join(" ").trim();
    const confidence =
      this.confidences.length > 0
        ? this.confidences.reduce((a, b) => a + b, 0) / this.confidences.length
        : 0;

    return { text, confidence, language: this.language.split("-")[0] ?? "en", engine: "webspeech" };
  }
}
