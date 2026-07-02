import type { TranscriptResult } from "../core/types/log-entry";

export class WhisperApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WhisperApiError";
  }
}

/**
 * Opt-in transcription upgrade (see config/schema.ts: Phase 1 default is
 * Web Speech, this is the Settings-screen upgrade path). The key never
 * leaves the browser except in this one direct call to OpenAI — no
 * PurplePincher server sits in between, matching SAFETY/privacy §11.1:
 * "the user's own API key."
 */
export async function transcribeWithWhisper(
  blob: Blob,
  apiKey: string,
  language = "en",
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", blob, `audio.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
  form.append("model", "whisper-1");
  if (language) form.append("language", language);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WhisperApiError(`Whisper API error ${res.status}: ${body}`, res.status);
  }

  const data = (await res.json()) as { text: string };
  // The basic transcriptions endpoint doesn't return a confidence score;
  // 0.95 reflects Whisper's typical accuracy rather than a measured value —
  // shown in UI as "high confidence" rather than a bogus precise number.
  return { text: data.text.trim(), confidence: 0.95, language, engine: "whisper-1" };
}
